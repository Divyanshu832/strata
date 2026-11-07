"""Strata benchmark runner.

    uv run run.py --dataset longmemeval-s --system strata --limit 20

Datasets go in bench/data/ (gitignored): LongMemEval-S and the corrected LoCoMo (locomo-audit).
Results go in bench/results/ (gitignored) as JSON, one file per run.

Systems (W4-W5): no-memory, full-context, plain vector search, Mem0, Zep/Graphiti, Hindsight, strata.
Every system uses the same answer model and the same judge. Report accuracy per category, tokens per
answer, p50/p95 latency and $ per correct answer.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import httpx

HERE = Path(__file__).parent
DATA = HERE / "data"
RESULTS = HERE / "results"

STRATA_URL = os.environ.get("STRATA_URL", "http://localhost:8787")
STRATA_API_KEY = os.environ.get("STRATA_API_KEY", "")


def load_dataset(name: str) -> list[dict]:
    """TODO(W2): parse LongMemEval-S / corrected LoCoMo into
    {id, category, sessions: [{date, messages}], question, answer, question_date}."""
    raise NotImplementedError(f"dataset loader for {name!r} not written yet (expected files in {DATA})")


def run_strata(item: dict, client: httpx.Client) -> dict:
    """Ingest the item's sessions into a fresh workspace, then ask the question via /v1/answer.
    TODO(W2): one workspace per item, wait for extraction jobs to finish before asking."""
    raise NotImplementedError


def judge(question: str, expected: str, answer: str) -> bool:
    """TODO(W2): same judge prompt for every system (stricter than the default LoCoMo judge)."""
    raise NotImplementedError


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True, choices=["longmemeval-s", "locomo-corrected"])
    parser.add_argument("--system", default="strata")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    items = load_dataset(args.dataset)[: args.limit]
    headers = {"authorization": f"Bearer {STRATA_API_KEY}"}
    rows = []
    with httpx.Client(base_url=STRATA_URL, headers=headers, timeout=120) as client:
        for item in items:
            start = time.perf_counter()
            out = run_strata(item, client)
            rows.append({**out, "id": item["id"], "latency_s": time.perf_counter() - start})

    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"{args.dataset}-{args.system}-{int(time.time())}.json"
    path.write_text(json.dumps(rows, indent=2))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
