"""Synthetic CNIC-card image generator (test fixtures + evaluation suite). All data is synthetic.

Cards can carry an optional PNG tEXt chunk `lastmile_fixture` (JSON) with deterministic OCR output,
which vision.py uses instead of running RapidOCR so tests stay fast and reproducible. Pixels are
still real, so blur / glare / darkness / QR / hash checks run on the actual image.
"""
import io
import json

import cv2
import numpy as np
import qrcode
from PIL import Image
from PIL.PngImagePlugin import PngInfo


def make_card(full_name: str = "Shazia Bibi", father_name: str = "Muhammad Ali Khan", cnic: str = "42101-1234567-1",
              dob: str = "1980-01-01", qr_payload: str | None = None, *, blur: int = 0, brightness: float = 1.0,
              glare: bool = False, fixture_meta: dict | None = None, software: str | None = None,
              noise_seed: int | None = None, fmt: str = "PNG") -> bytes:
    h, w = 540, 860
    img = np.full((h, w, 3), (232, 245, 236), np.uint8)
    cv2.rectangle(img, (0, 0), (w, 70), (46, 125, 50), -1)
    cv2.putText(img, "ISLAMIC REPUBLIC (SIMULATED) - SYNTHETIC CNIC", (18, 46), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
    cv2.rectangle(img, (30, 100), (230, 330), (180, 180, 180), -1)  # photo placeholder
    cv2.putText(img, "PHOTO", (85, 225), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (90, 90, 90), 2)
    lines = [("Name", full_name), ("Father Name", father_name), ("Identity Number", cnic), ("Date of Birth", dob)]
    y = 125
    for label, value in lines:
        cv2.putText(img, label, (260, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (60, 60, 60), 1)
        cv2.putText(img, value, (260, y + 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
        y += 88
    if qr_payload:
        q = np.array(qrcode.make(qr_payload, box_size=4, border=2).convert("RGB"))
        q = cv2.resize(q, (190, 190), interpolation=cv2.INTER_NEAREST)
        img[330:520, 650:840] = q
    if noise_seed is not None:  # makes otherwise-identical cards hash differently
        rng = np.random.default_rng(noise_seed)
        img = np.clip(img.astype(int) + rng.integers(-2, 3, img.shape), 0, 255).astype(np.uint8)
    if glare:
        overlay = img.copy()
        cv2.ellipse(overlay, (430, 270), (330, 210), 0, 0, 360, (255, 255, 255), -1)
        img = cv2.addWeighted(overlay, 0.92, img, 0.08, 0)
    if brightness != 1.0:
        img = np.clip(img.astype(float) * brightness, 0, 255).astype(np.uint8)
    if blur:
        k = blur if blur % 2 else blur + 1
        img = cv2.GaussianBlur(img, (k, k), 0)

    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    buf = io.BytesIO()
    if fmt.upper() == "PNG":
        info = PngInfo()
        if fixture_meta is not None:
            info.add_text("lastmile_fixture", json.dumps(fixture_meta))
        if software:
            info.add_text("Software", software)
        pil.save(buf, format="PNG", pnginfo=info)
    else:
        exif = Image.Exif()
        if software:
            exif[0x0131] = software
        pil.save(buf, format="JPEG", quality=92, exif=exif)
    return buf.getvalue()


def fixture_meta(full_name: str, father_name: str, cnic: str, dob: str = "1980-01-01", ocr_confidence: float = 0.95,
                 extra_text: str = "") -> dict:
    text = [f"Name {full_name}", f"Father Name {father_name}", f"Identity Number {cnic}", f"Date of Birth {dob}"]
    if extra_text:
        text.append(extra_text)
    return {"ocr_confidence": ocr_confidence, "lines": text}
