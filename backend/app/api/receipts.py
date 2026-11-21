"""Citizen "Parchi" receipt: QR + 6-digit PIN + colour badge. The QR carries an HMAC so a forged
parchi is detectable; public verification reveals only status, never personal data."""
import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.cases import latest_decision
from app.core.config import get_settings
from app.core.consent import require_case_access
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.ratelimit import limiter
from app.models import Case, Decision, Role, Scheme, User

router = APIRouter(tags=["receipts"])

STATUS_BADGE = {
    "AUTO_RECOMMEND": ("green", "Recommended — awaiting officer's 1-tap confirmation", "منظوری کی سفارش — افسر کی تصدیق باقی"),
    "OFFICER_APPROVED": ("green", "Approved by officer", "افسر نے منظور کر لیا"),
    "PAID": ("green", "Paid", "ادائیگی ہو گئی"),
    "ASK_MORE_PROOF": ("yellow", "More proof needed", "مزید ثبوت درکار"),
    "OFFICER_REQUESTED_PROOF": ("yellow", "Officer asked for more proof", "افسر نے مزید ثبوت مانگا"),
    "ESCALATE_HUMAN": ("blue", "With a human officer — not rejected", "افسر کے پاس — مسترد نہیں"),
    "SUBMITTED": ("blue", "Submitted", "جمع ہو گئی"),
    "OFFICER_REJECTED": ("red", "Not approved by officer — you can appeal", "افسر نے منظور نہیں کیا — اپیل کر سکتی ہیں"),
}
AUDIO_FOR = {"ESCALATE_HUMAN": "sent_to_officer", "ASK_MORE_PROOF": "retake_photo"}


def qr_signature(case_id: int, pin: str) -> str:
    key = get_settings().jwt_secret.encode()
    return hmac.new(key, f"parchi:{case_id}:{pin}".encode(), hashlib.sha256).hexdigest()[:12]


def receipt_payload(db: Session, case: Case) -> dict:
    color, en, ur = STATUS_BADGE.get(case.status, ("blue", case.status, case.status))
    scheme = db.get(Scheme, case.scheme_id)
    d = latest_decision(db, case.id)
    officer_reason = None
    if d and str(d.get("decided_by", "")).startswith("officer:"):
        last = db.get(Decision, d["id"])
        officer_reason = ((last.trace_json or {}).get("reason") or None) if last else None
    return {"officer_reason": officer_reason, "decided_by_officer": bool(d and str(d.get("decided_by", "")).startswith("officer:")),"case_id": case.id, "reference": f"LM-{case.tenant_id:02d}-{case.id:06d}", "pin": case.receipt_pin,
            "status": case.status, "color": color, "status_en": en, "status_ur": ur,
            "scheme_en": scheme.name_en if scheme else None, "scheme_ur": scheme.name_ur if scheme else None,
            "amount_pkr": scheme.amount_pkr if scheme else None,
            "reason_en": d["reason_user_en"] if d else None, "reason_ur": d["reason_user_ur"] if d else None,
            "audio_key": AUDIO_FOR.get(case.status), "qr": f"LMPARCHI|{case.id}|{qr_signature(case.id, case.receipt_pin or '')}",
            "submitted_at": case.created_at.isoformat(), "notice": get_settings().prototype_banner}


@router.get("/cases/{case_id}/receipt")
def receipt(case_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    case = db.get(Case, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    if user.role not in (Role.CITIZEN, Role.HELPER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Receipts are for the citizen or their helper")
    require_case_access(db, user, case)
    return receipt_payload(db, case)


class VerifyIn(BaseModel):
    qr: str | None = None
    case_id: int | None = None
    pin: str | None = None


@router.post("/receipts/verify")
def verify_receipt(body: VerifyIn, request: Request, db: Session = Depends(get_db)) -> dict:
    ok, _ = limiter.allow(f"receipt:{request.client.host if request.client else 'x'}", 20, 0.5)
    if not ok:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts")
    case_id, sig = body.case_id, None
    if body.qr:
        parts = body.qr.split("|")
        if len(parts) != 3 or parts[0] != "LMPARCHI" or not parts[1].isdigit():
            return {"valid": False, "reason": "malformed_qr"}
        case_id, sig = int(parts[1]), parts[2]
    case = db.get(Case, case_id) if case_id else None
    if not case:
        return {"valid": False, "reason": "unknown_case"}
    if sig is not None and not hmac.compare_digest(sig, qr_signature(case.id, case.receipt_pin or "")):
        return {"valid": False, "reason": "forged_parchi"}
    if sig is None and body.pin != case.receipt_pin:
        return {"valid": False, "reason": "wrong_pin"}
    color, en, ur = STATUS_BADGE.get(case.status, ("blue", case.status, case.status))
    return {"valid": True, "reference": f"LM-{case.tenant_id:02d}-{case.id:06d}", "status": case.status,
            "color": color, "status_en": en, "status_ur": ur}
