"""Download and normalise the public datasets.

Every question becomes one sample:
    {question_id, category, question, answer, question_date, abstention, context_id,
     sessions: [{id, date, turns: [{role, content}]}]}
Questions that share a history (all LoCoMo questions about one conversation) share a context_id, so each
system ingests that history once.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

import httpx

DATA = Path(__file__).parent / "data"

LONGMEMEVAL_S_URL = (
    "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json"
)
# The audit keeps the original LoCoMo file byte-for-byte and lists the wrong golden answers separately.
LOCOMO_URL = "https://raw.githubusercontent.com/dial481/locomo-audit/main/data/locomo10.json"
LOCOMO_ERRORS_URL = "https://raw.githubusercontent.com/dial481/locomo-audit/main/errors.json"

LOCOMO_CATEGORIES = {1: "multi-hop", 2: "temporal", 3: "open-domain", 4: "single-hop", 5: "adversarial"}
# Error types that change the golden answer (WRONG_CITATION only fixes the evidence pointer).
SCORE_CHANGING = {"HALLUCINATION", "TEMPORAL_ERROR", "ATTRIBUTION_ERROR", "AMBIGUOUS", "INCOMPLETE"}


def download(url: str, name: str) -> Path:
    DATA.mkdir(exist_ok=True)
    path = DATA / name
    if path.exists():
        return path
    print(f"downloading {name} ...")
    tmp = path.with_suffix(".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=None) as res:
        res.raise_for_status()
        with tmp.open("wb") as f:
            for chunk in res.iter_bytes(1 << 20):
                f.write(chunk)
    tmp.rename(path)
    return path


def _iso(value: str) -> str:
    """LongMemEval: '2023/05/20 (Sat) 02:21'. LoCoMo: '1:56 pm on 8 May, 2023'. Returns ISO 8601 (UTC)."""
    value = value.strip()
    m = re.match(r"(\d{4})/(\d{2})/(\d{2})(?: \(\w+\))?(?: (\d{1,2}):(\d{2}))?", value)
    if m:
        y, mo, d, h, mi = m.groups()
        return datetime(int(y), int(mo), int(d), int(h or 0), int(mi or 0)).isoformat() + "Z"
    for fmt in ("%I:%M %p on %d %B, %Y", "%I:%M %p on %d %b, %Y"):
        try:
            return datetime.strptime(value, fmt).isoformat() + "Z"
        except ValueError:
            pass
    raise ValueError(f"unknown date format: {value!r}")


def load_longmemeval_s() -> list[dict]:
    raw = json.loads(download(LONGMEMEVAL_S_URL, "longmemeval_s_cleaned.json").read_text())
    out = []
    for q in raw:
        sessions = [
            {
                "id": sid,
                "date": _iso(date),
                "turns": [{"role": t["role"], "content": t["content"]} for t in turns],
            }
            for sid, date, turns in zip(q["haystack_session_ids"], q["haystack_dates"], q["haystack_sessions"])
        ]
        sessions.sort(key=lambda s: s["date"])
        out.append(
            {
                "question_id": q["question_id"],
                "category": q["question_type"],
                "question": q["question"],
                "answer": str(q["answer"]),
                "question_date": _iso(q["question_date"]),
                "abstention": q["question_id"].endswith("_abs"),
                "context_id": q["question_id"],
                "sessions": sessions,
            }
        )
    return out


def load_locomo_corrected(include_adversarial: bool = False) -> list[dict]:
    """LoCoMo with the audit's corrected answers applied (99 wrong golden answers fixed).

    Category 5 (adversarial) has no answer key that any published result evaluates; skipped by default.
    """
    convs = json.loads(download(LOCOMO_URL, "locomo10.json").read_text())
    errors = json.loads(download(LOCOMO_ERRORS_URL, "locomo_errors.json").read_text())
    fixes = {e["question_id"]: e for e in errors if e["error_type"] in SCORE_CHANGING}

    out = []
    for ci, conv in enumerate(convs):
        c = conv["conversation"]
        speakers = {c["speaker_a"]: "user", c["speaker_b"]: "assistant"}
        sessions = []
        n = 1
        while f"session_{n}" in c:
            turns = [
                {
                    "role": speakers.get(t["speaker"], "user"),
                    "content": f"{t['speaker']}: {t['text']}"
                    + (f" [shares a photo: {t['blip_caption']}]" if t.get("blip_caption") else ""),
                }
                for t in c[f"session_{n}"]
            ]
            sessions.append({"id": f"{conv['sample_id']}-s{n}", "date": _iso(c[f"session_{n}_date_time"]), "turns": turns})
            n += 1
        last_date = max(s["date"] for s in sessions)

        for qi, qa in enumerate(conv["qa"]):
            if qa["category"] == 5 and not include_adversarial:
                continue
            qid = f"locomo_{ci}_qa{qi}"
            fix = fixes.get(qid)
            if fix and fix["question"].strip() != qa["question"].strip():
                fix = None  # id drift: never apply a fix to the wrong question
            if qa["category"] == 5:
                answer, abstention = "The conversation does not say.", True
            else:
                answer, abstention = str(fix["correct_answer"] if fix else qa["answer"]), False
            out.append(
                {
                    "question_id": qid,
                    "category": LOCOMO_CATEGORIES[qa["category"]],
                    "question": qa["question"],
                    "answer": answer,
                    "question_date": last_date,
                    "abstention": abstention,
                    "corrected": bool(fix),
                    "context_id": conv["sample_id"],
                    "sessions": sessions,
                }
            )
    return out


DATASETS = {"longmemeval-s": load_longmemeval_s, "locomo-corrected": load_locomo_corrected}


def session_text(session: dict) -> str:
    return "\n".join(f"{t['role']}: {t['content']}" for t in session["turns"])
