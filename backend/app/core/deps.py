"""FastAPI security dependencies: JWT principal, RBAC, tenant isolation, API keys.

Security is enforced here on the server; the frontend hiding a button is never relied upon.
"""
from collections.abc import Callable

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_db
from app.core.ratelimit import limiter
from app.core.security import decode_token, hash_api_key
from app.models import ApiKey, Role, User

bearer = HTTPBearer(auto_error=False)
READ_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token",
                            headers={"WWW-Authenticate": "Bearer"})
    payload = decode_token(creds.credentials, "access")
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token",
                            headers={"WWW-Authenticate": "Bearer"})
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive")
    # Token claims must still match the DB (role/tenant changes invalidate old tokens).
    if user.tenant_id != payload.get("tenant_id") or user.role != payload.get("role"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Stale token")

    # Auditors are strictly read-only on every authenticated endpoint.
    if user.role == Role.AUDITOR and request.method not in READ_METHODS:
        write_audit(db, "rbac.denied", tenant_id=user.tenant_id, actor_user_id=user.id,
                    actor_role=user.role, resource_type="endpoint",
                    resource_id=f"{request.method} {request.url.path}",
                    payload={"reason": "auditor_read_only"})
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Auditor role is read-only")
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    allowed = set(roles)

    def _dep(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        if user.role not in allowed:
            write_audit(db, "rbac.denied", tenant_id=user.tenant_id, actor_user_id=user.id,
                        actor_role=user.role, resource_type="endpoint",
                        resource_id=f"{request.method} {request.url.path}",
                        payload={"required": sorted(allowed)})
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Role '{user.role}' not permitted")
        return user

    return _dep


def ensure_same_tenant(db: Session, user: User, resource_tenant_id: int, what: str, rid: int | str) -> None:
    """Cross-tenant access is always 403 (IDOR guard) and is audited."""
    if resource_tenant_id != user.tenant_id:
        # Logged under the *targeted* tenant so its auditor sees the attempt.
        write_audit(db, "tenant.idor_blocked", tenant_id=resource_tenant_id, actor_user_id=user.id,
                    actor_role=user.role, resource_type=what, resource_id=rid,
                    payload={"actor_tenant_id": user.tenant_id})
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-tenant access denied")


def require_api_key(scope: str) -> Callable[..., ApiKey]:
    def _dep(x_api_key: str | None = Header(default=None, alias="X-API-Key"),
             db: Session = Depends(get_db)) -> ApiKey:
        if not x_api_key:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing X-API-Key")
        key = db.execute(select(ApiKey).where(ApiKey.key_hash == hash_api_key(x_api_key))).scalar()
        if not key or not key.active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid API key")
        if scope not in (key.scopes or []):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"API key lacks scope '{scope}'")
        ok, retry = limiter.allow(f"apikey:{key.id}", key.rate_capacity, key.rate_refill_per_sec)
        if not ok:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded",
                                headers={"Retry-After": str(max(1, int(retry + 0.999)))})
        return key

    return _dep
