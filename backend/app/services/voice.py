"""Bilingual Urdu/English voice service.

* Fixed UI prompts are pre-generated as static .mp3 files (scripts/generate_voice_assets.py) and
  served by the PWA from /audio/{lang}/{key}.mp3, so they play instantly with no network.
* Dynamic TTS uses gTTS when online (cached on disk by text hash); callers fall back to the
  browser's speechSynthesis when it is unavailable.
* STT: the browser's Web Speech API produces a transcript; this module normalises it (Urdu/Arabic-
  Indic digits, Urdu / Roman-Urdu / English number words, CNIC extraction, yes/no) and builds the
  mandatory confirmation read-back. Whisper is not bundled (kept lightweight; see README).
"""
import hashlib
import os
import re
from pathlib import Path

from app.services.cnic import normalize_cnic

REPO_ROOT = Path(__file__).resolve().parents[3]
# Pre-cached prompts live with the PWA; containers copy them in (override with VOICE_ASSETS_DIR).
AUDIO_DIR = Path(os.environ.get("VOICE_ASSETS_DIR") or REPO_ROOT / "frontend" / "public" / "audio")
TTS_CACHE = REPO_ROOT / "backend" / ".tts_cache"

PROMPTS: dict[str, dict[str, str]] = {
    "welcome": {"ur": "خوش آمدید۔ امداد کے لیے درخواست دینے کے لیے نیچے بڑا بٹن دبائیں۔",
                "en": "Welcome. Press the big button below to apply for relief."},
    "consent_ask": {"ur": "کیا آپ اجازت دیتی ہیں کہ افسر آپ کی معلومات دیکھ سکے؟ آپ یہ اجازت کسی بھی وقت واپس لے سکتی ہیں۔",
                    "en": "Do you allow the officer to see your information? You can take this permission back at any time."},
    "retake_photo": {"ur": "تصویر صاف نہیں ہے۔ براہ کرم روشنی میں فون ساکن رکھ کر دوبارہ تصویر لیں۔",
                     "en": "The photo is not clear. Please hold the phone still in good light and take it again."},
    "sent_to_officer": {"ur": "ہمیں یقین نہیں، اس لیے آپ کا کیس ایک افسر کو بھیج دیا گیا ہے۔ آپ کی درخواست مسترد نہیں ہوئی۔",
                        "en": "We are not sure, so your case has been sent to an officer. You have not been rejected."},
    "scam_warning": {"ur": "خبردار! یہ پیغام دھوکہ لگتا ہے۔ کوئی رقم یا کوڈ نہ بھیجیں۔",
                     "en": "Warning! This message looks like a scam. Do not send any money or codes."},
    "safe_message": {"ur": "یہ پیغام سرکاری لگتا ہے۔ پھر بھی کبھی کسی کو فیس یا پن نہ دیں۔",
                     "en": "This message looks official. Still, never give anyone a fee or your PIN."},
}


def asset_path(key: str, lang: str = "ur") -> Path:
    return AUDIO_DIR / lang / f"{key}.mp3"


def synthesize(text: str, lang: str = "ur") -> bytes:
    """Dynamic TTS via gTTS (network). Raises RuntimeError when offline."""
    TTS_CACHE.mkdir(parents=True, exist_ok=True)
    cached = TTS_CACHE / f"{hashlib.sha256(f'{lang}:{text}'.encode()).hexdigest()[:24]}.mp3"
    if cached.exists() and cached.stat().st_size > 0:
        return cached.read_bytes()
    try:
        from gtts import gTTS  # noqa: PLC0415
        gTTS(text=text, lang="ur" if lang == "ur" else "en").save(str(cached))
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"TTS unavailable: {e}") from e
    return cached.read_bytes()


# ----------------------------------------------------------------- STT normalisation
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
UNITS = {
    # Roman Urdu
    "sifar": 0, "ek": 1, "aik": 1, "do": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4, "panch": 5, "paanch": 5,
    "chay": 6, "chhe": 6, "che": 6, "saat": 7, "sat": 7, "aath": 8, "aat": 8, "nau": 9, "no": 9, "das": 10,
    "gyarah": 11, "barah": 12, "terah": 13, "chaudah": 14, "pandrah": 15, "solah": 16, "satrah": 17, "atharah": 18,
    "unnees": 19, "bees": 20, "pachees": 25, "pachis": 25, "tees": 30, "chalees": 40, "chalis": 40, "pachas": 50,
    "pachaas": 50, "saath": 60, "sattar": 70, "assi": 80, "nabbe": 90,
    # Urdu script
    "صفر": 0, "ایک": 1, "دو": 2, "تین": 3, "چار": 4, "پانچ": 5, "چھ": 6, "سات": 7, "آٹھ": 8, "نو": 9, "دس": 10,
    "گیارہ": 11, "بارہ": 12, "تیرہ": 13, "چودہ": 14, "پندرہ": 15, "سولہ": 16, "سترہ": 17, "اٹھارہ": 18, "انیس": 19,
    "بیس": 20, "پچیس": 25, "تیس": 30, "چالیس": 40, "پچاس": 50, "ساٹھ": 60, "ستر": 70, "اسی": 80, "نوے": 90,
    # English
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
MULTIPLIERS = {"sau": 100, "so": 100, "سو": 100, "hundred": 100, "hazar": 1000, "hazaar": 1000, "ہزار": 1000,
               "thousand": 1000, "lakh": 100000, "lac": 100000, "لاکھ": 100000}
YES = {"haan", "han", "ji", "jee", "yes", "sahi", "theek", "ہاں", "جی", "صحیح", "درست"}
NO = {"nahi", "nahin", "no_", "galat", "dobara", "نہیں", "غلط", "دوبارہ"}
HEDGES = re.compile(r"\b(shayad|taqreeban|lagbhag|about|around|maybe|kuch|تقریباً|شاید)\b", re.I)


def parse_number_words(tokens: list[str]) -> tuple[list[int], bool]:
    """Returns (numbers, ambiguous). 'do teen hazar' (two-three thousand) is ambiguous."""
    numbers, total, current, active, ambiguous, prev_unit = [], 0, 0, False, False, False
    for tok in tokens + ["<end>"]:
        if tok in UNITS:
            if prev_unit and UNITS[tok] < 10 and current < 10:
                ambiguous = True  # two bare units in a row, e.g. "do teen"
            current += UNITS[tok]
            active, prev_unit = True, True
        elif tok in MULTIPLIERS and active:
            m = MULTIPLIERS[tok]
            if m == 100:
                current = max(current, 1) * 100
            else:
                total += max(current, 1) * m
                current = 0
            prev_unit = False
        else:
            if active:
                numbers.append(total + current)
            total, current, active, prev_unit = 0, 0, False, False
    return numbers, ambiguous


def normalize_transcript(transcript: str, lang: str = "ur", field: str | None = None) -> dict:
    text = (transcript or "").translate(_DIGITS)
    clean = re.sub(r"[،,۔.!?؟]", " ", text)
    tokens = [t.lower() for t in clean.split()]
    digit_numbers = [int(n.replace(",", "")) for n in re.findall(r"\d[\d,]*", text) if len(n.replace(",", "")) <= 9]
    word_numbers, ambiguous = parse_number_words([t for t in tokens if not t.isdigit()])
    # "15 hazar" (digits + multiplier word)
    for m in re.finditer(r"(\d+)\s*(hazar|hazaar|ہزار|thousand|lakh|لاکھ)", text, re.I):
        val = int(m.group(1)) * MULTIPLIERS[m.group(2).lower()]
        if int(m.group(1)) in digit_numbers:
            digit_numbers.remove(int(m.group(1)))
        digit_numbers.append(val)
    numbers = digit_numbers + word_numbers

    spoken_digits = "".join(re.findall(r"\d", text))
    cnic = normalize_cnic(spoken_digits) if len(spoken_digits) == 13 else None
    yes_no = "yes" if YES & set(tokens) else ("no" if (NO & set(tokens)) or "nahi" in tokens else None)
    hedged = bool(HEDGES.search(text))
    ambiguous = ambiguous or hedged or (field in ("monthly_income", "age", "dependents") and len(set(numbers)) > 1)

    value = cnic if field == "cnic" else (numbers[0] if numbers else None)
    if ambiguous:
        confirm_en = "I did not understand the number clearly. Please say it again."
        confirm_ur = "میں نمبر صاف نہیں سمجھ سکی۔ براہ کرم دوبارہ بولیں۔"
    elif value is not None:
        confirm_en = f"You said {value}. Is that right? Press Haan Sahi Hai or Dobara Bolein."
        confirm_ur = f"آپ نے کہا {value}۔ کیا یہ صحیح ہے؟ 'ہاں صحیح ہے' یا 'دوبارہ بولیں' دبائیں۔"
    else:
        confirm_en = f"You said: {transcript}. Is that right?"
        confirm_ur = f"آپ نے کہا: {transcript}۔ کیا یہ صحیح ہے؟"
    return {"transcript": transcript, "normalized_text": text, "numbers": numbers, "value": value, "cnic": cnic,
            "yes_no": yes_no, "ambiguous": ambiguous, "needs_confirmation": True,
            "confirmation_en": confirm_en, "confirmation_ur": confirm_ur}
