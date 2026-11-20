import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.consent import (FIELD_SCOPES, active_scopes, is_linked_helper, redact_case_data,
                              require_case_access, require_citizen_access)
from app.core.database import get_db
from app.core.deps import ensure_same_tenant, get_current_user, require_roles
from app.models import Case, CaseField, ConsentScope, HelperLink, Role, Scheme, User
from app.services.cnic import normalize_cnic

router = APIRouter(prefix="/cases", tags=["cases"])


class CaseIn(BaseModel):
    scheme_id: int
    citizen_user_id: int | None = None  # required when a helper submits on behalf of a family
    data: dict = Field(default_factory=dict)
    client_event_id: str | None = Field(default=None, max_length=80)


def case_out(case: Case, scopes: set[str], role: str) -> dict:
    return {
        "id": case.id,
        "tenant_id": case.tenant_id,
        "scheme_id": case.scheme_id,
        "citizen_user_id": case.citizen_user_id,
        "status": case.status,
        "data": redact_case_data(case.data or {}, scopes, role),
        "receipt_pin": case.receipt_pin if role in (Role.CITIZEN, Role.HELPER) else None,
        "client_event_id": case.client_event_id,
        "created_at": case.created_at.isoformat() if case.created_at else None,
    }


def create_case_record(db: Session, user: User, body: CaseIn) -> tuple[Case, bool]:
    """Shared by POST /cases and POST /sync. Returns (case, created_new). Idempotent on client_event_id."""
    if body.client_event_id:
        existing = db.execute(select(Case).where(Case.client_event_id == body.client_event_id)).scalar()
        if existing:
            ensure_same_tenant(db, user, existing.tenant_id, "case", existing.id)
            return existing, False

    scheme = db.get(Scheme, body.scheme_id)
    if not scheme:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scheme not found")
    ensure_same_tenant(db, user, scheme.tenant_id, "scheme", scheme.id)

    if user.role == Role.CITIZEN:
        citizen = user
    elif user.role == Role.HELPER:
        if not body.citizen_user_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "citizen_user_id required for helper submissions")
        citizen = db.get(User, body.citizen_user_id)
        if not citizen:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Citizen not found")
        require_citizen_access(db, user, citizen, "case_create", citizen.id)
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only citizens or helpers can submit cases")

    data = dict(body.data or {})
    if "cnic" in data:
        data["cnic"] = normalize_cnic(data["cnic"]) or data["cnic"]
    case = Case(tenant_id=user.tenant_id, scheme_id=scheme.id, citizen_user_id=citizen.id,
                created_by_user_id=user.id, status="SUBMITTED", cnic=data.get("cnic"),
                applicant_name=data.get("full_name"), data=data, client_event_id=body.client_event_id,
                receipt_pin=f"{secrets.randbelow(10**6):06d}")
    db.add(case)
    db.flush()
    for k, v in data.items():
        db.add(CaseField(tenant_id=case.tenant_id, case_id=case.id, key=k, value=None if v is None else str(v),
                         source="input", consent_scope=FIELD_SCOPES.get(k, ConsentScope.IDENTITY)))
    write_audit(db, "case.created", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="case", resource_id=case.id,
                payload={"citizen_user_id": citizen.id, "scheme_id": scheme.id,
                         "client_event_id": body.client_event_id}, commit=False)
    db.commit()
    from app.services.case_pipeline import evaluate_case  # local import avoids a cycle

    evaluate_case(db, case, actor=user)
    return case, True


def latest_decision(db: Session, case_id: int) -> dict | None:
    from app.models import Decision

    d = db.execute(select(Decision).where(Decision.case_id == case_id).order_by(Decision.id.desc()).limit(1)).scalar()
    if not d:
        return None
    return {"id": d.id, "route": d.route, "probability": d.probability, "reason_user_en": d.reason_user_en,
            "reason_user_ur": d.reason_user_ur, "rule_version_id": d.rule_version_id, "decided_by": d.decided_by}


@router.post("", status_code=201)
def create_case(body: CaseIn, user: User = Depends(require_roles(Role.CITIZEN, Role.HELPER)),
                db: Session = Depends(get_db)) -> dict:
    case, created = create_case_record(db, user, body)
    out = case_out(case, set(ConsentScope.ALL) if user.role == Role.CITIZEN else active_scopes(db, case.citizen_user_id), user.role)
    out["idempotent_replay"] = not created
    out["decision"] = latest_decision(db, case.id)
    return out


@router.get("")
def list_cases(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    q = select(Case).where(Case.tenant_id == user.tenant_id).order_by(Case.id.desc())
    if user.role == Role.CITIZEN:
        q = q.where(Case.citizen_user_id == user.id)
    elif user.role == Role.HELPER:
        linked = select(HelperLink.citizen_user_id).where(HelperLink.helper_user_id == user.id)
        q = q.where(Case.citizen_user_id.in_(linked))
    out = []
    for case in db.execute(q).scalars():
        scopes = active_scopes(db, case.citizen_user_id)
        if user.role == Role.HELPER and ConsentScope.HELPER_ACCESS not in scopes:
            out.append({"id": case.id, "status": case.status, "locked": True, "reason": "consent_missing"})
            continue
        if user.role == Role.OFFICER and ConsentScope.IDENTITY not in scopes:
            out.append({"id": case.id, "status": case.status, "locked": True, "reason": "consent_missing"})
            continue
        item = case_out(case, set(ConsentScope.ALL) if user.role == Role.CITIZEN else scopes, user.role)
        item["locked"] = False
        out.append(item)
    return out


@router.get("/{case_id}")
def get_case(case_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    case = db.get(Case, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    scopes = require_case_access(db, user, case)
    return case_out(case, scopes, user.role)


__all__ = ["router", "create_case_record", "case_out", "CaseIn", "is_linked_helper"]
