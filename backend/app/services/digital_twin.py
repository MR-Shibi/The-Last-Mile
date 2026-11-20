"""Digital Twin: replay a candidate rule document against existing + synthetic cases without
mutating anything. Existing cases reuse the identity/document/anomaly evidence captured in their
latest engine trace, so only the policy changes between baseline and projection."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ml.anomaly import anomaly_assessment
from app.models import Case, Decision, Scheme
from app.services.case_pipeline import decide_with, gather_components
from app.services.decision_engine import ASK_MORE_PROOF, AUTO_RECOMMEND, ESCALATE_HUMAN
from app.services.rules_engine import active_rule_version, facts_from_case, validate_rules


def synthetic_cohort(n: int = 40) -> list[dict]:
    """Deterministic applicants spanning the income boundary, with clean evidence."""
    out = []
    for i in range(n):
        income = 10000 + i * 1000  # 10k .. 49k
        facts_src = {"age": 25 + (i * 7) % 50, "province": "Sindh" if i % 2 else "Punjab", "monthly_income": income,
                     "is_widow": i % 10 != 9, "dependents": 1 + i % 4, "receives_other_grant": False,
                     "flood_affected": i % 3 == 0}
        facts = facts_from_case(facts_src)
        out.append({
            "id": f"syn-{i + 1:02d}",
            "facts": facts,
            "identity": {"identity_match_score": 1.0, "flags": [], "name_scores": [1.0, 1.0], "matcher_version": "synthetic"},
            "document": {"document_score": 0.93, "flags": [], "vision_version": "synthetic"},
            "anomaly": anomaly_assessment(facts, 0, 0, 0),
            "extra_flags": [],
        })
    return out


def _bucket(route: str) -> str:
    return {AUTO_RECOMMEND: "approved", ESCALATE_HUMAN: "escalated", ASK_MORE_PROOF: "ask"}.get(route, "other")


def simulate(db: Session, scheme: Scheme, candidate_rules: dict, include_synthetic: bool = True) -> dict:
    candidate = validate_rules(candidate_rules)
    baseline_rv = active_rule_version(db, scheme.id)
    baseline = baseline_rv.rules_json if baseline_rv else {"hard": [], "soft": []}

    items: list[tuple[str | int, dict]] = []
    for case in db.execute(select(Case).where(Case.scheme_id == scheme.id)).scalars():
        last = db.execute(select(Decision).where(Decision.case_id == case.id, Decision.decided_by == "engine")
                          .order_by(Decision.id.desc()).limit(1)).scalar()
        if last and last.trace_json.get("identity"):
            t = last.trace_json
            comps = {"facts": facts_from_case(case.data or {}), "identity": t["identity"], "document": t["document"],
                     "anomaly": t["anomaly"], "extra_flags": [f for f in t.get("flags", []) if f == "prompt_injection"]}
        else:
            comps = gather_components(db, case, case.data or {}, honour_faults=False)
        items.append((case.id, comps))
    if include_synthetic:
        items.extend((s["id"], s) for s in synthetic_cohort())

    counts = {f"{side}_{b}": 0 for side in ("baseline", "projected") for b in ("approved", "escalated", "ask")}
    changes = []
    for cid, comps in items:
        b = decide_with(baseline, comps)["route"]
        p = decide_with(candidate, comps)["route"]
        counts[f"baseline_{_bucket(b)}"] += 1
        counts[f"projected_{_bucket(p)}"] += 1
        if b != p:
            changes.append({"case_id": cid, "from": b, "to": p})
    return {
        **counts,
        "total_cases": len(items),
        "real_cases": sum(1 for cid, _ in items if isinstance(cid, int)),
        "synthetic_cases": sum(1 for cid, _ in items if isinstance(cid, str)),
        "baseline_rule_version": baseline_rv.version if baseline_rv else None,
        "changed_case_ids": [c["case_id"] for c in changes],
        "changes": changes,
        "mutated_db": False,
    }
