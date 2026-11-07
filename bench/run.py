"""Strata benchmark runner: the same questions, answer models and judge for every memory system.

    uv run run.py --dataset longmemeval-s --systems strata,no-memory --limit 20
    uv run run.py --dataset locomo-corrected --systems strata,full-context \\
        --answer-models z-ai/glm-5.3,<a-stronger-model> --budgets 1000,2000,4000,8000
    uv run run.py --dataset longmemeval-s --systems strata --limit 20 --recall-only   # free, no LLM
  uv run run.py --summarize results/<run>.jsonl

Datasets (downloaded into bench/data/ on first use, gitignored):
  longmemeval-s      LongMemEval-S, 500 questions (xiaowu0162/longmemeval-cleaned on Hugging Face)
  locomo-corrected   LoCoMo with the 99 wrong golden answers fixed by dial481/locomo-audit

Systems: no-memory, full-context, strata, hindsight.
  strata     needs the API on STRATA_URL with STRATA_ADMIN_TOKEN. EXTRACTOR=openrouter on the server turns
             sessions into facts; EXTRACTOR=none indexes them as chunks (free). One workspace per history,
             deleted afterwards (--keep-workspaces to keep), its extraction cost added to its answers.
  hindsight  needs a Hindsight server on HINDSIGHT_URL (default http://localhost:8888).
Answer models and the judge run on OpenRouter (OPENROUTER_API_KEY). Env is read from ../.env if present.

Each answer is one JSONL line in bench/results/ (gitignored). The summary reports accuracy per category,
context and answer tokens, p50/p95 latency, total $ and $ per correct answer (answer calls only;
including Strata's extraction cost; the judge's cost is shown separately). --budgets runs Strata and
Hindsight once per token budget, which gives the accuracy-vs-tokens curve.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
RESULTS = HERE / "results"


def load_env(path: Path) -> None:
    """Minimal .env reader: KEY=value lines; real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value:
            os.environ.setdefault(key.strip(), value)


load_env(HERE.parent / ".env")

from llm import LLM, judge  # noqa: E402  (after env is loaded)
from loaders import DATASETS  # noqa: E402
from systems import SYSTEMS  # noqa: E402


def csv(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


def summarize(rows: list[dict]) -> None:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        groups[(r["system"], r["model"], r["budget"] or "-")].append(r)
    categories = sorted({r["category"] for r in rows})

    print()
    header = ["system", "model", "budget", "n", "acc"] + categories + [
        "ctx tok", "out tok", "p50 ms", "p95 ms", "$ total", "$/correct", "$ judge",
    ]
    table = [header]
    for (system, model, budget), rs in sorted(groups.items(), key=lambda kv: tuple(map(str, kv[0]))):
        ok = [r for r in rs if r.get("correct")]
        lat = [r["latency_ms"] for r in rs]
        cost = sum(r["cost_usd"] for r in rs)
        per_cat = []
        for c in categories:
            cr = [r for r in rs if r["category"] == c]
            per_cat.append(f"{100 * sum(r['correct'] for r in cr) / len(cr):.1f}" if cr else "-")
        table.append(
            [system, model, str(budget), str(len(rs)), f"{100 * len(ok) / len(rs):.1f}", *per_cat,
             f"{statistics.mean(r['context_tokens'] for r in rs):.0f}",
             f"{statistics.mean(r['tokens_out'] for r in rs):.0f}",
             f"{percentile(lat, 50):.0f}", f"{percentile(lat, 95):.0f}",
             f"{cost:.4f}", f"{cost / len(ok):.5f}" if ok else "-",
             f"{sum(r.get('judge_cost_usd', 0) for r in rs):.4f}"]
        )
    widths = [max(len(row[i]) for row in table) for i in range(len(header))]
    for i, row in enumerate(table):
        print("  ".join(cell.ljust(w) for cell, w in zip(row, widths)))
        if i == 0:
            print("  ".join("-" * w for w in widths))
    print()


def ask(system, llm, args, sample: dict, model: str, budget: int | None) -> dict:
    extra: dict = {}
    try:
        if args.recall_only:
            res = system.recall_only(sample, budget)
            correct, judge_cost = res.pop("hit"), 0.0
        else:
            res = system.answer(sample, model, budget)
            correct, judge_cost = judge(llm, args.judge_model, sample, res["answer"])
    except Exception as err:  # keep the run going; record the failure as wrong
        print(f"  error on {sample['question_id']} ({system.name}): {err}")
        res = {"answer": f"ERROR: {err}", "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0,
               "latency_ms": 0.0, "context_tokens": 0}
        correct, judge_cost = False, 0.0
        extra["error"] = True
    return {
        "question_id": sample["question_id"], "category": sample["category"],
        "system": system.name, "model": model, "budget": budget,
        "question": sample["question"], "expected": sample["answer"],
        **res, **extra, "correct": correct, "judge_cost_usd": judge_cost,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", choices=sorted(DATASETS))
    parser.add_argument("--systems", type=csv, default=["strata"], help=f"comma list of: {', '.join(SYSTEMS)}")
    parser.add_argument("--answer-models", type=csv, default=["z-ai/glm-5.3"],
                        help="comma list; use one cheap and one strong model")
    parser.add_argument("--judge-model", default="z-ai/glm-5.3")
    parser.add_argument("--budgets", type=lambda v: [int(x) for x in csv(v)], default=[],
                        help="token budgets for strata/hindsight, e.g. 1000,2000,4000,8000 (default: system default)")
    parser.add_argument("--limit", type=int, help="first N questions")
    parser.add_argument("--categories", type=csv, help="only these categories")
    parser.add_argument("--recall-only", action="store_true",
                        help="strata only: skip /answer and the judge (no LLM, free); 'acc' is the share of "
                             "questions whose gold answer string appears in the recalled text")
    parser.add_argument("--keep-workspaces", action="store_true", help="don't delete bench workspaces/banks")
    parser.add_argument("--summarize", type=Path, help="print the summary of an existing results file and exit")
    args = parser.parse_args()

    if args.summarize:
        summarize([json.loads(line) for line in args.summarize.read_text().splitlines() if line.strip()])
        return
    if not args.dataset:
        parser.error("--dataset is required")
    unknown = [s for s in args.systems if s not in SYSTEMS]
    if unknown:
        parser.error(f"unknown systems: {unknown}")
    if args.recall_only and args.systems != ["strata"]:
        parser.error("--recall-only works with --systems strata only")

    samples = DATASETS[args.dataset]()
    if args.categories:
        samples = [s for s in samples if s["category"] in args.categories]
    samples = samples[: args.limit]

    # Group questions by shared history, so each system ingests a history once.
    by_context: dict[str, list[dict]] = defaultdict(list)
    for s in samples:
        by_context[s["context_id"]].append(s)

    llm = None if args.recall_only else LLM()
    systems = [SYSTEMS[name](llm, keep_workspaces=args.keep_workspaces) for name in args.systems]
    models = ["recall-only"] if args.recall_only else args.answer_models
    RESULTS.mkdir(exist_ok=True)
    mode = "-recall" if args.recall_only else ""
    out_path = RESULTS / f"{args.dataset}-{'+'.join(args.systems)}{mode}-{time.strftime('%Y%m%d-%H%M%S')}.jsonl"
    rows: list[dict] = []
    print(f"{len(samples)} questions over {len(by_context)} histories → {out_path}")

    with out_path.open("w") as out:
        for ci, (context_id, group) in enumerate(by_context.items(), 1):
            for system in systems:
                t0 = time.perf_counter()
                system.setup(context_id, group[0]["sessions"])
                print(f"[{ci}/{len(by_context)}] {system.name}: ingested {context_id} "
                      f"({len(group[0]['sessions'])} sessions) in {time.perf_counter() - t0:.0f}s")
                budgets = (args.budgets or [None]) if system.uses_budget else [None]
                batch: list[dict] = []
                try:
                    for sample in group:
                        for model in models:
                            for budget in budgets:
                                batch.append(ask(system, llm, args, sample, model, budget))
                finally:
                    extract_cost = system.teardown()
                # Spread the history's extraction cost over its answers, so $ per correct answer includes it.
                for row in batch:
                    row["extract_cost_usd"] = extract_cost / len(batch)
                    row["cost_usd"] += row["extract_cost_usd"]
                    out.write(json.dumps(row) + "\n")
                out.flush()
                rows.extend(batch)
    summarize(rows)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
