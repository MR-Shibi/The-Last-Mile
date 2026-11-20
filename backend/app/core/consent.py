"""Revocable consent gate.

Default is OFF: no consent row == no access. Every read of citizen data by a
community_helper or department_officer calls `require_case_access`, which re-checks the
database on *every request* (no caching), so a withdrawal takes effect on the very next call.
Denials and successful privileged reads are both written to the hash-chained audit log.
"""
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.models import Case, Consent, ConsentScope, HelperLink, Role, User


def active_scopes(db: Session, citizen_user_id: int) -> set[str]:
    rows = db.execute(
        select(Consent.scope).where(Consent.citizen_user_id == citizen_user_id, Consent.active.is_(True))
    ).scalars()
    return set(rows)


def has_consent(db: Session, citizen_user_id: int, scope: str) -> bool:
    return scope in active_scopes(db, citizen_user_id)


def is_linked_helper(db: Session, helper_id: int, citizen_id: int) -> bool:
    return db.execute(
        select(HelperLink.id).where(HelperLink.helper_user_id == helper_id,
                                    HelperLink.citizen_user_id == citizen_id)
    ).first() is not None


def _deny(db: Session, actor: User, citizen_id: int, resource: str, rid, reason: str, scope: str | None):  # noqa: ANN001
    write_audit(db, "consent.access_denied", tenant_id=actor.tenant_id, actor_user_id=actor.id,
                actor_role=actor.role, resource_type=resource, resource_id=rid,
                payload={"citizen_user_id": citizen_id, "reason": reason, "scope": scope})
    raise HTTPException(status.HTTP_403_FORBIDDEN, f"Access denied: {reason}")


def required_scope_for(role: str) -> str | None:
    if role == Role.HELPER:
        return ConsentScope.HELPER_ACCESS
    if role == Role.OFFICER:
        return ConsentScope.IDENTITY
    return None


def require_citizen_access(db: Session, actor: User, citizen: User, resource: str, rid) -> set[str]:  # noqa: ANN001
    """Authorise `actor` to read data belonging to `citizen`. Returns the citizen's active scopes
    (used for field-level redaction). Raises 403 (and audits) when not allowed."""
    if citizen.tenant_id != actor.tenant_id:
        _deny(db, actor, citizen.id, resource, rid, "cross_tenant", None)
    scopes = active_scopes(db, citizen.id)
    if actor.role == Role.CITIZEN:
        if actor.id != citizen.id:
            _deny(db, actor, citizen.id, resource, rid, "not_owner", None)
        return set(ConsentScope.ALL)
    if actor.role == Role.HELPER:
        if not is_linked_helper(db, actor.id, citizen.id):
            _deny(db, actor, citizen.id, resource, rid, "helper_not_linked", None)
        if ConsentScope.HELPER_ACCESS not in scopes:
            _deny(db, actor, citizen.id, resource, rid, "consent_withdrawn_or_missing", ConsentScope.HELPER_ACCESS)
    elif actor.role == Role.OFFICER:
        if ConsentScope.IDENTITY not in scopes:
            _deny(db, actor, citizen.id, resource, rid, "consent_withdrawn_or_missing", ConsentScope.IDENTITY)
    elif actor.role in (Role.ADMIN, Role.AUDITOR):
        # Oversight roles see redacted metadata only; never raw PII.
        return set()
    else:
        _deny(db, actor, citizen.id, resource, rid, "role_not_permitted", None)

    write_audit(db, "consent.access_granted", tenant_id=actor.tenant_id, actor_user_id=actor.id,
                actor_role=actor.role, resource_type=resource, resource_id=rid,
                payload={"citizen_user_id": citizen.id, "scopes": sorted(scopes)})
    return scopes


def require_case_access(db: Session, actor: User, case: Case) -> set[str]:
    if case.tenant_id != actor.tenant_id:
        from app.core.deps import ensure_same_tenant

        ensure_same_tenant(db, actor, case.tenant_id, "case", case.id)
    citizen = db.get(User, case.citizen_user_id)
    return require_citizen_access(db, actor, citizen, "case", case.id)


# Field -> consent scope needed to see it (officer/helper views are redacted accordingly).
FIELD_SCOPES = {
    "monthly_income": ConsentScope.INCOME,
    "household_income": ConsentScope.INCOME,
    "income_source": ConsentScope.INCOME,
    "documents": ConsentScope.DOCUMENTS,
}
REDACTED = "[REDACTED — no consent]"


def redact_case_data(data: dict, scopes: set[str], role: str) -> dict:
    if role == Role.CITIZEN:
        return dict(data)
    if role in (Role.ADMIN, Role.AUDITOR):
        return {k: REDACTED for k in data}
    out = {}
    for k, v in data.items():
        need = FIELD_SCOPES.get(k, ConsentScope.IDENTITY)
        if role == Role.HELPER and need == ConsentScope.IDENTITY:
            out[k] = v  # helper_access covers identity fields the helper typed in
        else:
            out[k] = v if need in scopes else REDACTED
    return out
