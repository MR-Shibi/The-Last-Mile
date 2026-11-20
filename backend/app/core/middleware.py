"""Global auditor write-block. Runs before routing so even unknown routes/methods return 403
for an auditor token (the per-endpoint dependency in deps.py is a second layer)."""
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.audit import write_audit
from app.core.database import SessionLocal
from app.core.security import decode_token
from app.models import Role

READ_METHODS = {"GET", "HEAD", "OPTIONS"}


class AuditorReadOnlyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        if request.method not in READ_METHODS and not request.url.path.startswith("/auth/"):
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                payload = decode_token(auth[7:].strip(), "access")
                if payload and payload.get("role") == Role.AUDITOR:
                    with SessionLocal() as db:
                        write_audit(db, "rbac.denied", tenant_id=payload.get("tenant_id"),
                                    actor_user_id=int(payload["sub"]), actor_role=Role.AUDITOR,
                                    resource_type="endpoint", resource_id=f"{request.method} {request.url.path}",
                                    payload={"reason": "auditor_read_only"})
                    return JSONResponse(status_code=403, content={"detail": "Auditor role is read-only"})
        return await call_next(request)
