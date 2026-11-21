"""Shopkeeper Scam Shield: prompt-injection guardrail + TF-IDF/LogReg classifier + explainable
bilingual risk signals + TF-IDF RAG over official (simulated) policy markdown with citations.

Untrusted text (SMS / OCR) is treated strictly as data. Control directives such as "ignore rules"
or "set confidence 0.99" are neutralised before any processing and logged as high-risk anomalies;
they can never change a verdict in the sender's favour.
"""
import re
import threading
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline

from app.ml.scam_data import build_corpus

MODEL_VERSION = "scamshield-tfidf-lr-v2 (advance-fee rule)"
SCAM_THRESHOLD = 0.70
UNCERTAIN_LOW = 0.35
ADVANCE_FEE_FLOOR = 0.94
SCAM, UNCERTAIN = "SCAM", "UNCERTAIN_HUMAN_REVIEW"
NOT_GOV, OFFICIAL_STYLE = "NOT_A_GOV_MESSAGE", "OFFICIAL_STYLE_NOTICE"
# Low risk is NOT proof of authenticity: a low-risk message is only "official-style" when it also carries
# the verified relief markers below; anything else is simply "not a government relief message".
VERDICT_UI = {
    SCAM: ("red", "Danger: this is a scam/spam message — do not send any fee or money.",
           "خطرہ: یہ دھوکہ دہی (Scam/Spam) کا پیغام ہے — کوئی فیس یا رقم نہ بھیجیں"),
    UNCERTAIN: ("amber", "Not sure — verify with the government office or 8171 before acting.",
                "تصدیق نہیں ہو سکی (Not Sure) — سرکاری دفتر یا 8171 سے تصدیق کریں"),
    NOT_GOV: ("neutral", "This is not a government relief message.",
              "یہ سرکاری امدادی پیغام نہیں ہے (Not a Government Relief Message)"),
    OFFICIAL_STYLE: ("green", "Official-style information message (please verify only via 8171). Not a guarantee.",
                     "سرکاری طرز کا معلوماتی پیغام (براہِ کرم صرف 8171 سے تصدیق کریں)"),
    "BLOCKED_PROMPT_INJECTION": ("red", "Blocked: this message tries to manipulate the checker.",
                                 "روک دیا گیا: یہ پیغام جانچنے والے نظام کو دھوکہ دینے کی کوشش کرتا ہے"),
}
POLICY_DIR = Path(__file__).parent / "policies"

# ----------------------------------------------------------------- injection guardrail
INJECTION_PATTERNS = [
    r"ignore\s+(all\s+|the\s+|any\s+|previous\s+|prior\s+)*(rules|instructions|policy|policies|checks)",
    r"disregard\s+(all\s+|the\s+|previous\s+)*(rules|instructions)",
    r"system\s*(override|prompt|message|instruction)",
    r"set\s+(the\s+)?(confidence|score|probability|p)\s*(to|=|:)?\s*0?\.\d+",
    r"(confidence|score|probability)\s*[=:]\s*0?\.\d+",
    r"approve\s+(this\s+|me\s+|the\s+case\s+)?(immediately|now|automatically)",
    r"(auto|force)[\s_-]?approv",
    r"you\s+are\s+now\s+",
    r"act\s+as\s+(an?\s+)?(admin|officer|system)",
    r"developer\s+mode|jailbreak|do\s+anything\s+now",
    r"<\s*/?\s*(system|assistant|instruction)\s*>",
    r"mark\s+(as\s+)?(safe|verified|eligible)",
    r"rules?\s+ko\s+(ignore|nazar\s*andaz)",
    r"foran\s+manzoor|fori\s+manzoor|approve\s+kar(o|ein|en)",
    r"قوانین\s+کو\s+نظر\s+انداز|فوراً\s+منظور",
]
_INJ = [re.compile(p, re.I) for p in INJECTION_PATTERNS]


def detect_injection(text: str | None) -> dict:
    text = text or ""
    matches: list[str] = []
    sanitized = text
    for rx in _INJ:
        for m in rx.finditer(text):
            matches.append(m.group(0))
        sanitized = rx.sub("[NEUTRALIZED]", sanitized)
    return {"injection": bool(matches), "matches": matches, "sanitized_text": sanitized}


# ----------------------------------------------------------------- explainable risk signals
SIGNALS = {
    "fee_request": (r"\bfee\b|charges?|deposit|\btax\b|advance|bhej(en|na|o|ein|\s*d(ein|o|e))|jama\s*kar|processing|registration\s+charge"
                    r"|فیس|بھیجیں|بھیج\s*د(یں|و|ے)|بھجوا|جمع\s*(کروائیں|کرائیں|کرا\s*دیں)|ٹیکس|ایڈوانس|چارجز|سیکیورٹی"
                    r"|easypaisa|jazzcash|ایزی\s*پیسہ|جاز\s*کیش",
                    0.6, ("Asks you to pay a fee or send money first.", "پہلے فیس یا رقم بھیجنے کو کہتا ہے۔")),
    "pin_otp_request": (r"\bpin\b|\botp\b|verification\s+code|4\s*digit\s+code|password|account\s+number"
                        r"|پن|پن\s*کوڈ|او\s*ٹی\s*پی|اکاؤنٹ\s*نمبر|اکاونٹ\s*نمبر",
                        0.5, ("Asks for your PIN or OTP code.", "آپ کا پن یا او ٹی پی کوڈ مانگتا ہے۔")),
    "suspicious_link": (r"https?://|www\.|bit\.ly|tinyurl|\b[\w-]+\.(com|net|org|site|xyz|top|click|info|online|live|link|pk|me)\b"
                        r"|/claim|/apply",
                        0.4, ("Contains a link that is not official.", "اس میں غیر سرکاری لنک ہے۔")),
    "urgency": (r"urgent|immediately|final\s+notice|expire|within\s+\d+\s+hours|foran|jaldi|fori|warna|فوری|ختم\s+ہو\s+جائے",
                0.2, ("Creates panic or a deadline.", "جلدی یا ڈر پیدا کرتا ہے۔")),
    "prize_lure": (r"\bwon\b|winner|lucky\s+draw|inaam|bonus|congratulations|mubarak|انعام|بونس|قرعہ|مبارک",
                   0.2, ("Promises a prize or lucky draw.", "انعام یا قرعہ اندازی کا وعدہ کرتا ہے۔")),
    "personal_number": (r"\b03\d{2}[-\s]?\d{7}\b", 0.25, ("Sent from or asks you to call a personal mobile number.",
                                                         "ذاتی موبائل نمبر سے آیا ہے یا اس پر رابطے کو کہتا ہے۔")),
}
OFFICIAL_MARKERS = r"^\s*8171\b|no\s+fee|koi\s+fee\s+nahi|کوئی\s+فیس\s+نہیں|0800-26477|never\s+share|kisi\s+ko\s+na\s+batayen"
_SIG = {k: (re.compile(p, re.I), w, txt) for k, (p, w, txt) in SIGNALS.items()}
_OFFICIAL = re.compile(OFFICIAL_MARKERS, re.I)
# Verified relief markers required before a low-risk message may be called "official-style".
_OFFICIAL_RELIEF = re.compile(
    r"\b8171\b|\bBISP\b|benazir\s+income\s+support|بے\s*نظیر\s*انکم\s*سپورٹ|بینظیر\s*انکم\s*سپورٹ"
    r"|کوئی\s+فیس\s+نہیں|koi\s+fee\s+nahi|no\s+fee|sindh\s+social\s+protection|punjab\s+relief\s+dept|سندھ\s+سوشل\s+پروٹیکشن", re.I)

# Advance-fee fraud = a promise of money/prize/relief + a request to send/pay money back first.
_PROMISE = re.compile(
    r"ملے\s*ہیں|ملے\s*ہے|ملیں\s*گے|روپے\s*ملے|مبارک|بونس|انعام|امداد|وظیفہ|قرعہ|\d[\d,]*\s*ہزار|\d[\d,]*\s*روپے"
    r"|mubarak|bonus|inaam|relief|kafalat|prize|\bwon\b|winner|lucky\s+draw|grant|\bmil(e|ay|a)\s+(hain|hai|gaye)"
    r"|\d[\d,]*\s*hazar|\brs\.?\s*\d|\d[\d,]*\s*rupay", re.I)
_SEND_BACK = re.compile(
    r"بھیج\s*د(یں|و|ے)|بھیجیں|بھجوا|جمع\s*(کرائیں|کروائیں|کرا\s*دیں)|ادائیگی\s*(کریں|کرائیں|کر\s*دیں)|فیس|ٹیکس|ایڈوانس|چارجز"
    r"|ایزی\s*پیسہ|جاز\s*کیش|bhej(en|ein|o|na|\s*d(ein|o|e))|\bsend\b|transfer|\bpay\b|\bfee\b|\btax\b|advance|charges"
    r"|easypaisa|jazzcash|jama\s*kar", re.I)
# Protective phrasing used by genuine notices ("no fee", "you do not need to pay anyone")...
_PROTECTIVE = re.compile(
    r"کوئی\s+فیس\s+نہیں|رقم\s+دینے\s+کی\s+ضرورت\s+نہیں|koi\s+(fee|charges)\s+nahi|no\s+(fee|charges)"
    r"|(do\s+not|don't|never|no\s+need\s+to)\s+(need\s+to\s+)?pay|paisay\s+na\s+dein|muft|free\s+of\s+charge|is\s+free", re.I)
# ...unless the message ALSO tells you where to send money.
_EXPLICIT_SEND = re.compile(r"بھیج|bhej|\bsend\b|transfer|easypaisa|jazzcash|ایزی\s*پیسہ|جاز\s*کیش|\b03\d{2}[-\s]?\d{7}\b", re.I)


def advance_fee(text: str) -> bool:
    if not (_PROMISE.search(text) and _SEND_BACK.search(text)):
        return False
    return not _PROTECTIVE.search(text) or bool(_EXPLICIT_SEND.search(text))


def is_official_style(text: str) -> bool:
    return bool(_OFFICIAL_RELIEF.search(text))
_NO_FEE = re.compile(r"no\s+fee|koi\s+fee\s+nahi|کوئی\s+فیس\s+نہیں|free\s+of\s+charge|is\s+free", re.I)
_SEND_MONEY = re.compile(r"bhej|send|transfer|pay\s|بھیجیں|easypaisa|jazzcash|deposit", re.I)
# Messages with no money / relief vocabulary at all are out of scope (e.g. family chat).
_RELIEF_CONTEXT = re.compile(
    r"\brs\.?\b|rupay|rupees|روپے|\d{3,}|bisp|ehsaas|benazir|imdad|grant|payment|qist|relief|امداد|رقم|raqam|inaam"
    r"|انعام|prize|\bwon\b|fee|\bpin\b|otp|account|cnic|adaigi|ادائیگی|bank|link|http", re.I)


def risk_signals(text: str) -> dict:
    hits = [k for k, (rx, _, _) in _SIG.items() if rx.search(text)]
    official = bool(_OFFICIAL.search(text))
    # "never share your PIN" mentions PIN but is protective, not a request
    if official and "pin_otp_request" in hits and re.search(r"never\s+share|na\s+batayen|نہ\s+بتائیں", text, re.I):
        hits.remove("pin_otp_request")
    # "No fee is charged" is protective too, unless the message also asks to send money
    if "fee_request" in hits and _NO_FEE.search(text) and not _SEND_MONEY.search(text):
        hits.remove("fee_request")
    score = sum(_SIG[k][1] for k in hits)
    if official and not {"fee_request", "suspicious_link", "pin_otp_request"} & set(hits):
        score -= 0.4
    return {"signals": hits, "official_markers": official, "rule_score": float(np.clip(score, 0, 1))}


# ----------------------------------------------------------------- classifier
_lock = threading.Lock()
_model = None


def _build_pipeline() -> Pipeline:
    feats = FeatureUnion([
        ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, min_df=1)),
        ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True, token_pattern=r"(?u)\b\w+\b")),
    ])
    return Pipeline([("feats", feats), ("lr", LogisticRegression(C=4.0, max_iter=3000, random_state=2026))])


def get_model() -> Pipeline:
    global _model
    with _lock:
        if _model is None:
            corpus = build_corpus()
            _model = _build_pipeline().fit([r["text"] for r in corpus], [r["label"] for r in corpus])
        return _model


def holdout_metrics(seed: int = 7) -> dict:
    corpus = build_corpus()
    X = [r["text"] for r in corpus]
    y = [r["label"] for r in corpus]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=seed, stratify=y)
    pred = _build_pipeline().fit(Xtr, ytr).predict(Xte)
    acc = float(np.mean(np.array(pred) == np.array(yte)))
    return {"n_train": len(Xtr), "n_test": len(Xte), "accuracy": round(acc, 4), "corpus_size": len(corpus)}


def verdict_from_probability(p: float, official_style: bool = False) -> str:
    """>=0.70 SCAM, 0.35-0.69 UNCERTAIN, <0.35 OFFICIAL_STYLE_NOTICE only with verified relief markers,
    otherwise NOT_A_GOV_MESSAGE. A low score is never presented as proof that a message is genuine."""
    if p >= SCAM_THRESHOLD:
        return SCAM
    if p >= UNCERTAIN_LOW:
        return UNCERTAIN
    return OFFICIAL_STYLE if official_style else NOT_GOV


def _ui(verdict: str) -> dict:
    color, en, ur = VERDICT_UI[verdict]
    return {"color": color, "headline_en": en, "headline_ur": ur}


# ----------------------------------------------------------------- RAG over policy markdown
_rag = None


def _load_chunks() -> list[dict]:
    chunks = []
    for path in sorted(POLICY_DIR.glob("*.md")):
        title, section, buf = path.stem, None, []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
            elif line.startswith("## "):
                if section and buf:
                    chunks.append({"source": path.name, "doc_title": title, "section": section, "text": " ".join(buf).strip()})
                section, buf = line[3:].strip(), []
            elif line.strip():
                buf.append(line.strip())
        if section and buf:
            chunks.append({"source": path.name, "doc_title": title, "section": section, "text": " ".join(buf).strip()})
    return chunks


def _get_rag():
    global _rag
    with _lock:
        if _rag is None:
            chunks = _load_chunks()
            vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, stop_words="english")
            mat = vec.fit_transform([f"{c['section']} {c['section']} {c['text']}" for c in chunks])
            _rag = (chunks, vec, mat)
        return _rag


def retrieve(query: str, k: int = 2) -> list[dict]:
    chunks, vec, mat = _get_rag()
    sims = cosine_similarity(vec.transform([query]), mat)[0]
    order = np.argsort(-sims)[:k]
    return [{"source": chunks[i]["source"], "document": chunks[i]["doc_title"], "section": chunks[i]["section"],
             "snippet": chunks[i]["text"][:260], "score": round(float(sims[i]), 4)} for i in order if sims[i] > 0]


SIGNAL_QUERIES = {
    "fee_request": "no fee is ever charged fee tax registration processing deposit send money",
    "pin_otp_request": "never share pin otp code password",
    "suspicious_link": "official sender links short code shortened link website",
    "urgency": "urgency lucky draw lures final notice pressure",
    "prize_lure": "lucky draw won prize lures",
    "personal_number": "official sender short code ordinary mobile numbers",
    "advance_fee": "no fee is ever charged fee tax registration processing deposit send money",
}


def answer_policy(question: str) -> dict:
    """Extractive, citation-grounded answer (no generative model, so no hallucinated policy)."""
    clean = detect_injection(question)["sanitized_text"]
    cites = retrieve(clean, k=3)
    answer = cites[0]["snippet"] if cites else "No matching official policy was found. Please ask an officer."
    return {"answer": answer, "citations": cites, "grounded": bool(cites)}


# ----------------------------------------------------------------- public entrypoint
def check_sms(text: str) -> dict:
    inj = detect_injection(text)
    clean = inj["sanitized_text"]
    sig = risk_signals(clean)
    if inj["injection"]:
        cites = retrieve("system override instructions official sender links", k=1) or retrieve("report fraud", k=1)
        return {
            "verdict": "BLOCKED_PROMPT_INJECTION", **_ui("BLOCKED_PROMPT_INJECTION"), "probability": 1.0, "model_probability": None,
            "injection_detected": True, "injection_matches": inj["matches"], "sanitized_text": clean,
            "signals": sig["signals"] + ["prompt_injection"],
            "reasons_en": ["This message tries to give orders to the system. It was blocked and reported."],
            "reasons_ur": ["یہ پیغام نظام کو حکم دینے کی کوشش کرتا ہے۔ اسے روک کر رپورٹ کر دیا گیا۔"],
            "citations": cites, "model_version": MODEL_VERSION,
        }
    official_style = is_official_style(clean)
    fee_scam = advance_fee(clean)
    signals = (["advance_fee"] if fee_scam else []) + sig["signals"]
    if not signals and not official_style and not _RELIEF_CONTEXT.search(clean):
        return {"verdict": NOT_GOV, **_ui(NOT_GOV), "probability": 0.05, "model_probability": None, "rule_score": 0.0,
                "injection_detected": False, "signals": [], "official_markers": False, "out_of_scope": True,
                "reasons_en": ["This message is not about money or relief payments, so it is not a government relief message."],
                "reasons_ur": ["یہ پیغام رقم یا امدادی ادائیگی کے بارے میں نہیں، اس لیے یہ سرکاری امدادی پیغام نہیں ہے۔"],
                "citations": [], "model_version": MODEL_VERSION}
    model_p = float(get_model().predict_proba([clean])[0][1])
    p = float(np.clip(0.65 * model_p + 0.35 * sig["rule_score"], 0, 1))
    if fee_scam:
        p = max(p, ADVANCE_FEE_FLOOR)  # hard rule: promising money but asking for money first is always a scam
    verdict = verdict_from_probability(p, official_style)
    reasons_en = [_SIG[x][2][0] for x in sig["signals"]]
    reasons_ur = [_SIG[x][2][1] for x in sig["signals"]]
    if fee_scam:
        reasons_en.insert(0, "It promises you money but asks you to send money first. Real relief never charges a fee.")
        reasons_ur.insert(0, "یہ آپ کو رقم دینے کا وعدہ کرتا ہے مگر پہلے آپ سے رقم مانگتا ہے۔ اصل امداد کبھی فیس نہیں لیتی۔")
    if verdict == OFFICIAL_STYLE:
        reasons_en.insert(0, "It looks like an official-style notice and asks for no money or codes, but that is not proof. Verify only via 8171.")
        reasons_ur.insert(0, "یہ سرکاری طرز کا پیغام لگتا ہے اور اس میں رقم یا کوڈ نہیں مانگا گیا، مگر یہ ثبوت نہیں۔ صرف 8171 سے تصدیق کریں۔")
        query = "payment notifications sms 8171 no link never requests money"
    elif verdict == NOT_GOV:
        reasons_en.insert(0, "Low risk, but it has none of the markers of an official relief notice.")
        reasons_ur.insert(0, "خطرہ کم ہے، مگر اس میں سرکاری امدادی پیغام کی کوئی نشانی نہیں۔")
        query = "official sender short code 8171"
    elif verdict == UNCERTAIN:
        reasons_en.insert(0, "We are not sure about this message. Please confirm with the government office or 8171 before acting.")
        reasons_ur.insert(0, "ہمیں اس پیغام کے بارے میں یقین نہیں۔ کچھ کرنے سے پہلے سرکاری دفتر یا 8171 سے تصدیق کریں۔")
        query = "how to report fraud helpline " + " ".join(SIGNAL_QUERIES.get(x, "") for x in signals)
    else:
        query = " ".join(SIGNAL_QUERIES.get(x, "") for x in signals) or "no fee is ever charged"
    cites = retrieve(query, k=2)
    if fee_scam:  # always cite the no-fee policy first for advance-fee fraud
        nofee = [c for c in retrieve(SIGNAL_QUERIES["advance_fee"], k=3) if c["section"] == "No Fee Is Ever Charged"]
        cites = (nofee + [c for c in cites if c["section"] != "No Fee Is Ever Charged"])[:2]
    return {
        "verdict": verdict, **_ui(verdict), "probability": round(p, 4), "model_probability": round(model_p, 4),
        "rule_score": round(sig["rule_score"], 4), "injection_detected": False, "signals": signals,
        "official_markers": official_style, "reasons_en": reasons_en, "reasons_ur": reasons_ur, "citations": cites,
        "model_version": MODEL_VERSION,
    }
