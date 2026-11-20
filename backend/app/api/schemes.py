from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_api_key
from app.models import ApiKey, Scheme, User

router = APIRouter(tags=["schemes"])


def scheme_out(s: Scheme) -> dict:
    return {"id": s.id, "code": s.code, "name_en": s.name_en, "name_ur": s.name_ur,
            "description_en": s.description_en, "description_ur": s.description_ur,
            "amount_pkr": s.amount_pkr, "icon": s.icon}


@router.get("/schemes")
def list_schemes(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(Scheme).where(Scheme.tenant_id == user.tenant_id, Scheme.active.is_(True))).scalars()
    return [scheme_out(s) for s in rows]


@router.get("/public/schemes", tags=["public-api"])
def public_schemes(key: ApiKey = Depends(require_api_key("schemes:read")), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.execute(select(Scheme).where(Scheme.tenant_id == key.tenant_id, Scheme.active.is_(True))).scalars()
    return [scheme_out(s) for s in rows]
