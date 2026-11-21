"""AI-layer endpoints: document upload + forensics, live photo check, Scam Shield, policy RAG, voice."""
import hashlib
import re
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.cases import latest_decision
from app.core.audit import write_audit
from app.core.consent import is_linked_helper, require_case_access
from app.core.database import get_db
from app.core.deps import bearer, get_current_user, require_api_key, require_roles
from app.core.ratelimit import limiter
from app.core.security import decode_token
from app.ml.scam_shield import answer_policy, check_sms
from app.ml.vision import analyze_document
from app.models import ApiKey, Case, Role, ScamReport, User
from app.services import voice
from app.services.case_pipeline import evaluate_case
from app.services.decision_engine import route as engine_route
from app.services.documents import cross_check, ingest_document

router = APIRouter(tags=["ai"])
MAX_UPLOAD = 8 * 1024 * 1024


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Empty file")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Image larger than 8 MB")
    return data


# ----------------------------------------------------------------- documents / vision
@router.post("/cases/{case_id}/documents", status_code=201)
async def upload_document(case_id: int, file: UploadFile = File(...),
                          user: User = Depends(require_roles(Role.CITIZEN, Role.HELPER)),
                          db: Session = Depends(get_db)) -> dict:
    case = db.get(Case, case_id)
    if not case:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Case not found")
    require_case_access(db, user, case)
    data = await _read_upload(file)
    try:
        doc, analysis = ingest_document(db, case, data)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    write_audit(db, "document.uploaded", tenant_id=case.tenant_id, actor_user_id=user.id, actor_role=user.role,
                resource_type="document", resource_id=doc.id,
                payload={"case_id": case.id, "sha256": doc.sha256, "flags": analysis["flags"]}, commit=False)
    if "prompt_injection" in analysis["flags"]:
        write_audit(db, "security.prompt_injection", tenant_id=case.tenant_id, actor_user_id=user.id,
                    actor_role=user.role, resource_type="document", resource_id=doc.id,
                    payload={"source": "ocr", "matches": analysis["checks"].get("ocr_injection", [])}, commit=False)
    db.commit()
    evaluate_case(db, case, actor=user)
    return {"document_id": doc.id, "sha256": doc.sha256, "flags": analysis["flags"], "checks": analysis["checks"],
            "quality": analysis["quality"], "retake_tips": analysis["retake_tips"],
            "ocr": {k: v for k, v in analysis["ocr"].items() if k != "raw_lines"},
            "forgery": analysis["forgery"], "decision": latest_decision(db, case.id)}


@router.post("/vision/check")
async def vision_check(file: UploadFile = File(...), cnic: str | None = None, citizen_user_id: int | None = None,
                       user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    """Live pre-submit check so the citizen gets an instant retake prompt. Nothing is stored.
    The photo's owner is the logged-in citizen, or (for a helper) a linked family passed as citizen_user_id."""
    data = await _read_upload(file)
    try:
        analysis = analyze_document(data)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e)) from e
    owner = None
    if user.role == Role.CITIZEN:
        owner = user.id
    elif user.role == Role.HELPER and citizen_user_id is not None and is_linked_helper(db, user.id, citizen_user_id):
        owner = citizen_user_id
    xc = cross_check(db, analysis, {"cnic": cnic}, None, owner_user_id=owner)
    preview = engine_route(0.99, True, xc["flags"])
    return {"flags": xc["flags"], "checks": xc["checks"], "quality": analysis["quality"],
            "retake_tips": analysis["retake_tips"], "ocr": {k: v for k, v in analysis["ocr"].items() if k != "raw_lines"},
            "suggested_route": preview["route"], "ok_to_submit": not xc["flags"]}


# ----------------------------------------------------------------- scam shield
class ScamIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _redact(text: str) -> str:
    return re.sub(r"\d[\d\- ]{6,}\d", "[NUM]", text)


def _optional_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User | None:
    if not creds:
        return None
    payload = decode_token(creds.credentials, "access")
    return db.get(User, int(payload["sub"])) if payload else None


def _run_scam_check(db: Session, text: str, tenant_id: int | None, user: User | None, channel: str) -> dict:
    result = check_sms(text)
    digest = hashlib.sha256(text.encode()).hexdigest()
    if result["injection_detected"]:
        write_audit(db, "security.prompt_injection", tenant_id=tenant_id, actor_user_id=user.id if user else None,
                    actor_role=user.role if user else channel, resource_type="sms", resource_id=digest[:16],
                    payload={"source": "sms", "matches": result["injection_matches"], "risk": "high"}, commit=False)
    if tenant_id is not None:
        db.add(ScamReport(tenant_id=tenant_id, reporter_user_id=user.id if user else None, text_hash=digest,
                          text_redacted=_redact(text)[:500], verdict=result["verdict"], probability=result["probability"],
                          details={"signals": result["signals"], "channel": channel}))
    db.commit()
    return result


@router.post("/scam/check")
def scam_check(body: ScamIn, request: Request, user: User | None = Depends(_optional_user),
               db: Session = Depends(get_db)) -> dict:
    """Open to shopkeepers without an account (IP rate-limited) and to logged-in users."""
    key = f"user:{user.id}" if user else f"ip:{request.client.host if request.client else 'unknown'}"
    ok, retry = limiter.allow(f"scam:{key}", 30, 1.0)
    if not ok:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded",
                            headers={"Retry-After": str(max(1, int(retry + 0.999)))})
    return _run_scam_check(db, body.text, user.tenant_id if user else None, user, "web")


@router.post("/public/scam/check", tags=["public-api"])
def public_scam_check(body: ScamIn, key: ApiKey = Depends(require_api_key("scam:check")), db: Session = Depends(get_db)) -> dict:
    return _run_scam_check(db, body.text, key.tenant_id, None, f"api_key:{key.key_prefix}")


class PolicyIn(BaseModel):
    question: str = Field(min_length=2, max_length=500)


@router.post("/policy/ask")
def policy_ask(body: PolicyIn) -> dict:
    return answer_policy(body.question)


# ----------------------------------------------------------------- voice
class TtsIn(BaseModel):
    key: str | None = None
    text: str | None = Field(default=None, max_length=600)
    lang: Literal["ur", "en"] = "ur"


class SttIn(BaseModel):
    transcript: str = Field(max_length=1000)
    lang: Literal["ur", "en"] = "ur"
    field: str | None = None


@router.get("/voice/prompts")
def voice_prompts() -> list[dict]:
    return [{"key": k, "text": v, "urls": {lang: f"/audio/{lang}/{k}.mp3" for lang in v},
             "cached": {lang: voice.asset_path(k, lang).exists() for lang in v}} for k, v in voice.PROMPTS.items()]


@router.post("/voice/tts")
def tts(body: TtsIn):
    if body.key:
        path = voice.asset_path(body.key, body.lang)
        if body.key not in voice.PROMPTS or not path.exists():
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown prompt key")
        return FileResponse(path, media_type="audio/mpeg", headers={"X-Audio-Source": "precached"})
    if not body.text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Provide key or text")
    try:
        audio = voice.synthesize(body.text, body.lang)
    except RuntimeError:
        return JSONResponse(status_code=503, content={"error": "TTS_UNAVAILABLE", "fallback": "browser_speech_synthesis",
                                                      "text": body.text, "lang": body.lang})
    return Response(content=audio, media_type="audio/mpeg", headers={"X-Audio-Source": "gtts"})


@router.post("/voice/stt")
def stt(body: SttIn) -> dict:
    return voice.normalize_transcript(body.transcript, body.lang, body.field)
