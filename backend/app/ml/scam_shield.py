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

MODEL_VERSION = "scamshield-tfidf-lr-v1"
SCAM_THRESHOLD = 0.80
UNCERTAIN_LOW = 0.40
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
    "fee_request": (r"\bfee\b|charges?|deposit|\btax\b|bhej(en|na|o|ein)|jama\s*kar|processing|registration\s+charge"
                    r"|فیس|بھیجیں|جمع\s*کروائیں|سیکیورٹی|easypaisa|jazzcash|ایزی\s*پیسہ",
                    0.6, ("Asks you to pay a fee or send money first.", "پہلے فیس یا رقم بھیجنے کو کہتا ہے۔")),
    "pin_otp_request": (r"\bpin\b|\botp\b|verification\s+code|4\s*digit\s+code|password|پن|او\s*ٹی\s*پی",
                        0.5, ("Asks for your PIN or OTP code.", "آپ کا پن یا او ٹی پی کوڈ مانگتا ہے۔")),
    "suspicious_link": (r"https?://|www\.|bit\.ly|tinyurl|\b[\w-]+\.(com|net|org|site|xyz|top|click|info|online|live|link|pk|me)\b"
                        r"|/claim|/apply",
                        0.4, ("Contains a link that is not official.", "اس میں غیر سرکاری لنک ہے۔")),
    "urgency": (r"urgent|immediately|final\s+notice|expire|within\s+\d+\s+hours|foran|jaldi|fori|warna|فوری|ختم\s+ہو\s+جائے",
                0.2, ("Creates panic or a deadline.", "جلدی یا ڈر پیدا کرتا ہے۔")),
    "prize_lure": (r"\bwon\b|winner|lucky\s+draw|inaam|congratulations|mubarak|انعام|قرعہ|مبارک",
                   0.2, ("Promises a prize or lucky draw.", "انعام یا قرعہ اندازی کا وعدہ کرتا ہے۔")),
    "personal_number": (r"\b03\d{2}[-\s]?\d{7}\b", 0.25, ("Sent from or asks you to call a personal mobile number.",
                                                         "ذاتی موبائل نمبر سے آیا ہے یا اس پر رابطے کو کہتا ہے۔")),
}
OFFICIAL_MARKERS = r"^\s*8171\b|no\s+fee|koi\s+fee\s+nahi|کوئی\s+فیس\s+نہیں|0800-26477|never\s+share|kisi\s+ko\s+na\s+batayen"
_SIG = {k: (re.compile(p, re.I), w, txt) for k, (p, w, txt) in SIGNALS.items()}
_OFFICIAL = re.compile(OFFICIAL_MARKERS, re.I)
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


def verdict_from_probability(p: float) -> str:
    if p >= SCAM_THRESHOLD:
        return "SCAM"
    if p >= UNCERTAIN_LOW:
        return "UNCERTAIN_HUMAN_REVIEW"
    return "LIKELY_SAFE"


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
    sig = risk_signals(inj["sanitized_text"])
    if inj["injection"]:
        cites = retrieve("system override instructions official sender links", k=1) or retrieve("report fraud", k=1)
        return {
            "verdict": "BLOCKED_PROMPT_INJECTION", "color": "red", "probability": 1.0, "model_probability": None,
            "injection_detected": True, "injection_matches": inj["matches"], "sanitized_text": inj["sanitized_text"],
            "signals": sig["signals"] + ["prompt_injection"],
            "reasons_en": ["This message tries to give orders to the system. It was blocked and reported."],
            "reasons_ur": ["یہ پیغام نظام کو حکم دینے کی کوشش کرتا ہے۔ اسے روک کر رپورٹ کر دیا گیا۔"],
            "citations": cites, "model_version": MODEL_VERSION,
        }
    if not sig["signals"] and not _RELIEF_CONTEXT.search(inj["sanitized_text"]):
        return {"verdict": "LIKELY_SAFE", "color": "green", "probability": 0.05, "model_probability": None,
                "rule_score": 0.0, "injection_detected": False, "signals": [], "official_markers": False,
                "reasons_en": ["This message is not about money or relief payments."],
                "reasons_ur": ["یہ پیغام رقم یا امدادی ادائیگی کے بارے میں نہیں ہے۔"],
                "citations": [], "model_version": MODEL_VERSION, "out_of_scope": True}
    model_p = float(get_model().predict_proba([inj["sanitized_text"]])[0][1])
    p = float(np.clip(0.65 * model_p + 0.35 * sig["rule_score"], 0, 1))
    verdict = verdict_from_probability(p)
    reasons_en = [_SIG[s][2][0] for s in sig["signals"]]
    reasons_ur = [_SIG[s][2][1] for s in sig["signals"]]
    if verdict == "LIKELY_SAFE":
        reasons_en.insert(0, "This looks like an official notice: it asks for no money and no codes.")
        reasons_ur.insert(0, "یہ سرکاری پیغام لگتا ہے: اس میں نہ رقم مانگی گئی ہے نہ کوڈ۔")
        query = "payment notifications sms 8171 no link never requests money"
    elif verdict == "UNCERTAIN_HUMAN_REVIEW":
        reasons_en.insert(0, "We are not sure about this message. Please confirm on the toll-free helpline before acting.")
        reasons_ur.insert(0, "ہمیں اس پیغام کے بارے میں یقین نہیں۔ کچھ کرنے سے پہلے مفت ہیلپ لائن پر تصدیق کریں۔")
        query = "how to report fraud helpline " + " ".join(SIGNAL_QUERIES.get(s, "") for s in sig["signals"])
    else:
        query = " ".join(SIGNAL_QUERIES.get(s, "") for s in sig["signals"]) or "no fee is ever charged"
    return {
        "verdict": verdict, "color": {"SCAM": "red", "UNCERTAIN_HUMAN_REVIEW": "yellow", "LIKELY_SAFE": "green"}[verdict],
        "probability": round(p, 4), "model_probability": round(model_p, 4), "rule_score": round(sig["rule_score"], 4),
        "injection_detected": False, "signals": sig["signals"], "official_markers": sig["official_markers"],
        "reasons_en": reasons_en, "reasons_ur": reasons_ur, "citations": retrieve(query, k=2),
        "model_version": MODEL_VERSION,
    }
