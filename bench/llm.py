"""OpenRouter calls (answer models for the baselines, and the judge). Plain httpx, no SDK."""

from __future__ import annotations

import os
import time

import httpx

OPENROUTER_URL = os.environ.get("OPENROUTER_URL", "https://openrouter.ai/api/v1")

ANSWER_SYSTEM = (
    "You are answering a question about a user's past conversations. Use only the information given. "
    "Today's date is given with the question; use it for relative dates. "
    "If the information does not contain the answer, say you don't know. Answer briefly."
)


class LLM:
    def __init__(self, api_key: str | None = None, timeout: float = 300):
        key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
        if not key:
            raise SystemExit("OPENROUTER_API_KEY is not set (needed for answer models and the judge).")
        self.http = httpx.Client(
            base_url=OPENROUTER_URL,
            headers={"authorization": f"Bearer {key}", "x-title": "strata-bench"},
            timeout=timeout,
        )

    def chat(self, model: str, system: str, user: str, max_tokens: int = 2048) -> dict:
        """One chat call. Returns {text, tokens_in, tokens_out, cost_usd, latency_ms}. Retries on 429/5xx."""
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_tokens": max_tokens,
            "temperature": 0,
            "reasoning": {"effort": "low"},
            "usage": {"include": True},
        }
        for attempt in range(5):
            start = time.perf_counter()
            try:
                res = self.http.post("/chat/completions", json=body)
            except httpx.TransportError:
                if attempt == 4:
                    raise
                time.sleep(2**attempt)
                continue
            if res.status_code == 429 or res.status_code >= 500:
                time.sleep(2**attempt)
                continue
            res.raise_for_status()
            data = res.json()
            usage = data.get("usage") or {}
            return {
                "text": (data["choices"][0]["message"].get("content") or "").strip(),
                "tokens_in": usage.get("prompt_tokens", 0),
                "tokens_out": usage.get("completion_tokens", 0),
                "cost_usd": usage.get("cost") or 0.0,
                "latency_ms": (time.perf_counter() - start) * 1000,
            }
        res.raise_for_status()
        raise RuntimeError("unreachable")

    def answer(self, model: str, question: str, question_date: str, context: str | None) -> dict:
        memory = f"Information:\n{context}\n\n" if context is not None else ""
        return self.chat(model, ANSWER_SYSTEM, f"{memory}Today's date: {question_date}\nQuestion: {question}")


# --- Judge (LongMemEval's prompts; the same judge for every system) ----------------------------

_BASE = (
    "I will give you a question, a correct answer, and a response from a model. Please answer yes if the "
    "response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct "
    "answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If "
    "the response only contains a subset of the information required by the answer, answer no."
)
_TEMPORAL = (
    " In addition, do not penalize off-by-one errors for the number of days. If the question asks for the "
    "number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when "
    "the answer is 18), the model's response is still correct."
)
_UPDATE = (
    " If the response contains some previous information along with an updated answer, the response should "
    "be considered as correct as long as the updated answer is the required answer."
)
_PREFERENCE = (
    "I will give you a question, a rubric for desired personalized response, and a response from a model. "
    "Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does "
    "not need to reflect all the points in the rubric. The response is correct as long as it recalls and "
    "utilizes the user's personal information correctly."
)
_ABSTENTION = (
    "I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes "
    "if the model correctly identifies the question as unanswerable. The model could say that the information "
    "is incomplete, or some other information is given but the asked information is not."
)


def judge_prompt(category: str, question: str, expected: str, response: str, abstention: bool) -> str:
    if abstention:
        return (
            f"{_ABSTENTION}\n\nQuestion: {question}\n\nExplanation: {expected}\n\nModel Response: {response}\n\n"
            "Does the model correctly identify the question as unanswerable? Answer yes or no only."
        )
    if category == "single-session-preference":
        return (
            f"{_PREFERENCE}\n\nQuestion: {question}\n\nRubric: {expected}\n\nModel Response: {response}\n\n"
            "Is the model response correct? Answer yes or no only."
        )
    extra = _TEMPORAL if "temporal" in category else _UPDATE if category == "knowledge-update" else ""
    return (
        f"{_BASE}{extra}\n\nQuestion: {question}\n\nCorrect Answer: {expected}\n\nModel Response: {response}\n\n"
        "Is the model response correct? Answer yes or no only."
    )


def judge(llm: LLM, model: str, sample: dict, response: str) -> tuple[bool, float]:
    """Returns (correct, judge_cost_usd)."""
    prompt = judge_prompt(
        sample["category"], sample["question"], sample["answer"], response, sample.get("abstention", False)
    )
    out = llm.chat(model, "You are a strict, fair grader.", prompt, max_tokens=512)  # room for reasoning tokens
    return out["text"].strip().lower().startswith("yes"), out["cost_usd"]
