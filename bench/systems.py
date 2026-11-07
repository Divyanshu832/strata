"""Memory systems under test. Each adapter: setup(sessions) once per history, then answer(...) per question.

answer() returns {answer, tokens_in, tokens_out, cost_usd, latency_ms, context_tokens}.
Baselines and Hindsight use the same answer prompt (llm.ANSWER_SYSTEM); Strata answers through its own
/v1/answer endpoint with the same answer model.
"""

from __future__ import annotations

import os
import re
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

    def __init__(self, llm: LLM, keep_workspaces: bool = False):
        self.llm = llm

    def setup(self, context_id: str, sessions: list[dict]) -> None:
        pass

    def teardown(self) -> float:
        return 0.0

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
    """Fresh workspace per history; each session is one raw source.

    With EXTRACTOR=openrouter on the server, sessions become facts; with EXTRACTOR=none they are chunked and
    embedded locally, and recall searches the chunks. The workspace is deleted after the sample, and its
    extraction cost (from /v1/usage) is added to the answers' cost.
    """

    name = "strata"
    uses_budget = True

    def __init__(self, llm: LLM | None, wait_s: float = 3600, keep_workspaces: bool = False):
        url = os.environ.get("STRATA_URL", "http://localhost:8787")
        admin = os.environ.get("STRATA_ADMIN_TOKEN", "")
        if not admin:
            raise SystemExit("STRATA_ADMIN_TOKEN is not set (needed to create a workspace per sample).")
        self.http = httpx.Client(base_url=url, timeout=600)
        self.admin = {"authorization": f"Bearer {admin}"}
        self.wait_s = wait_s
        self.keep = keep_workspaces
        self.key = ""
        self.workspace_id = ""

    def _auth(self) -> dict:
        return {"authorization": f"Bearer {self.key}"}

    def setup(self, context_id: str, sessions: list[dict]) -> None:
        res = self.http.post("/admin/workspaces", json={"name": f"bench-{context_id}-{uuid.uuid4().hex[:6]}"}, headers=self.admin)
        res.raise_for_status()
        self.key = res.json()["apiKey"]
        self.workspace_id = res.json()["workspace"]["id"]

        items = [
            {"content": session_text(s), "kind": "session", "occurredAt": s["date"], "externalId": s["id"]}
            for s in sessions
        ]
        for i in range(0, len(items), 100):  # the API takes up to 100 items per call
            self.http.post("/v1/memories", json={"items": items[i : i + 100]}, headers=self._auth()).raise_for_status()
        self._wait_for_processing()

    def _wait_for_processing(self) -> None:
        """Poll /v1/status until every raw source has been extracted or indexed."""
        deadline = time.time() + self.wait_s
        while time.time() < deadline:
            res = self.http.get("/v1/status", headers=self._auth())
            res.raise_for_status()
            if res.json()["pendingSources"] == 0:
                return
            time.sleep(1)
        print(f"  warning: sources still pending after {self.wait_s:.0f}s")

    def teardown(self) -> float:
        """Returns this workspace's extraction cost in USD, then deletes the workspace (unless kept)."""
        cost = 0.0
        res = self.http.get("/v1/usage", params={"days": 1}, headers=self._auth())
        if res.is_success:
            cost = sum(t.get("costUsd") or 0.0 for t in res.json().get("totals", []) if t.get("kind") == "extract")
        if not self.keep:
            self.http.delete(f"/admin/workspaces/{self.workspace_id}", headers=self.admin).raise_for_status()
        return cost

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

    def recall_only(self, sample: dict, budget: int | None) -> dict:
        """No LLM: retrieved tokens, latency, and whether the gold answer appears in what was recalled."""
        body = {"query": sample["question"], "now": sample["question_date"]}
        if budget:
            body["maxTokens"] = budget
        start = time.perf_counter()
        res = self.http.post("/v1/recall", json=body, headers=self._auth())
        res.raise_for_status()
        latency = (time.perf_counter() - start) * 1000
        data = res.json()
        items = data.get("items", [])
        parts = [data.get("chain") or ""] + [i.get("text", "") for i in items]
        if data.get("answer"):
            parts.append(str(data["answer"].get("value")))
        text = "\n".join(parts)
        return {
            "answer": text[:2000],
            "tokens_in": 0,
            "tokens_out": 0,
            "cost_usd": 0.0,
            "latency_ms": latency,
            "context_tokens": data.get("tokens", 0),
            "route": (data.get("route") or {}).get("type"),
            "items_fact": sum(1 for i in items if i.get("type") == "fact"),
            "items_chunk": sum(1 for i in items if i.get("type") == "chunk"),
            "hit": answer_in(sample["answer"], text),
        }


def answer_in(expected: str, text: str) -> bool:
    """Cheap retrieval check: the gold answer string (case and punctuation ignored) occurs in the text."""
    norm = lambda s: " ".join(re.sub(r"[^a-z0-9]+", " ", s.lower()).split())
    gold = norm(expected)
    return bool(gold) and gold in norm(text)


class Hindsight:
    """vectorize-io/hindsight over its REST API (default http://localhost:8888).

    Retain runs synchronously so extraction is finished before the questions. Hindsight's own extraction
    LLM is configured on its server; that cost is not visible here (same as Strata's extractor cost).
    Recall results are answered with the same answer model and prompt as the baselines.
    """

    name = "hindsight"
    uses_budget = True

    def __init__(self, llm: LLM, keep_workspaces: bool = False):
        self.llm = llm
        self.keep = keep_workspaces
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

    def teardown(self) -> float:
        if not self.keep:
            self.http.delete(self._path())
        return 0.0  # Hindsight's own extraction cost is not exposed over its API

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
