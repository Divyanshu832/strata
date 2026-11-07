"""Memory systems under test. Each adapter: setup(sessions) once per history, then answer(...) per question.

answer() returns {answer, tokens_in, tokens_out, cost_usd, latency_ms, context_tokens}.
Baselines and Hindsight use the same answer prompt (llm.ANSWER_SYSTEM); Strata answers through its own
/v1/answer endpoint with the same answer model.
"""

from __future__ import annotations

import os
import time
import uuid

import httpx

from llm import LLM
from loaders import session_text


def _tokens(text: str) -> int:
    return (len(text) + 3) // 4  # same estimate Strata uses


class NoMemory:
    name = "no-memory"
    uses_budget = False

    def __init__(self, llm: LLM):
        self.llm = llm

    def setup(self, context_id: str, sessions: list[dict]) -> None:
        pass

    def answer(self, sample: dict, model: str, budget: int | None) -> dict:
        out = self.llm.answer(model, sample["question"], sample["question_date"], None)
        return {**out, "answer": out.pop("text"), "context_tokens": 0}


class FullContext(NoMemory):
    name = "full-context"

    def setup(self, context_id: str, sessions: list[dict]) -> None:
        self.history = "\n\n".join(f"[Session {s['date'][:10]}]\n{session_text(s)}" for s in sessions)

    def answer(self, sample: dict, model: str, budget: int | None) -> dict:
        out = self.llm.answer(model, sample["question"], sample["question_date"], self.history)
        return {**out, "answer": out.pop("text"), "context_tokens": _tokens(self.history)}


class Strata:
    """Fresh workspace per history; each session is one raw source, extracted by the Strata extractor.

    Needs the server running with EXTRACTOR=openrouter (otherwise raw text is only chunk-indexed).
    """

    name = "strata"
    uses_budget = True

    def __init__(self, llm: LLM, wait_s: float = 1800, idle_s: float = 90):
        url = os.environ.get("STRATA_URL", "http://localhost:8787")
        admin = os.environ.get("STRATA_ADMIN_TOKEN", "")
        if not admin:
            raise SystemExit("STRATA_ADMIN_TOKEN is not set (needed to create a workspace per sample).")
        self.http = httpx.Client(base_url=url, timeout=600)
        self.admin = {"authorization": f"Bearer {admin}"}
        self.wait_s = wait_s
        self.idle_s = idle_s  # an extraction call can take a while; wait this long with no new fact
        self.key = ""

    def _auth(self) -> dict:
        return {"authorization": f"Bearer {self.key}"}

    def setup(self, context_id: str, sessions: list[dict]) -> None:
        res = self.http.post("/admin/workspaces", json={"name": f"bench-{context_id}-{uuid.uuid4().hex[:6]}"}, headers=self.admin)
        res.raise_for_status()
        self.key = res.json()["apiKey"]

        items = [
            {"content": session_text(s), "kind": "session", "occurredAt": s["date"], "externalId": s["id"]}
            for s in sessions
        ]
        for i in range(0, len(items), 100):  # the API takes up to 100 items per call
            self.http.post("/v1/memories", json={"items": items[i : i + 100]}, headers=self._auth()).raise_for_status()
        self._wait_for_extraction()

    def _wait_for_extraction(self) -> None:
        """No job-status endpoint: wait until no new fact has been recorded for idle_s seconds."""
        deadline = time.time() + self.wait_s
        last, stable = None, 0
        while time.time() < deadline:
            res = self.http.get("/v1/memories", params={"limit": 1}, headers=self._auth())
            res.raise_for_status()
            facts = res.json()["facts"]
            newest = facts[0]["id"] if facts else None  # newest recorded fact
            stable = stable + 1 if newest is not None and newest == last else 0
            if stable * 5 >= self.idle_s:
                return
            last = newest
            time.sleep(5)
        print(f"  warning: extraction still running after {self.wait_s:.0f}s")

    def answer(self, sample: dict, model: str, budget: int | None) -> dict:
        body = {"query": sample["question"], "model": model, "now": sample["question_date"]}
        if budget:
            body["maxTokens"] = budget
        start = time.perf_counter()
        res = self.http.post("/v1/answer", json=body, headers=self._auth())
        res.raise_for_status()
        data = res.json()
        usage = data.get("usage") or {}
        return {
            "answer": data["answer"],
            "tokens_in": usage.get("inputTokens", 0),
            "tokens_out": usage.get("outputTokens", 0),
            "cost_usd": usage.get("costUsd") or 0.0,
            "latency_ms": (time.perf_counter() - start) * 1000,
            "context_tokens": (data.get("recall") or {}).get("tokens", 0),
        }


class Hindsight:
    """vectorize-io/hindsight over its REST API (default http://localhost:8888).

    Retain runs synchronously so extraction is finished before the questions. Hindsight's own extraction
    LLM is configured on its server; that cost is not visible here (same as Strata's extractor cost).
    Recall results are answered with the same answer model and prompt as the baselines.
    """

    name = "hindsight"
    uses_budget = True

    def __init__(self, llm: LLM):
        self.llm = llm
        self.http = httpx.Client(base_url=os.environ.get("HINDSIGHT_URL", "http://localhost:8888"), timeout=1800)
        self.bank = ""

    def _path(self, suffix: str = "") -> str:
        return f"/v1/default/banks/{self.bank}{suffix}"

    def setup(self, context_id: str, sessions: list[dict]) -> None:
        self.bank = f"bench-{context_id}-{uuid.uuid4().hex[:6]}"
        self.http.put(self._path(), json={}).raise_for_status()
        items = [{"content": session_text(s), "timestamp": s["date"], "document_id": s["id"]} for s in sessions]
        for i in range(0, len(items), 10):
            self.http.post(self._path("/memories"), json={"items": items[i : i + 10], "async": False}).raise_for_status()

    def answer(self, sample: dict, model: str, budget: int | None) -> dict:
        start = time.perf_counter()
        res = self.http.post(
            self._path("/memories/recall"),
            json={"query": sample["question"], "max_tokens": budget or 4096, "query_timestamp": sample["question_date"]},
        )
        res.raise_for_status()
        recall_ms = (time.perf_counter() - start) * 1000
        lines = []
        for r in res.json().get("results", []):
            when = r.get("occurred_start") or r.get("mentioned_at") or ""
            lines.append(f"- {r['text']}" + (f" ({when[:10]})" if when else ""))
        context = "\n".join(lines) or "Nothing found."
        out = self.llm.answer(model, sample["question"], sample["question_date"], context)
        out["latency_ms"] += recall_ms
        return {**out, "answer": out.pop("text"), "context_tokens": _tokens(context)}


SYSTEMS = {s.name: s for s in (NoMemory, FullContext, Strata, Hindsight)}
