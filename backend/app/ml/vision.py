"""Document forensics + OCR for CNIC photos.

Checks (all real computer vision on the uploaded pixels):
  * Sharpness  - OpenCV Laplacian variance (blurry -> retake tip)
  * Exposure   - mean brightness (dark) and saturated-pixel ratio (glare)
  * QR         - pyzbar when its native DLL is available, else OpenCV QRCodeDetector
  * Integrity  - SHA-256 (duplicate reuse checked by the caller against the DB),
                 editing-software metadata (EXIF/PNG Software tag) and an Error-Level-Analysis heuristic
  * OCR        - RapidOCR (ONNX, no system binary) -> structured Pydantic extraction.
                 Test fixtures may embed deterministic OCR output (PNG `lastmile_fixture` chunk).

Memory/CPU safety for small hosts (e.g. a 512 MB free-tier container): images are downscaled to
MAX_SIDE before any processing (huge files are decoded at reduced resolution), one RapidOCR singleton
runs one inference at a time on OCR_THREADS threads, gc runs after inference, results are cached per
image hash, and any engine failure becomes a `vision_engine_failure` flag (-> ESCALATE_HUMAN), never a crash.
"""
import gc
import hashlib
from collections import OrderedDict
import io
import json
import os
import re
import threading

import cv2
import numpy as np
from PIL import Image
from pydantic import BaseModel

VISION_VERSION = "lastmile-vision-v4 (opencv+qr+ela+rapidocr, <=1024px)"
MAX_SIDE = int(os.environ.get("VISION_MAX_SIDE", "1024"))
MAX_PIXELS_FULL_DECODE = 24_000_000  # larger files are decoded at 1/4 resolution straight away
OCR_THREADS = int(os.environ.get("OCR_THREADS", "1"))
_CACHE_SIZE = 32
BLUR_VAR_MIN = 120.0     # Laplacian variance below this = blurry
DARK_MEAN_MAX = 70.0     # mean grey below this = too dark
GLARE_RATIO_MAX = 0.35   # fraction of near-white (>=250) pixels above this = glare
EDIT_SOFTWARE = re.compile(r"photoshop|gimp|canva|picsart|snapseed|pixlr|lightroom|faceapp|remini", re.I)
CNIC_RE = re.compile(r"(\d{5})\s*-?\s*(\d{7})\s*-?\s*(\d)")
DOB_RE = re.compile(r"(\d{4}-\d{2}-\d{2}|\d{2}[./-]\d{2}[./-]\d{4})")

TIPS = {
    "blurry_photo": ("Hold the phone still, 20 cm from the card, and tap to focus.",
                     "فون کو ساکن رکھیں، کارڈ سے ایک بالشت دور، اور فوکس کے لیے اسکرین پر ٹیپ کریں۔"),
    "glare_photo": ("Turn off the flash and tilt the card away from the light.",
                    "فلیش بند کریں اور کارڈ کو روشنی سے تھوڑا ترچھا کریں۔"),
    "dark_photo": ("Move to daylight or a bright room and try again.",
                   "دن کی روشنی یا روشن کمرے میں جا کر دوبارہ کوشش کریں۔"),
    "low_ocr": ("Place the card on a plain dark surface so all text is visible.",
                "کارڈ کو سادہ گہری سطح پر رکھیں تاکہ تمام لکھائی نظر آئے۔"),
}


class CnicExtraction(BaseModel):
    cnic: str | None = None
    full_name: str | None = None
    father_name: str | None = None
    dob: str | None = None
    raw_lines: list[str] = []
    ocr_confidence: float = 0.0
    engine: str = "none"


_ocr_lock = threading.Lock()   # one engine, one inference at a time (bounded RAM)
_ocr_engine = None
_cache_lock = threading.Lock()
_cache: "OrderedDict[str, dict]" = OrderedDict()


def _new_engine():
    try:
        from rapidocr import RapidOCR  # noqa: PLC0415  (maintained 3.x package, Python 3.11-3.14)
    except ImportError:
        from rapidocr_onnxruntime import RapidOCR  # noqa: PLC0415  (legacy 1.x package)
        return RapidOCR()
    return RapidOCR(params={
        "Global.log_level": "warning",
        "Global.max_side_len": MAX_SIDE,
        "EngineConfig.onnxruntime.intra_op_num_threads": OCR_THREADS,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })


def _rapidocr():
    """Process-wide singleton (never reloaded per request). Caller must hold _ocr_lock."""
    global _ocr_engine
    if _ocr_engine is None:
        _ocr_engine = _new_engine()
    return _ocr_engine


def shrink(img: np.ndarray, max_side: int = MAX_SIDE) -> np.ndarray:
    h, w = img.shape[:2]
    scale = max_side / float(max(h, w))
    if scale >= 1:
        return img
    return cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)


def decode_image(data: bytes) -> np.ndarray:
    """Decode then downscale to MAX_SIDE. Very large images are decoded at reduced resolution so a
    phone's 48-MP photo can never blow the container's memory."""
    flag = cv2.IMREAD_COLOR
    try:
        w, h = Image.open(io.BytesIO(data)).size
        if w * h > MAX_PIXELS_FULL_DECODE:
            flag = cv2.IMREAD_REDUCED_COLOR_4
    except Exception:  # noqa: BLE001 - header sniffing is best-effort
        pass
    img = cv2.imdecode(np.frombuffer(data, np.uint8), flag)
    if img is None:
        raise ValueError("Not a decodable image")
    return shrink(img)


def read_metadata(data: bytes) -> dict:
    meta: dict = {}
    try:
        pil = Image.open(io.BytesIO(data))
        meta["format"] = pil.format
        info = dict(pil.info or {})
        if "lastmile_fixture" in info:
            meta["fixture"] = json.loads(info["lastmile_fixture"])
        software = info.get("Software")
        exif = pil.getexif() if hasattr(pil, "getexif") else None
        if exif and exif.get(0x0131):
            software = exif.get(0x0131)
        if software:
            meta["software"] = str(software)
    except Exception:  # noqa: BLE001 - metadata is best-effort
        pass
    return meta


def quality_checks(img: np.ndarray) -> dict:
    h, w = img.shape[:2]
    scale = 860.0 / max(w, 1)
    if abs(scale - 1) > 0.05:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Sharpness is measured on contrast-normalised grey so a dark-but-sharp photo is not called blurry.
    norm = cv2.normalize(grey, None, 0, 255, cv2.NORM_MINMAX)
    blur_var = float(cv2.Laplacian(norm, cv2.CV_64F).var())
    brightness = float(grey.mean())
    glare_ratio = float((grey >= 250).mean())
    flags = []
    if blur_var < BLUR_VAR_MIN:
        flags.append("blurry_photo")
    if brightness < DARK_MEAN_MAX:
        flags.append("dark_photo")
    if glare_ratio > GLARE_RATIO_MAX:
        flags.append("glare_photo")
    q_blur = min(1.0, blur_var / (BLUR_VAR_MIN * 2.5))
    q_dark = min(1.0, brightness / (DARK_MEAN_MAX * 1.4))
    q_glare = 1.0 if glare_ratio <= 0.1 else max(0.0, 1 - (glare_ratio - 0.1) / (GLARE_RATIO_MAX * 1.2))
    quality = min(q_blur, q_dark, q_glare)
    if flags:
        quality = min(quality, 0.45)  # any retake reason keeps quality below the 0.5 floor
    return {"blur_variance": round(blur_var, 1), "brightness": round(brightness, 1),
            "glare_ratio": round(glare_ratio, 4), "quality_score": round(quality, 4), "flags": flags}


def decode_qr(img: np.ndarray) -> list[str]:
    try:
        from pyzbar import pyzbar  # noqa: PLC0415
        found = [r.data.decode("utf-8", "ignore") for r in pyzbar.decode(img)]
        if found:
            return found
    except Exception:  # noqa: BLE001 - pyzbar needs a native DLL; fall back to OpenCV
        pass
    text, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return [text] if text else []


def ela_score(img: np.ndarray) -> float:
    """Error Level Analysis: re-compress and look for regions whose error level is far above the rest.
    Returns 0..1 (heuristic, deliberately conservative: it can only nudge the forgery score)."""
    ok, enc = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        return 0.0
    re_img = cv2.imdecode(enc, cv2.IMREAD_COLOR)
    diff = cv2.absdiff(img, re_img).astype(np.float32).mean(axis=2)
    h, w = diff.shape
    bs = 32
    blocks = [diff[y:y + bs, x:x + bs].mean() for y in range(0, h - bs + 1, bs) for x in range(0, w - bs + 1, bs)]
    if not blocks:
        return 0.0
    blocks = np.array(blocks)
    med = float(np.median(blocks)) + 0.5
    ratio = float(np.percentile(blocks, 99.5)) / med
    return float(np.clip((ratio - 12.0) / 18.0, 0.0, 1.0))


def forgery_assessment(img: np.ndarray, meta: dict) -> dict:
    software = meta.get("software", "")
    edited = bool(software and EDIT_SOFTWARE.search(software))
    ela = ela_score(img)
    score = max(0.85 if edited else 0.0, 0.5 * ela)
    return {"forgery_score": round(score, 4), "ela_score": round(ela, 4), "edit_software": software or None,
            "edited_metadata": edited}


def extract_fields(lines: list[str], confidence: float, engine: str) -> CnicExtraction:
    joined = "\n".join(lines)
    out = CnicExtraction(raw_lines=lines, ocr_confidence=round(confidence, 4), engine=engine)
    m = CNIC_RE.search(joined.replace(" ", ""))
    if m:
        out.cnic = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    d = DOB_RE.search(joined)
    if d:
        out.dob = d.group(1)
    for i, line in enumerate(lines):
        low = line.lower().strip()
        val = re.sub(r"^(father\s*name|name)\s*[:\-]?\s*", "", line, flags=re.I).strip()
        if low.startswith("father"):
            out.father_name = val or (lines[i + 1].strip() if i + 1 < len(lines) else None)
        elif low.startswith("name"):
            out.full_name = val or (lines[i + 1].strip() if i + 1 < len(lines) else None)
    return out


def run_ocr(img: np.ndarray, meta: dict) -> CnicExtraction:
    fixture = meta.get("fixture")
    mode = os.environ.get("OCR_ENGINE", "auto")
    if fixture and mode != "rapidocr":
        return extract_fields(list(fixture.get("lines", [])), float(fixture.get("ocr_confidence", 0.0)), "fixture")
    if mode == "fixture":
        return extract_fields([], 0.0, "none")
    try:
        with _ocr_lock:
            out = _rapidocr()(img)
    except (MemoryError, Exception):  # noqa: BLE001 - never crash the request: escalate to a human instead
        return extract_fields([], 0.0, "rapidocr-error")
    finally:
        gc.collect()
    if hasattr(out, "txts"):  # rapidocr >= 2: RapidOCROutput(txts, scores, boxes)
        lines, scores = list(out.txts or ()), [float(x) for x in (out.scores or ())]
    else:  # rapidocr_onnxruntime 1.x: ([box, text, score], ...), elapse
        result = out[0] or []
        lines, scores = [r[1] for r in result], [float(r[2]) for r in result]
    if not lines:
        return extract_fields([], 0.0, "rapidocr")
    return extract_fields(lines, float(np.mean(scores)), "rapidocr")


def _failure_result(sha: str, reason: str) -> dict:
    return {"sha256": sha,
            "quality": {"blur_variance": 0.0, "brightness": 0.0, "glare_ratio": 0.0, "quality_score": 0.0, "flags": []},
            "qr_codes": [], "forgery": {"forgery_score": 0.0, "ela_score": 0.0, "edit_software": None, "edited_metadata": False},
            "ocr": CnicExtraction(engine="vision-error").model_dump(), "flags": ["vision_engine_failure"],
            "retake_tips": [], "vision_version": VISION_VERSION, "error": reason}


def analyze_document(data: bytes) -> dict:
    """Full single-image analysis (no DB). Duplicate-hash and registry QR checks happen in the caller.
    Raises ValueError only for files that are not images; every engine failure becomes a flag."""
    sha = hashlib.sha256(data).hexdigest()
    with _cache_lock:
        if sha in _cache:  # the live photo check and the submit upload send the same bytes
            _cache.move_to_end(sha)
            return json.loads(json.dumps(_cache[sha]))
    try:
        img = decode_image(data)
    except MemoryError:
        gc.collect()
        return _failure_result(sha, "memory")
    try:
        meta = read_metadata(data)
        quality = quality_checks(img)
        qr = decode_qr(img)
        forgery = forgery_assessment(img, meta)
        ocr = run_ocr(img, meta)
    except (MemoryError, Exception) as e:  # noqa: BLE001
        gc.collect()
        return _failure_result(sha, type(e).__name__)
    finally:
        del img
    flags = list(quality["flags"])
    if ocr.engine == "rapidocr-error":
        flags.append("vision_engine_failure")
    elif ocr.ocr_confidence < 0.6 and not flags:
        flags.append("low_ocr")
    tips = [{"flag": f, "en": TIPS[f][0], "ur": TIPS[f][1]} for f in flags if f in TIPS]
    result = {"sha256": sha, "quality": quality, "qr_codes": qr, "forgery": forgery,
              "ocr": ocr.model_dump(), "flags": flags, "retake_tips": tips, "vision_version": VISION_VERSION}
    if "vision_engine_failure" not in flags:  # never cache a transient failure
        with _cache_lock:
            _cache[sha] = json.loads(json.dumps(result))
            while len(_cache) > _CACHE_SIZE:
                _cache.popitem(last=False)
    return result
