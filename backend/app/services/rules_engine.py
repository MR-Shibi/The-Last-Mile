"""Dynamic, versioned JSON rule engine.

Rule document shape:
{
  "hard": [{"id": "income_cap", "field": "monthly_income", "op": "<=", "value": 30000, "label": "..."}],
  "soft": [{"id": "dependents", "field": "dependents", "op": ">=", "value": 1, "weight": 0.6, "label": "..."}]
}
Publishing creates version+1 instantly (no redeploy). Decisions keep a permanent FK to the exact
rule_version row they were evaluated under.
"""
from datetime import date
from typing import Any, Literal

from fastapi import HTTPException, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import RuleVersion, Scheme

Op = Literal["==", "!=", ">=", "<=", ">", "<", "in", "not_in", "exists"]


class RuleCondition(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    field: str = Field(min_length=1, max_length=64)
    op: Op
    value: Any = None
    label: str = ""
    weight: float = Field(default=1.0, ge=0, le=1)


class RuleDocument(BaseModel):
    hard: list[RuleCondition] = Field(default_factory=list)
    soft: list[RuleCondition] = Field(default_factory=list)


def validate_rules(rules_json: dict) -> dict:
    try:
        return RuleDocument.model_validate(rules_json).model_dump()
    except ValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Invalid rule document: {e.errors()[:3]}") from e


# ----------------------------------------------------------------- facts
def _to_bool(v: Any) -> bool | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in {"true", "1", "yes", "haan", "han", "ji", "y", "ہاں"}:
        return True
    if s in {"false", "0", "no", "nahi", "nahin", "n", "نہیں"}:
        return False
    return None


def _to_num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return None


def facts_from_case(data: dict) -> dict:
    """Normalise raw case input into typed facts the rules evaluate against."""
    d = data or {}
    age = _to_num(d.get("age"))
    if age is None and d.get("dob"):
        try:
            y, m, dd = (int(x) for x in str(d["dob"])[:10].split("-"))
            today = date.today()
            age = today.year - y - ((today.month, today.day) < (m, dd))
        except ValueError:
            age = None
    is_widow = _to_bool(d.get("is_widow"))
    if is_widow is None and d.get("marital_status"):
        is_widow = str(d["marital_status"]).lower() == "widowed"
    income = _to_num(d.get("monthly_income"))
    return {
        "age": age,
        "province": d.get("province"),
        "monthly_income": income,
        "is_widow": is_widow,
        "dependents": _to_num(d.get("dependents")),
        "receives_other_grant": _to_bool(d.get("receives_other_grant")),
        "flood_affected": _to_bool(d.get("flood_affected")),
        "household_size": _to_num(d.get("household_size")),
    }


# ----------------------------------------------------------------- evaluation
def _check(op: str, actual: Any, expected: Any) -> bool:
    if op == "exists":
        return actual is not None
    if op == "in":
        return actual in (expected or [])
    if op == "not_in":
        return actual not in (expected or [])
    if op == "==":
        return actual == expected
    if op == "!=":
        return actual != expected
    try:
        a, e = float(actual), float(expected)
    except (TypeError, ValueError):
        return False
    return {">=": a >= e, "<=": a <= e, ">": a > e, "<": a < e}[op]


def evaluate_rules(rules_json: dict, facts: dict) -> dict:
    doc = RuleDocument.model_validate(rules_json)
    hard, soft, missing = [], [], []
    for r in doc.hard:
        actual = facts.get(r.field)
        if actual is None and r.op != "exists":
            hard.append({"id": r.id, "label": r.label, "status": "missing", "op": r.op, "threshold": r.value})
            missing.append(r.field)
            continue
        ok = _check(r.op, actual, r.value)
        hard.append({"id": r.id, "label": r.label, "status": "pass" if ok else "fail", "op": r.op, "threshold": r.value})
    w_total = w_hit = 0.0
    for r in doc.soft:
        actual = facts.get(r.field)
        ok = actual is not None and _check(r.op, actual, r.value)
        w_total += r.weight
        w_hit += r.weight if ok else 0.0
        soft.append({"id": r.id, "label": r.label, "status": "pass" if ok else ("missing" if actual is None else "fail"),
                     "weight": r.weight})
    n_fail = sum(h["status"] == "fail" for h in hard)
    n_pass = sum(h["status"] == "pass" for h in hard)
    soft_ratio = (w_hit / w_total) if w_total else 1.0
    if n_fail:
        score = 0.0
    elif missing:
        score = 0.7 * (n_pass / max(1, len(hard)))
    else:
        score = 0.9 + 0.1 * soft_ratio
    return {
        "hard": hard,
        "soft": soft,
        "hard_pass": n_fail == 0 and not missing,
        "hard_failed": [h["id"] for h in hard if h["status"] == "fail"],
        "missing_fields": missing,
        "soft_ratio": round(soft_ratio, 4),
        "rule_score": round(score, 4),
    }


# ----------------------------------------------------------------- versioning
def active_rule_version(db: Session, scheme_id: int) -> RuleVersion | None:
    return db.execute(
        select(RuleVersion).where(RuleVersion.scheme_id == scheme_id, RuleVersion.is_active.is_(True))
        .order_by(RuleVersion.version.desc()).limit(1)
    ).scalar()


def publish_rule_version(db: Session, scheme: Scheme, rules_json: dict, user_id: int, notes: str = "") -> RuleVersion:
    clean = validate_rules(rules_json)
    current = db.execute(select(func.max(RuleVersion.version)).where(RuleVersion.scheme_id == scheme.id)).scalar() or 0
    for old in db.execute(select(RuleVersion).where(RuleVersion.scheme_id == scheme.id,
                                                    RuleVersion.is_active.is_(True))).scalars():
        old.is_active = False
    rv = RuleVersion(tenant_id=scheme.tenant_id, scheme_id=scheme.id, version=current + 1, rules_json=clean,
                     notes=notes, published_by=user_id, is_active=True)
    db.add(rv)
    db.flush()
    return rv
