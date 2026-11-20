"""Password hashing, JWT access/refresh tokens and API-key hashing."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.core.config import get_settings


def hash_password(raw: str) -> str:
    rounds = get_settings().bcrypt_rounds
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt(rounds=rounds)).decode()


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:
        return False


def _encode(claims: dict, minutes: int, token_type: str) -> str:
    s = get_settings()
    now = datetime.now(timezone.utc)
    payload = {**claims, "type": token_type, "iat": now, "exp": now + timedelta(minutes=minutes),
               "jti": secrets.token_hex(8)}
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def create_tokens(user_id: int, tenant_id: int, role: str) -> dict:
    s = get_settings()
    claims = {"sub": str(user_id), "tenant_id": tenant_id, "role": role}
    return {
        "access_token": _encode(claims, s.access_token_minutes, "access"),
        "refresh_token": _encode(claims, s.refresh_token_minutes, "refresh"),
        "token_type": "bearer",
    }


def decode_token(token: str, expected_type: str = "access") -> dict | None:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except JWTError:
        return None
    if payload.get("type") != expected_type:
        return None
    return payload


def generate_api_key() -> tuple[str, str, str]:
    """Returns (raw_key, prefix, sha256_hash). Only the hash is persisted."""
    raw = "lmk_" + secrets.token_urlsafe(32)
    return raw, raw[:12], hash_api_key(raw)


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
