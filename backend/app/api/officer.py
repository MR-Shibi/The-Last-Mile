"""Department Officer workspace: risk-sorted queue + Input vs OCR vs Registry diff."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.consent import active_scopes, redact_case_data, require_case_access
from app.core.database import get_db
from app.core.deps import require_roles
from app.models import Case, CaseField, ConsentScope, Decision, Role, Scheme, User

router = APIRouter(prefix="/officer", tags=["officer"])
OPEN_STATUSES = ("ESCALATE_HUMAN", "ASK_MORE_PROOF", "AUTO_RECOMMEND", "OFFICER_REQUESTED_PROOF")


def _engine_decision(db: Session, case_id: int) -> Decision | None:
    return db.execute(select(Decision).where(Decision.case_id == case_id, Decision.decided_by == "engine")
                      .order_by(Decision.id.desc()).limit(1)).scalar()


@router.get("/queue")
def queue(include_closed: bool = False, user: User = Depends(require_roles(Role.OFFICER)),
          db: Session = Depends(get_db)) -> list[dict]:
    q = select(Case).where(Case.tenant_id == user.tenant_id)
    if not include_closed:
        q = q.where(Case.status.in_(OPEN_STATUSES))
    items = []
    for case in db.execute(q).scalars():
        d = _engine_decision(db, case.id)
        scopes = active_scopes(db, case.citizen_user_id)
        locked = ConsentScope.IDENTITY not in scopes
        flags = (d.trace_json or {}).get("flags", []) if d else []
        items.append({"case_id": case.id, "status": case.status, "probability": d.probability if d else 0.0,
                      "flags": flags, "locked": locked, "applicant_name": None if locked else case.applicant_name,
                      "reason_user_en": d.reason_user_en if d else None, "decision_id": d.id if d else None,
                      "created_at": case.created_at.isoformat()})
    # Lowest confidence and most risk flags first; consent-locked cases last (nothing to review yet)
    items.sort(key=lambda i: (i["locked"], i["probability"], -len(i["flags"])))
    return items


@router.get("/cases/{case_id}/review")
def review(case_id: int, user: User = Depends(require_roles(Role.OFFICER)), db: Session = Depends(get_db)) -> dict:
    case = db.get(Case, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    scopes = require_case_access(db, user, case)  # consent re-checked on every read
    d = _engine_decision(db, case.id)
    trace = d.trace_json if d else {}
    best = (trace.get("identity") or {}).get("best_match") or {}
    ocr = {f.key: f.value for f in db.execute(select(CaseField).where(CaseField.case_id == case.id,
                                                                      CaseField.source == "ocr")).scalars()}
    data = redact_case_data(case.data or {}, scopes, user.role)
    registry = {"full_name": best.get("registry_name"), "father_name": best.get("registry_father"),
                "province": best.get("registry_province"), "marital_status": best.get("registry_marital_status"),
                "monthly_income": best.get("registry_income") if ConsentScope.INCOME in scopes else "[REDACTED — no consent]"}
    fields = ["full_name", "father_name", "cnic", "dob", "province", "monthly_income"]
    diff = []
    for f in fields:
        vals = {"input": data.get(f), "ocr": ocr.get(f) if ConsentScope.DOCUMENTS in scopes else None,
                "registry": registry.get(f) if f != "cnic" else (case.cnic if best else None)}
        present = [str(v).strip().lower() for v in vals.values() if v not in (None, "")]
        diff.append({"field": f, **vals, "mismatch": len(set(present)) > 1})
    scheme = db.get(Scheme, case.scheme_id)
    return {"case_id": case.id, "status": case.status, "scheme": scheme.name_en if scheme else None,
            "amount_pkr": scheme.amount_pkr if scheme else 0, "data": data, "diff": diff,
            "decision": {"id": d.id, "route": d.route, "probability": d.probability, "reason_user_en": d.reason_user_en,
                         "reason_user_ur": d.reason_user_ur} if d else None,
            "trace": trace, "consent_scopes": sorted(scopes)}
