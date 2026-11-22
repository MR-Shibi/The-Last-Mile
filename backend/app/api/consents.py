import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.consent import is_linked_helper
from app.core.database import get_db
from app.core.deps import ensure_same_tenant, get_current_user, require_roles
from app.core.security import hash_password, verify_password
from app.models import Consent, ConsentScope, HelperLink, Role, User, utcnow

router = APIRouter(prefix="/consents", tags=["consent"])


class ConsentIn(BaseModel):
    scope: str
    citizen_user_id: int | None = None  # helper granting on behalf of a family (needs family_pin)
    family_pin: str | None = None


def consent_out(c: Consent) -> dict:
    return {"id": c.id, "citizen_user_id": c.citizen_user_id, "scope": c.scope, "active": c.active,
            "granted_via": c.granted_via, "granted_at": c.granted_at.isoformat(),
            "revoked_at": c.revoked_at.isoformat() if c.revoked_at else None}


@router.post("", status_code=201)
def grant_consent(body: ConsentIn, user: User = Depends(require_roles(Role.CITIZEN, Role.HELPER)),
                  db: Session = Depends(get_db)) -> dict:
    if body.scope not in ConsentScope.ALL:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown scope; allowed: {list(ConsentScope.ALL)}")
    if user.role == Role.CITIZEN:
        citizen, via = user, "self"
    else:
        # Shared phone: the family must be present and enter their own PIN.
        if not body.citizen_user_id or not body.family_pin:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "citizen_user_id and family_pin required")
        link = db.execute(select(HelperLink).where(HelperLink.helper_user_id == user.id,
                                                   HelperLink.citizen_user_id == body.citizen_user_id)).scalar()
        if not link or not verify_password(body.family_pin, link.family_pin_hash):
            write_audit(db, "consent.helper_pin_failed", tenant_id=user.tenant_id, actor_user_id=user.id,
                        actor_role=user.role, resource_type="citizen", resource_id=body.citizen_user_id)
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Family PIN check failed")
        citizen, via = db.get(User, body.citizen_user_id), "helper_pin"

    existing = db.execute(select(Consent).where(Consent.citizen_user_id == citizen.id, Consent.scope == body.scope,
                                                Consent.active.is_(True))).scalar()
    helper_info = None
    if user.role == Role.CITIZEN and body.scope == ConsentScope.HELPER_ACCESS:
        helper_info = link_community_helper(db, citizen)
    if existing:
        out = consent_out(existing)
        if helper_info:
            out.update(helper_info)
            db.commit()
        return out
    c = Consent(tenant_id=citizen.tenant_id, citizen_user_id=citizen.id, scope=body.scope, active=True, granted_via=via)
    db.add(c)
    db.flush()
    write_audit(db, "consent.granted", tenant_id=citizen.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="consent", resource_id=c.id,
                payload={"citizen_user_id": citizen.id, "scope": body.scope, "via": via}, commit=False)
    db.commit()
    out = consent_out(c)
    if helper_info:
        out.update(helper_info)
    return out


def link_community_helper(db: Session, citizen: User) -> dict | None:
    """'My community helper may help me' links the citizen to their department's community helper so the new
    application shows up in Helper Mode. The helper still needs a family PIN to open the record: a one-time PIN is
    returned to the citizen (shown once, stored hashed) when the link is first created. Existing links (and their
    family PINs) are never touched. Never links across tenants."""
    link = db.execute(select(HelperLink).where(HelperLink.citizen_user_id == citizen.id)
                      .order_by(HelperLink.id)).scalars().first()
    if link is not None:
        return None
    helper = db.execute(select(User).where(User.tenant_id == citizen.tenant_id, User.role == Role.HELPER,
                                           User.is_active.is_(True)).order_by(User.id)).scalars().first()
    if helper is None:
        return None
    link = HelperLink(tenant_id=citizen.tenant_id, helper_user_id=helper.id, citizen_user_id=citizen.id,
                      family_pin_hash="")
    db.add(link)
    pin = f"{secrets.randbelow(10**4):04d}"
    link.family_pin_hash = hash_password(pin)
    db.flush()
    write_audit(db, "helper.linked_by_consent", tenant_id=citizen.tenant_id, actor_user_id=citizen.id,
                actor_role=citizen.role, resource_type="citizen", resource_id=citizen.id,
                payload={"helper_user_id": link.helper_user_id}, commit=False)
    return {"helper_pin": pin, "helper_name": helper.full_name}


@router.get("")
def list_consents(citizen_user_id: int | None = None, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> list[dict]:
    q = select(Consent).where(Consent.tenant_id == user.tenant_id).order_by(Consent.id.desc())
    if user.role == Role.CITIZEN:
        q = q.where(Consent.citizen_user_id == user.id)
    elif user.role == Role.HELPER:
        if not citizen_user_id or not is_linked_helper(db, user.id, citizen_user_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Helper may only view linked families' consents")
        q = q.where(Consent.citizen_user_id == citizen_user_id)
    elif user.role in (Role.ADMIN, Role.AUDITOR, Role.OFFICER):
        if citizen_user_id:
            q = q.where(Consent.citizen_user_id == citizen_user_id)
    return [consent_out(c) for c in db.execute(q).scalars()]


@router.delete("/{consent_id}")
def revoke_consent(consent_id: int, user: User = Depends(require_roles(Role.CITIZEN, Role.HELPER)),
                   db: Session = Depends(get_db)) -> dict:
    c = db.get(Consent, consent_id)
    if not c:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Consent not found")
    ensure_same_tenant(db, user, c.tenant_id, "consent", c.id)
    allowed = (user.role == Role.CITIZEN and c.citizen_user_id == user.id) or (
        user.role == Role.HELPER and is_linked_helper(db, user.id, c.citizen_user_id))
    if not allowed:
        write_audit(db, "consent.revoke_denied", tenant_id=user.tenant_id, actor_user_id=user.id,
                    actor_role=user.role, resource_type="consent", resource_id=c.id)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your consent")
    if c.active:
        c.active = False
        c.revoked_at = utcnow()
        write_audit(db, "consent.revoked", tenant_id=c.tenant_id, actor_user_id=user.id, actor_role=user.role,
                    resource_type="consent", resource_id=c.id,
                    payload={"citizen_user_id": c.citizen_user_id, "scope": c.scope}, commit=False)
        db.commit()
    return consent_out(c)
