"""Free-tier hardening of the vision pipeline: downscaling, singleton OCR, cache, failure -> human."""
import io

import cv2
import numpy as np
import pytest
from PIL import Image
from sqlalchemy import func, select

from app.ml import vision
from app.ml.fixtures import fixture_meta, make_card
from app.models import Case, MockRegistry


def _big_jpeg(width: int = 4000) -> bytes:
    card = cv2.imdecode(np.frombuffer(make_card(qr_payload="QR-BIG"), np.uint8), cv2.IMREAD_COLOR)
    h = int(card.shape[0] * width / card.shape[1])
    big = cv2.resize(card, (width, h), interpolation=cv2.INTER_CUBIC)
    ok, enc = cv2.imencode(".jpg", big, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return enc.tobytes()


def test_large_phone_photo_is_downscaled_before_processing():
    data = _big_jpeg(4000)
    assert Image.open(io.BytesIO(data)).size[0] == 4000
    img = vision.decode_image(data)
    assert max(img.shape[:2]) <= vision.MAX_SIDE
    a = vision.analyze_document(data)
    assert a["qr_codes"] == ["QR-BIG"] and "blurry_photo" not in a["flags"]


def test_huge_image_decoded_at_reduced_resolution():
    data = _big_jpeg(7000)  # ~19 MP after aspect -> still decoded safely
    assert max(vision.decode_image(data).shape[:2]) <= vision.MAX_SIDE


def test_ocr_engine_is_a_singleton(monkeypatch):
    monkeypatch.setenv("OCR_ENGINE", "rapidocr")
    vision.analyze_document(make_card(noise_seed=11))
    first = vision._ocr_engine
    vision.analyze_document(make_card(noise_seed=12))
    assert first is not None and vision._ocr_engine is first


def test_repeat_image_reuses_cached_analysis(monkeypatch):
    calls = {"n": 0}
    real = vision.run_ocr

    def counting(img, meta):  # noqa: ANN001
        calls["n"] += 1
        return real(img, meta)
    monkeypatch.setattr(vision, "run_ocr", counting)
    data = make_card(noise_seed=4242, fixture_meta=fixture_meta("A", "B", "42101-1234567-1"))
    a1, a2 = vision.analyze_document(data), vision.analyze_document(data)
    assert calls["n"] == 1 and a1 == a2


def test_ocr_memory_error_escalates_instead_of_crashing(client, auth, db, monkeypatch):
    monkeypatch.setenv("OCR_ENGINE", "rapidocr")

    class Boom:
        def __call__(self, *_a, **_k):
            raise MemoryError("simulated OOM")
    monkeypatch.setattr(vision, "_ocr_engine", Boom())
    taken = set(db.execute(select(Case.cnic).where(Case.cnic.is_not(None))).scalars())
    dup = select(MockRegistry.cnic).group_by(MockRegistry.cnic).having(func.count(MockRegistry.id) > 1)
    rec = next(r for r in db.execute(select(MockRegistry).where(MockRegistry.data_quality_note == "clean",
                                                              MockRegistry.cnic.not_in(dup))).scalars() if r.cnic not in taken)
    h = auth("sindh.citizen")
    sid = next(s["id"] for s in client.get("/schemes", headers=h).json() if s["code"] == "widow-relief")
    case = client.post("/cases", headers=h, json={"scheme_id": sid, "data": {
        "full_name": rec.full_name, "father_name": rec.father_name, "cnic": rec.cnic, "age": 40, "province": "Sindh",
        "monthly_income": 15000, "is_widow": True, "dependents": 2, "receives_other_grant": False}}).json()
    r = client.post(f"/cases/{case['id']}/documents", headers=h,
                    files={"file": ("c.png", make_card(rec.full_name, rec.father_name or "", rec.cnic, noise_seed=77), "image/png")})
    assert r.status_code == 201
    body = r.json()
    assert "vision_engine_failure" in body["flags"]
    assert body["decision"]["route"] == "ESCALATE_HUMAN"
    assert "officer" in body["decision"]["reason_user_en"].lower()


@pytest.mark.parametrize("payload", [b"not an image", b""])
def test_non_images_still_rejected(client, auth, payload):
    r = client.post("/vision/check", headers=auth("sindh.citizen"), files={"file": ("x.png", payload, "image/png")})
    assert r.status_code == 422


def test_live_photo_check_does_not_flag_citizens_own_earlier_photo(client, auth, seeded):
    """Regression (found on the live deployment): re-using your own CNIC photo for a second application
    must not be called a duplicate; the same photo from a different citizen still must be."""
    fams = {f["username"]: f for f in seeded["tenants"]["sindh-spd"]["families"]}
    owner, stranger = fams["sindh.family04"], fams["sindh.family05"]
    img = make_card("Own Photo", "X", "42101-1234567-1", noise_seed=8080)
    h = auth(owner["username"])
    sid = next(s["id"] for s in client.get("/schemes", headers=h).json() if s["code"] == "widow-relief")
    case = client.post("/cases", headers=h, json={"scheme_id": sid, "data": {"full_name": "Own Photo"}}).json()
    assert client.post(f"/cases/{case['id']}/documents", headers=h, files={"file": ("c.png", img, "image/png")}).status_code == 201

    def check(headers, qs=""):
        return client.post(f"/vision/check{qs}", headers=headers, files={"file": ("c.png", img, "image/png")}).json()

    own = check(h)
    assert "duplicate_document" not in own["flags"] and own["checks"]["hash_reused_by_other_claims"] == 0
    assert "duplicate_document" in check(auth(stranger["username"]))["flags"]
    hh = auth("sindh.helper")  # shared phone: owner is the family named in the request (must be linked)
    assert "duplicate_document" not in check(hh, f"?citizen_user_id={owner['user_id']}")["flags"]
    assert "duplicate_document" in check(hh, f"?citizen_user_id={stranger['user_id']}")["flags"]
    assert "duplicate_document" in check(hh)["flags"]  # unknown owner -> conservative
