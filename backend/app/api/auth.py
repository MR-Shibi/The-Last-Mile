from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import write_audit
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.security import create_tokens, decode_token, verify_password
from app.models import Tenant, User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


def _token_response(user: User) -> dict:
    return {**create_tokens(user.id, user.tenant_id, user.role), "role": user.role,
            "tenant_id": user.tenant_id, "user_id": user.id, "full_name": user.full_name}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)) -> dict:
    user = db.execute(select(User).where(User.username == body.username)).scalar()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        write_audit(db, "auth.login_failed", tenant_id=user.tenant_id if user else None,
                    payload={"username": body.username})
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    write_audit(db, "auth.login", tenant_id=user.tenant_id, actor_user_id=user.id, actor_role=user.role)
    return _token_response(user)


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)) -> dict:
    payload = decode_token(body.refresh_token, "refresh")
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active or user.role != payload.get("role"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    return _token_response(user)


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    tenant = db.get(Tenant, user.tenant_id)
    return {"id": user.id, "username": user.username, "role": user.role, "full_name": user.full_name,
            "tenant_id": user.tenant_id, "tenant_name": tenant.name if tenant else None,
            "cnic_last4": user.cnic[-6:].replace("-", "") if user.cnic else None}
