"""HARD GATE 5 — 540-case / 13-family evaluation suite, metrics and dashboard API."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
FAMILIES = {"01_name_variants", "02_duplicates", "03_missing_data", "04_wrong_data", "05_bad_photos", "06_forged_docs",
            "07_scam_messages", "08_weak_network", "09_speech_noise", "10_rule_changes", "11_consent", "12_security",
            "13_ai_failures"}


@pytest.fixture(scope="module")
def eval_results() -> dict:
    gen = subprocess.run([sys.executable, "scripts/generate_eval_cases.py"], cwd=BACKEND, capture_output=True, text=True, encoding="utf-8")
    assert gen.returncode == 0, gen.stderr
    run = subprocess.run([sys.executable, "scripts/run_eval.py"], cwd=BACKEND, capture_output=True, text=True,
                         encoding="utf-8", errors="replace", timeout=900)
    assert run.returncode == 0, run.stderr[-3000:]
    return json.loads((BACKEND / "eval" / "results.json").read_text(encoding="utf-8"))


def test_generator_produces_540ish_cases_across_13_families():
    spec = json.loads((BACKEND / "eval" / "cases.json").read_text(encoding="utf-8")) if (BACKEND / "eval" / "cases.json").exists() else None
    if spec is None:
        subprocess.run([sys.executable, "scripts/generate_eval_cases.py"], cwd=BACKEND, check=True, capture_output=True)
        spec = json.loads((BACKEND / "eval" / "cases.json").read_text(encoding="utf-8"))
    assert 520 <= spec["count"] <= 560
    counts: dict[str, int] = {}
    for c in spec["cases"]:
        counts[c["family"]] = counts.get(c["family"], 0) + 1
    assert set(counts) == FAMILIES
    assert all(38 <= n <= 45 for n in counts.values())
    assert len({c["id"] for c in spec["cases"]}) == spec["count"]  # unique ids


def test_every_case_ran_through_real_engine_and_passed(eval_results):
    assert eval_results["total"] >= 520
    failing = {f["family"]: f["failures"] for f in eval_results["by_family"] if f["pass_rate"] < 1}
    assert not failing, json.dumps(failing, ensure_ascii=False)[:3000]
    assert {f["family"] for f in eval_results["by_family"]} == FAMILIES


def test_never_auto_reject_across_suite(eval_results):
    assert eval_results["never_auto_reject"] is True


def test_security_and_consent_families_are_perfect(eval_results):
    rates = {f["family"]: f["pass_rate"] for f in eval_results["by_family"]}
    assert rates["12_security"] == 1.0 and rates["11_consent"] == 1.0 and rates["08_weak_network"] == 1.0


def test_cost_threshold_analysis(eval_results):
    rows = {r["threshold"]: r for r in eval_results["threshold_analysis"]}
    assert set(rows) == {0.75, 0.85, 0.90, 0.95, 0.98}
    for r in rows.values():
        assert {"wrong_approvals", "wrongly_blocked_eligible", "human_review_load", "total_expected_cost"} <= set(r)
    best = min(r["total_expected_cost"] for r in rows.values())
    assert rows[0.95]["total_expected_cost"] == best          # 0.95 is (one of) the cheapest
    assert rows[0.95]["wrong_approvals"] == 0                 # no fraud is auto-recommended at the chosen threshold
    assert rows[0.98]["total_expected_cost"] > best           # stricter only adds proof requests for genuine people
    assert eval_results["optimal_threshold"] == 0.95
    # monotone: raising the threshold never increases wrong approvals
    was = [rows[t]["wrong_approvals"] for t in sorted(rows)]
    assert was == sorted(was, reverse=True)


def test_scam_and_forensics_metrics_reported_honestly(eval_results):
    sm, fm = eval_results["scam_metrics"], eval_results["forensics_metrics"]
    for k in ("precision", "recall_flagged_as_scam", "false_alarm_rate", "missed_scam_rate", "legit_sent_to_review_rate"):
        assert 0.0 <= sm[k] <= 1.0
    assert sm["n"] == 42 and sm["missed_scam_rate"] <= 0.1 and sm["false_alarm_rate"] <= 0.1
    assert fm["recall"] >= 0.9 and fm["false_alarm_rate"] <= 0.1 and fm["true_negative"] >= 10


def test_eval_endpoints(client, auth, eval_results):
    s = client.get("/eval/summary").json()
    assert s["total"] == eval_results["total"] and len(s["families"]) == 13 and "threshold_analysis" in s
    fam = client.get("/eval/by-family").json()
    assert len(fam) == 13 and all("failures" in f for f in fam)
    assert client.post("/eval/run", headers=auth("sindh.officer")).status_code == 403
    assert client.post("/eval/run", headers=auth("sindh.auditor")).status_code == 403
