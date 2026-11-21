"""Scam Shield regressions from live user testing (advance-fee lures in Urdu script / Roman Urdu, and
never presenting a low-risk message as a government message)."""
import pytest

from app.ml.scam_shield import advance_fee, check_sms

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
