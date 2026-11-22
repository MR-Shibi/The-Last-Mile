"""Shared-phone Helper Mode: family list with consent badges, per-family PIN unlock (audited switch)."""
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.consent import active_scopes
from app.core.database import get_db
from app.core.deps import require_roles
from app.core.ratelimit import limiter
from app.core.security import verify_password
from app.models import Case, HelperLink, Role, User
from app.services.cnic import normalize_cnic

router = APIRouter(prefix="/helper", tags=["helper"])


def _last4(cnic: str | None) -> str | None:
    return cnic.replace("-", "")[-4:] if cnic else None


class UnlockIn(BaseModel):
    pin: str = Field(min_length=4, max_length=8)
    from_citizen_user_id: int | None = None


class LockIn(BaseModel):
    citizen_user_id: int | None = None
    reason: str = "inactivity"


@router.get("/families")
def families(user: User = Depends(require_roles(Role.HELPER)), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(HelperLink, User).join(User, User.id == HelperLink.citizen_user_id)
                      .where(HelperLink.helper_user_id == user.id).order_by(User.full_name)).all()
    out = []
    for link, citizen in rows:
        scopes = active_scopes(db, citizen.id)
        n_cases = len(db.execute(select(Case.id).where(Case.citizen_user_id == citizen.id)).all())
        out.append({"citizen_user_id": citizen.id, "full_name": citizen.full_name, "cnic_last4": _last4(citizen.cnic),
                    "consent": {"helper_access": "helper_access" in scopes, "identity": "identity" in scopes,
                                "income": "income" in scopes, "documents": "documents" in scopes},
                    "cases": n_cases})
    return out


@router.post("/families/{citizen_user_id}/unlock")
def unlock(citizen_user_id: int, body: UnlockIn, user: User = Depends(require_roles(Role.HELPER)),
           db: Session = Depends(get_db)) -> dict:
    link = db.execute(select(HelperLink).where(HelperLink.helper_user_id == user.id,
                                               HelperLink.citizen_user_id == citizen_user_id)).scalar()
    if not link:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Family not linked to this helper")
    ok, _ = limiter.allow(f"helper-pin:{user.id}:{citizen_user_id}", 5, 1 / 60)
    if not ok:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many PIN attempts; try again later")
    if not verify_password(body.pin, link.family_pin_hash):
        write_audit(db, "helper.pin_failed", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                    resource_type="citizen", resource_id=citizen_user_id)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Wrong family PIN")
    citizen = db.get(User, citizen_user_id)
    scopes = active_scopes(db, citizen_user_id)
    write_audit(db, "helper.family_switch", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="citizen", resource_id=citizen_user_id,
                payload={"from_citizen_user_id": body.from_citizen_user_id, "to_citizen_user_id": citizen_user_id,
                         "helper_access": "helper_access" in scopes})
    return {"citizen_user_id": citizen.id, "full_name": citizen.full_name, "cnic_last4": _last4(citizen.cnic),
            "consent": {s: s in scopes for s in ("helper_access", "identity", "income", "documents")},
            "can_act": "helper_access" in scopes, "auto_lock_seconds": 120}


@router.post("/lock")
def lock(body: LockIn, user: User = Depends(require_roles(Role.HELPER)), db: Session = Depends(get_db)) -> dict:
    write_audit(db, "helper.locked", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="citizen", resource_id=body.citizen_user_id, payload={"reason": body.reason})
    return {"locked": True}


_REF = re.compile(r"^(?:LM-?\d{1,3}-?)?0*(\d{1,9})$", re.IGNORECASE)


@router.get("/lookup")
def lookup(q: str, user: User = Depends(require_roles(Role.HELPER)), db: Session = Depends(get_db)) -> dict:
    """Find one of THIS helper's linked families by full CNIC or Application ID (LM-01-000034 / 34).
    Unlinked citizens are indistinguishable from 'not found'; linked-but-unconsented ones come back locked."""
    raw = q.strip().replace(" ", "")
    citizen, case = None, None
    cnic = normalize_cnic(raw) if len(re.sub(r"\D", "", raw)) == 13 else None
    if cnic:
        citizen = db.execute(select(User).where(User.tenant_id == user.tenant_id, User.cnic == cnic,
                                                User.role == Role.CITIZEN)).scalar()
    elif (m := _REF.match(raw)):
        case = db.get(Case, int(m.group(1)))
        if case and case.tenant_id == user.tenant_id:
            citizen = db.get(User, case.citizen_user_id)
        else:
            case = None
    linked = citizen is not None and db.execute(select(HelperLink.id).where(
        HelperLink.helper_user_id == user.id, HelperLink.citizen_user_id == citizen.id)).first() is not None
    write_audit(db, "helper.lookup", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="citizen", resource_id=citizen.id if linked else None,
                payload={"kind": "cnic" if cnic else "reference", "found": linked})
    if not linked:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No linked family matches")
    scopes = active_scopes(db, citizen.id)
    consented = "helper_access" in scopes
    if case is None and consented:
        case = db.execute(select(Case).where(Case.citizen_user_id == citizen.id).order_by(Case.id.desc())).scalars().first()
    out = {"citizen_user_id": citizen.id, "full_name": citizen.full_name if consented else None,
           "cnic_last4": _last4(citizen.cnic), "consent": consented, "case": None}
    if case is not None and consented:
        out["case"] = {"id": case.id, "reference": f"LM-{case.tenant_id:02d}-{case.id:06d}", "status": case.status}
    return out
