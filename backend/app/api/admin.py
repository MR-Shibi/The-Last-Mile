from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_db
from app.core.deps import require_roles
from app.core.security import generate_api_key
from app.models import ApiKey, Role, User
from app.services import faults

router = APIRouter(prefix="/admin", tags=["admin"])

API_KEY_SCOPES = {"schemes:read", "scam:check", "registry:qr"}


class FaultsIn(BaseModel):
    nadra_timeout: bool | None = None
    raast_error: bool | None = None
    force_low_ocr: bool | None = None


class ApiKeyIn(BaseModel):
    name: str
    scopes: list[str]
    rate_capacity: int = Field(default=20, ge=1, le=10000)
    rate_refill_per_sec: float = Field(default=5.0, ge=0, le=1000)


@router.get("/faults")
def get_faults(user: User = Depends(require_roles(Role.ADMIN, Role.AUDITOR))) -> dict:
    return faults.get_faults()


@router.post("/faults")
def set_faults(body: FaultsIn, user: User = Depends(require_roles(Role.ADMIN)), db: Session = Depends(get_db)) -> dict:
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    state = faults.set_faults(**updates)
    write_audit(db, "admin.faults_changed", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="faults", payload={"changed": updates, "state": state})
    return state


@router.post("/api-keys", status_code=201)
def create_api_key(body: ApiKeyIn, user: User = Depends(require_roles(Role.ADMIN)), db: Session = Depends(get_db)) -> dict:
    bad = set(body.scopes) - API_KEY_SCOPES
    if bad:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown scopes {sorted(bad)}")
    raw, prefix, digest = generate_api_key()
    key = ApiKey(tenant_id=user.tenant_id, name=body.name, key_prefix=prefix, key_hash=digest, scopes=body.scopes,
                 rate_capacity=body.rate_capacity, rate_refill_per_sec=body.rate_refill_per_sec)
    db.add(key)
    db.flush()
    write_audit(db, "admin.api_key_created", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="api_key", resource_id=key.id, payload={"prefix": prefix, "scopes": body.scopes},
                commit=False)
    db.commit()
    return {"id": key.id, "api_key": raw, "prefix": prefix, "scopes": key.scopes,
            "note": "Shown once. Only a SHA-256 hash is stored."}


@router.get("/api-keys")
def list_api_keys(user: User = Depends(require_roles(Role.ADMIN)), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(ApiKey).where(ApiKey.tenant_id == user.tenant_id)).scalars()
    return [{"id": k.id, "name": k.name, "prefix": k.key_prefix, "scopes": k.scopes, "active": k.active} for k in rows]
