"""Scam Shield regressions from live user testing (advance-fee lures in Urdu script / Roman Urdu, and
never presenting a low-risk message as a government message)."""
import pytest

from app.ml.scam_data import build_corpus
from app.ml.scam_shield import SCAM_INDICATORS, advance_fee, check_sms, risk_signals

ADVANCE_FEE_UR = "آپ کو 10 ہزار روپے ملے ہیں آپ ان 10 ہزار روپے میں سے ہمیں 200 روپے بھیج دیں تاکہ ہم آپ کو یہ 10 ہزار بھیج سکیں"
ADVANCE_FEE_UR_LONG = ("آپ کو 10 ہزار روپے ملے ہیں آپ ان 10 ہزار روپے میں سے آپ ایسے کریں ہمیں 200 روپے بھیج دیں "
                       "تاکہ ہم آپ کو یہ 10 ہزار بھیج سکیں")
CASUAL_UR = "بھائی کل دکان پر آ جانا"
GOV_VERDICTS = {"OFFICIAL_STYLE_NOTICE"}


@pytest.mark.parametrize("text", [
    ADVANCE_FEE_UR,
    ADVANCE_FEE_UR_LONG,
    "مبارک ہو آپ کا بونس 25 ہزار منظور ہوا ہے، ایڈوانس ٹیکس 500 روپے جمع کرائیں",
    "آپ کا انعام تیار ہے، چارجز 300 روپے ایزی پیسہ کر دیں",
    "Aap ko 10 hazar mile hain, 200 rupay bhej dein",
    "Kafalat bonus 25000 aap ke naam, advance tax 500 jazzcash karein",
    "You won a prize of Rs 25000. Pay Rs 500 fee to release it.",
])
def test_advance_fee_lures_are_scam_never_uncertain(text):
    r = check_sms(text)
    assert r["verdict"] == "SCAM", (text, r["verdict"], r["probability"])
    assert r["probability"] >= 0.94 and "advance_fee" in r["signals"]
    assert r["citations"][0]["section"] == "No Fee Is Ever Charged"
    assert r["color"] == "red" and "کوئی فیس یا رقم نہ بھیجیں" in r["headline_ur"]


@pytest.mark.parametrize("text", [CASUAL_UR, "بھائی کیا حال ہے", "asdf qwerty random text", "Kal milte hain inshallah"])
def test_casual_text_is_not_a_government_message(text):
    r = check_sms(text)
    assert r["verdict"] == "NOT_A_GOV_MESSAGE", (text, r["verdict"])
    assert r["verdict"] not in GOV_VERDICTS and r["color"] == "neutral"
    assert "نہیں ہے" in r["headline_ur"]


def test_official_style_requires_markers_and_never_claims_certainty():
    r = check_sms("8171: Aap ki BISP qist Rs 25000 tayyar hai. Asal CNIC ke sath campsite se wasool karein. Koi fee nahi.")
    assert r["verdict"] == "OFFICIAL_STYLE_NOTICE" and r["color"] == "green"
    assert "8171" in r["headline_ur"] and "8171" in r["headline_en"]
    for v in (r, check_sms(CASUAL_UR), check_sms(ADVANCE_FEE_UR)):
        text = " ".join([v["headline_en"], v["headline_ur"], *v["reasons_en"], *v["reasons_ur"]])
        assert "100%" not in text and "guaranteed" not in text.lower().replace("not a guarantee", "")


@pytest.mark.parametrize("text", [
    "8171: Your BISP payment of Rs 25000 is ready. Collect it at your designated campsite with your original CNIC. No fee is charged.",
    "Sindh Social Protection: Your application LM-12345 is being reviewed by an officer. You do not need to pay anything.",
    "8171 بے نظیر انکم سپورٹ: آپ کی 25000 روپے کی قسط کیمپ سائٹ پر دستیاب ہے۔ کسی کو رقم دینے کی ضرورت نہیں۔",
])
def test_protective_official_wording_does_not_trigger_advance_fee(text):
    assert advance_fee(text) is False
    assert check_sms(text)["verdict"] == "OFFICIAL_STYLE_NOTICE"


def test_api_returns_new_verdicts(client):
    a = client.post("/scam/check", json={"text": ADVANCE_FEE_UR}).json()
    b = client.post("/scam/check", json={"text": CASUAL_UR}).json()
    assert a["verdict"] == "SCAM" and b["verdict"] == "NOT_A_GOV_MESSAGE"
    assert {"headline_en", "headline_ur", "color"} <= set(a) and b["color"] == "neutral"


# ------------------------------------------------------------------ relief notices are never SCAM without a red flag
PM_SCHEME = ("السلام علیکم اپ کے نمبر ڈیش پر 2000 روپے پرائم منسٹر سکیم سے ریسیو ہو گئے ہیں، اپ اس کو ریسیو کرنے کے لیے "
             "کسی بھی نزدیک کمیونیکیشن سٹور سے ریسیو کر سکتے ہیں یا ان لائن پیمنٹ فارم یا ان لائن پلیٹ فارم پر جا کر اپ "
             "ان لائن پیمنٹ بھی ریسیو کر سکتے ہیں")


def test_1_prime_minister_scheme_payout_is_never_scam():
    r = check_sms(PM_SCHEME)
    assert r["verdict"] in {"UNCERTAIN_HUMAN_REVIEW", "OFFICIAL_STYLE_NOTICE"}, r["verdict"]
    assert r["scam_indicators"] == []
    # no 8171 + an unspecified "online platform" -> needs verification, with the specific Urdu guidance
    assert r["verdict"] == "UNCERTAIN_HUMAN_REVIEW" and 0.40 <= r["probability"] <= 0.65
    assert "آن لائن پلیٹ فارم استعمال کرنے سے پہلے 8171" in r["reasons_ur"][0]


def test_1b_held_out_paraphrase_with_apne_is_never_scam():
    # "اپنے" contains the letters of "پن" (PIN): must not be read as a PIN request
    r = check_sms("وزیر اعظم پیکج: آپ کے لیے 3000 روپے جاری ہوئے ہیں، اپنے قریبی ریٹیلر سے وصول کریں")
    assert r["verdict"] != "SCAM" and "pin_otp_request" not in r["signals"]


def test_2_8171_biometric_shop_collection_is_official_notice():
    r = check_sms("8171: آپ کی 10500 روپے کی قسط تیار ہے۔ قریبی دکان پر بائیومیٹرک تصدیق کے بعد وصول کریں۔")
    assert r["verdict"] == "OFFICIAL_STYLE_NOTICE" and r["color"] == "green"


def test_3_ten_thousand_send_two_hundred_is_still_scam():
    r = check_sms(ADVANCE_FEE_UR)
    assert r["verdict"] == "SCAM" and "advance_fee" in r["scam_indicators"]


@pytest.mark.parametrize("text", ["ہائے", "ہیلو", "Hi", "Hello bhai", "Kal 5000 rupay ka saman le aana"])
def test_4_casual_greetings_are_not_government_messages(text):
    assert check_sms(text)["verdict"] == "NOT_A_GOV_MESSAGE"


@pytest.mark.parametrize("text,indicator", [
    ("پرائم منسٹر سکیم: 2000 روپے وصول کرنے کے لیے اپنا پن کوڈ بتائیں", "pin_otp_request"),
    ("BISP: aap ki raqam block ho jayegi agar aaj verify na kiya", "threat"),
    ("Prime Minister scheme ki raqam ke liye is number par WhatsApp karein", "personal_number"),
    ("Ehsaas raqam claim karein: bisp-online.blogspot.com", "suspicious_link"),
    ("شناختی کارڈ کی تصویر بھیجیں تاکہ 2000 روپے جاری ہوں", "pin_otp_request"),
])
def test_each_concrete_indicator_is_detected(text, indicator):
    assert indicator in check_sms(text)["scam_indicators"]


def test_gov_pk_links_are_not_suspicious():
    assert "suspicious_link" not in risk_signals("Details: https://www.bisp.gov.pk/payments")["signals"]
    assert "suspicious_link" in risk_signals("Details: https://bisp-payments.xyz")["signals"]


def test_property_no_scam_verdict_without_a_concrete_indicator():
    """Relief wording alone can never produce SCAM, whatever the classifier thinks."""
    texts = [x["text"] for x in build_corpus()] + [PM_SCHEME, "مبارک ہو آپ کو انعام ملا ہے", "Prime Minister scheme se 5000 rupay receive ho gaye"]
    for t in texts:
        r = check_sms(t)
        if r["verdict"] == "SCAM":
            assert set(r["scam_indicators"]) & SCAM_INDICATORS, t
        if not r.get("scam_indicators"):
            assert r["verdict"] != "SCAM", t
