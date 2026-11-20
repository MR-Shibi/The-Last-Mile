from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import verify_chain
from app.core.database import get_db
from app.core.deps import require_roles
from app.models import AuditLog, Role, User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/verify-chain")
def verify(user: User = Depends(require_roles(Role.AUDITOR, Role.ADMIN)), db: Session = Depends(get_db)) -> dict:
    return verify_chain(db)


@router.get("/logs")
def logs(action: str | None = None, limit: int = Query(200, le=1000),
         user: User = Depends(require_roles(Role.AUDITOR, Role.ADMIN)), db: Session = Depends(get_db)) -> list[dict]:
    q = select(AuditLog).where(AuditLog.tenant_id == user.tenant_id).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        q = q.where(AuditLog.action.like(f"{action}%"))
    return [{"id": r.id, "ts": r.ts, "action": r.action, "actor_user_id": r.actor_user_id, "actor_role": r.actor_role,
             "resource_type": r.resource_type, "resource_id": r.resource_id, "payload": r.payload,
             "prev_hash": r.prev_hash, "row_hash": r.row_hash} for r in db.execute(q).scalars()]
