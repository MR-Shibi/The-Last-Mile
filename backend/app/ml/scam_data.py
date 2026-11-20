"""Deterministic synthetic SMS corpus (English, Roman Urdu, Urdu) for the Scam Shield classifier.
Label 1 = scam lure (advance fee, fake link, PIN/OTP harvesting, urgency); 0 = official-style notice.
All numbers, links and names are synthetic. '8171' is used as the simulated official short code."""
import random

AMOUNTS = ["25000", "12500", "10500", "9000", "14000", "30000"]
FEES = ["500", "1000", "1500", "300", "2000", "750"]
FAKE_LINKS = ["bit.ly/bisp-relief", "tinyurl.com/ehsaas-pay", "bisp-online-check.xyz", "relief-pk.top/claim",
              "8171-verify.info", "sindh-grant.click/apply"]
FAKE_NUMBERS = ["0301-5550123", "0345-5550199", "0312-5550777", "0333-5550456", "0300-5550888"]
NAMES = ["Shazia", "Rukhsana", "Nasreen", "Parveen", "Fatima", "Amina"]

SCAM_EN = [
    "Congratulations! You have won Rs {amt} BISP relief. Send Rs {fee} processing fee to {num} to receive it today.",
    "URGENT: Your relief payment of Rs {amt} will expire in 2 hours. Verify now at {link}",
    "Dear beneficiary, share your ATM PIN and CNIC with our agent at {num} to release Rs {amt}.",
    "Final notice! Pay Rs {fee} tax via JazzCash to {num} or your Rs {amt} grant will be cancelled.",
    "You are selected for Rs {amt} Ehsaas grant. Click {link} and enter your OTP code to claim.",
    "BISP lucky draw winner! Call {num} immediately and deposit Rs {fee} registration charges.",
    "Your account is blocked. Send the 4 digit code we sent you to {num} to unlock Rs {amt}.",
    "Govt relief Rs {amt} approved for {name}. Transfer Rs {fee} security deposit to Easypaisa {num}.",
]
SCAM_RU = [
    "Mubarak ho! {amt} BISP relief ke liye abhi {fee} fee bhejen {num} par.",
    "Aap ka Rs {amt} ka inaam nikla hai. Foran {fee} rupay Easypaisa karein {num}.",
    "Jaldi karein! Aaj raat tak {link} par CNIC aur PIN darj karein warna paisay wapas.",
    "Benazir program se {amt} rupay mil gaye. Agent {num} ko {fee} rupay processing fee dein.",
    "Apna ATM PIN aur OTP code is number {num} par bhejen taake {amt} ki raqam mil sake.",
    "Ehsaas lucky draw mein {name} ka naam aya hai. {fee} fee jama karwa kar {amt} hasil karein.",
    "Aap ki imdad {amt} rok di gayi hai. Fori {link} par click kar ke verify karein.",
    "Mubarak! Hukumat ki taraf se {amt} manzoor. Registration ke liye {fee} bhejna lazmi hai {num}.",
]
SCAM_UR = [
    "مبارک ہو! آپ کو {amt} روپے امداد ملی ہے۔ وصولی کے لیے {fee} روپے فیس {num} پر بھیجیں۔",
    "فوری توجہ! آپ کی {amt} روپے کی رقم آج ختم ہو جائے گی۔ ابھی {link} پر تصدیق کریں۔",
    "اپنا اے ٹی ایم پن اور شناختی کارڈ نمبر {num} پر بھیجیں تاکہ {amt} روپے جاری ہوں۔",
    "انعامی قرعہ اندازی میں آپ کا نام نکلا ہے۔ {fee} روپے رجسٹریشن فیس جمع کروائیں {num}۔",
    "حکومت کی طرف سے {amt} روپے منظور۔ ایزی پیسہ {num} پر {fee} روپے سیکیورٹی بھیجیں۔",
    "آپ کا او ٹی پی کوڈ ہمارے نمائندے کو {num} پر بتائیں ورنہ امداد منسوخ ہو جائے گی۔",
]

LEGIT_EN = [
    "8171: Your BISP payment of Rs {amt} is ready. Collect it at your designated campsite with your original CNIC. No fee is charged.",
    "8171: Your eligibility survey is complete. Results will be shared by SMS from 8171 only. Never share your PIN with anyone.",
    "Official notice from 8171: Payment for this quarter starts on Monday. Visit the nearest partner bank with your CNIC.",
    "8171: Your application is under review. You do not need to pay anyone. Helpline 0800-26477 (toll free).",
    "8171: Biometric verification is required at the payment point. Bring your original CNIC. This service is free.",
    "Sindh Social Protection: Your case reference {ref} has been received. An officer will contact you. No fee is required.",
    "8171: Reminder - payments are made only at authorised campsites and partner banks. Report fraud to 0800-26477.",
    "Punjab Relief Dept: Your flood recovery form is registered. Track status with your 6-digit receipt PIN on the app.",
]
LEGIT_RU = [
    "8171: Aap ki BISP qist Rs {amt} tayyar hai. Asal CNIC ke sath campsite se wasool karein. Koi fee nahi.",
    "8171: Aap ka survey mukammal ho gaya hai. Natija sirf 8171 se SMS par aayega. Apna PIN kisi ko na batayen.",
    "8171: Is qist ki adaigi peer se shuru hogi. Qareebi bank branch par asal CNIC ke sath jayen.",
    "8171: Aap ki darkhwast zair-e-ghaur hai. Kisi ko paisay dene ki zaroorat nahi. Helpline 0800-26477.",
    "Sindh Social Protection: Aap ka case number {ref} mil gaya hai. Officer aap se rabta karega. Koi fee nahi.",
    "8171: Adaigi sirf authorised campsite aur bank par hoti hai. Dhoka dahi ki report 0800-26477 par karein.",
]
LEGIT_UR = [
    "8171: آپ کی {amt} روپے کی قسط تیار ہے۔ اصل شناختی کارڈ کے ساتھ کیمپ سائٹ سے وصول کریں۔ کوئی فیس نہیں۔",
    "8171: آپ کا سروے مکمل ہو گیا ہے۔ نتیجہ صرف 8171 سے ایس ایم ایس پر آئے گا۔ اپنا پن کسی کو نہ بتائیں۔",
    "8171: آپ کی درخواست زیر غور ہے۔ کسی کو رقم دینے کی ضرورت نہیں۔ ہیلپ لائن 0800-26477۔",
    "8171: ادائیگی صرف مجاز کیمپ سائٹ اور بینک پر ہوتی ہے۔ دھوکہ دہی کی اطلاع 0800-26477 پر دیں۔",
    "سندھ سوشل پروٹیکشن: آپ کا کیس نمبر {ref} موصول ہو گیا ہے۔ افسر آپ سے رابطہ کرے گا۔ کوئی فیس نہیں۔",
]


def build_corpus(per_template: int = 5, seed: int = 2026) -> list[dict]:
    rng = random.Random(seed)
    rows: list[dict] = []
    groups = [(SCAM_EN, 1, "en"), (SCAM_RU, 1, "roman_ur"), (SCAM_UR, 1, "ur"),
              (LEGIT_EN, 0, "en"), (LEGIT_RU, 0, "roman_ur"), (LEGIT_UR, 0, "ur")]
    for templates, label, lang in groups:
        for t in templates:
            for _ in range(per_template):
                text = t.format(amt=rng.choice(AMOUNTS), fee=rng.choice(FEES), link=rng.choice(FAKE_LINKS),
                                num=rng.choice(FAKE_NUMBERS), name=rng.choice(NAMES), ref=f"LM-{rng.randint(10000, 99999)}")
                if rng.random() < 0.3:
                    text = text.upper() if lang == "en" and label == 1 else text
                rows.append({"text": text, "label": label, "lang": lang})
    rng.shuffle(rows)
    return rows
