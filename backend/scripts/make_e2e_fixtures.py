"""Write deterministic browser-E2E fixtures to frontend/tests/fixtures/:
synthetic CNIC card PNGs (clean with valid registry QR, and blurry) + the matching applicant JSON.
Usage (from backend/): python scripts/make_e2e_fixtures.py
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.ml.fixtures import fixture_meta, make_card  # noqa: E402
from app.services.mock_registry_data import build_registry  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures"
VARIANT = {"Muhammad": "Muhammed", "Mohammad": "Muhammed", "Mohammed": "Muhammed", "Mohd": "Muhammed"}


def main() -> None:
    reg = build_registry()
    counts = Counter(r["cnic"] for r in reg)
    rec = next(r for r in reg if r["data_quality_note"] == "clean" and counts[r["cnic"]] == 1 and r["province"] == "Sindh"
               and r["gender"] == "F" and r["father_name"] and r["father_name"].split()[0] in VARIANT)
    first = rec["father_name"].split()[0]
    OUT.mkdir(parents=True, exist_ok=True)
    meta = fixture_meta(rec["full_name"], rec["father_name"], rec["cnic"], rec["dob"])
    (OUT / "cnic_clean.png").write_bytes(make_card(rec["full_name"], rec["father_name"], rec["cnic"], rec["dob"],
                                                   qr_payload=rec["qr_code"], fixture_meta=meta, noise_seed=7))
    (OUT / "cnic_blurry.png").write_bytes(make_card(rec["full_name"], rec["father_name"], rec["cnic"], rec["dob"],
                                                    qr_payload=rec["qr_code"], fixture_meta=meta, blur=17))
    # A phone-camera-sized JPEG (4000 px wide, no fixture text) -> exercises on-device shrinking + real OCR
    import cv2  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    card = cv2.imdecode(np.frombuffer(make_card(rec["full_name"], rec["father_name"], rec["cnic"], rec["dob"],
                                                qr_payload=rec["qr_code"], noise_seed=9), np.uint8), cv2.IMREAD_COLOR)
    big = cv2.resize(card, (4000, int(card.shape[0] * 4000 / card.shape[1])), interpolation=cv2.INTER_CUBIC)
    (OUT / "cnic_phone.jpg").write_bytes(cv2.imencode(".jpg", big, [cv2.IMWRITE_JPEG_QUALITY, 95])[1].tobytes())
    applicant = {"full_name": rec["full_name"], "father_name_registry": rec["father_name"],
                 "father_name_variant": rec["father_name"].replace(first, VARIANT[first], 1),
                 "cnic": rec["cnic"], "dob": rec["dob"], "age": 2026 - int(rec["dob"][:4])}
    (OUT / "applicant.json").write_text(json.dumps(applicant, indent=2), encoding="utf-8")
    print(json.dumps(applicant, indent=2))


if __name__ == "__main__":
    main()
