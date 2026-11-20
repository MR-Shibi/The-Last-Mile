from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.consent import require_case_access
from app.core.database import get_db
from app.core.deps import ensure_same_tenant, get_current_user, require_roles
from app.models import Case, Decision, Role, Scheme, User
from app.services import faults
from app.services.case_pipeline import evaluate_case

router = APIRouter(tags=["decisions"])


def decision_out(d: Decision, with_trace: bool = False) -> dict:
    out = {"id": d.id, "case_id": d.case_id, "route": d.route, "probability": d.probability,
           "rule_version_id": d.rule_version_id, "rule_version": (d.trace_json or {}).get("rule_version"),
           "reason_user_en": d.reason_user_en, "reason_user_ur": d.reason_user_ur, "decided_by": d.decided_by,
           "created_at": d.created_at.isoformat()}
    if with_trace:
        out["trace"] = d.trace_json
    return out


def _case_for(db: Session, user: User, case_id: int) -> Case:
    case = db.get(Case, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    if user.role in (Role.ADMIN, Role.AUDITOR):
        ensure_same_tenant(db, user, case.tenant_id, "case", case.id)  # traces hold no raw PII
    else:
        require_case_access(db, user, case)
    return case


@router.get("/cases/{case_id}/decisions")
def case_decisions(case_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    case = _case_for(db, user, case_id)
    rows = db.execute(select(Decision).where(Decision.case_id == case.id).order_by(Decision.id.desc())).scalars()
    return [decision_out(d) for d in rows]


@router.get("/decisions/{decision_id}/trace")
def decision_trace(decision_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    d = db.get(Decision, decision_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Decision not found")
    _case_for(db, user, d.case_id)
    return decision_out(d, with_trace=True)


@router.post("/cases/{case_id}/evaluate")
def re_evaluate(case_id: int, user: User = Depends(require_roles(Role.OFFICER, Role.ADMIN)),
                db: Session = Depends(get_db)) -> dict:
    case = _case_for(db, user, case_id)
    return decision_out(evaluate_case(db, case, actor=user), with_trace=True)


class OfficerActionIn(BaseModel):
    action: Literal["approve", "request_proof", "reject"]
    reason: str = Field(default="", max_length=1000)


OFFICER_ROUTES = {"approve": "OFFICER_APPROVED", "request_proof": "OFFICER_REQUESTED_PROOF", "reject": "OFFICER_REJECTED"}


@router.post("/cases/{case_id}/officer-action")
def officer_action(case_id: int, body: OfficerActionIn, user: User = Depends(require_roles(Role.OFFICER)),
                   db: Session = Depends(get_db)) -> dict:
    """Only a human officer can reject, and a rejection always needs a written reason."""
    case = _case_for(db, user, case_id)
    if body.action in ("reject", "request_proof") and len(body.reason.strip()) < 5:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A reason (min 5 characters) is mandatory")
    route = OFFICER_ROUTES[body.action]
    last = db.execute(select(Decision).where(Decision.case_id == case.id).order_by(Decision.id.desc()).limit(1)).scalar()
    en = {"approve": "An officer approved your application. Payment will be sent soon.",
          "request_proof": f"An officer needs more proof: {body.reason}",
          "reject": f"An officer reviewed your case and could not approve it: {body.reason} You can appeal."}[body.action]
    ur = {"approve": "افسر نے آپ کی درخواست منظور کر لی۔ ادائیگی جلد بھیجی جائے گی۔",
          "request_proof": f"افسر کو مزید ثبوت چاہیے: {body.reason}",
          "reject": f"افسر نے آپ کا کیس دیکھا اور منظور نہیں کر سکا: {body.reason} آپ اپیل کر سکتی ہیں۔"}[body.action]
    d = Decision(tenant_id=case.tenant_id, case_id=case.id, rule_version_id=last.rule_version_id if last else None,
                 route=route, probability=last.probability if last else 0.0, reason_user_en=en, reason_user_ur=ur,
                 trace_json={"officer_id": user.id, "action": body.action, "reason": body.reason,
                             "engine_decision_id": last.id if last else None,
                             "engine_route": last.route if last else None},
                 decided_by=f"officer:{user.id}")
    db.add(d)
    case.status = route
    db.flush()
    write_audit(db, f"officer.{body.action}", tenant_id=case.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="case", resource_id=case.id, payload={"decision_id": d.id, "reason": body.reason},
                commit=False)
    db.commit()
    return decision_out(d)


@router.post("/cases/{case_id}/disburse")
def disburse(case_id: int, user: User = Depends(require_roles(Role.OFFICER)), db: Session = Depends(get_db)):
    """1-tap officer confirmation guardrail: the engine can only *recommend*; money moves on a human tap."""
    case = _case_for(db, user, case_id)
    if case.status not in ("AUTO_RECOMMEND", "OFFICER_APPROVED"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Case status {case.status} is not payable")
    scheme = db.get(Scheme, case.scheme_id)
    if faults.is_active("raast_error"):
        write_audit(db, "payment.failed", tenant_id=case.tenant_id, actor_user_id=user.id, actor_role=user.role,
                    resource_type="case", resource_id=case.id, payload={"error": "RAAST_ERROR"})
        return JSONResponse(status_code=502, content={"error": "RAAST_ERROR", "status": case.status,
                                                      "detail": "Payment switch error (simulated); queued for retry"})
    import secrets
    txn = "RAAST-SIM-" + secrets.token_hex(6).upper()
    case.status = "PAID"
    write_audit(db, "payment.disbursed", tenant_id=case.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="case", resource_id=case.id,
                payload={"amount_pkr": scheme.amount_pkr if scheme else 0, "txn": txn}, commit=False)
    db.commit()
    return {"status": "PAID", "txn_id": txn, "amount_pkr": scheme.amount_pkr if scheme else 0, "simulated": True}
