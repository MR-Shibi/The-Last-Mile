"""Dirty-data fuzzy name matcher for Pakistani names (Roman Urdu, English and Urdu script).

Pipeline: Unicode NFKC + Arabic/Urdu letter folding + diacritic removal -> title stripping
(Syed, Bibi, Mst., Haji, ...) -> tokenisation -> per-token comparison:
  * identical token                                  -> 1.00
  * same spelling-variant group or same phonetic key -> controlled band 0.82..0.92
    (e.g. Muhammad / Mohammad / Muhammed / Mohd), so the engine flags it for an officer
    instead of silently merging or silently rejecting
  * otherwise                                        -> raw Jaro-Winkler (RapidFuzz)
Tokens are aligned order-insensitively; missing/extra tokens are penalised.
"""
import re
import unicodedata

from rapidfuzz.distance import JaroWinkler

MATCHER_VERSION = "lastmile-namematch-v2 (nfkc+titles+phonetic+jw)"
VARIANT_BAND = (0.82, 0.92)
SCRIPT_CROSS_SCORE = 0.85  # Urdu-script vs Roman token with equal consonant skeleton

TITLES = {
    "syed", "sayed", "sayyid", "syeda", "sayyida", "bibi", "bi", "mst", "mst.", "mussammat", "musammat", "mrs", "mr",
    "ms", "miss", "haji", "hajji", "hajjan", "hafiz", "hafiza", "mian", "ch", "chaudhry", "chaudhary", "dr", "sheikh",
    "shaikh", "begum", "rana", "malik_title", "mohtarma", "janab", "sahib", "sahiba",
    # Urdu script titles
    "سید", "سیدہ", "بی", "بیبی", "مسماۃ", "مسمات", "حاجی", "حافظ", "حافظہ", "میاں", "بیگم", "شیخ", "جناب", "محترمہ",
}

VARIANT_GROUPS = [
    {"muhammad", "mohammad", "mohammed", "muhammed", "muhamad", "mohamad", "mohamed", "mohd", "md", "muhd", "mhd", "mohmmad", "muhamed"},
    {"ahmed", "ahmad", "ahmd", "ehmad"},
    {"hussain", "husain", "hussein", "hosain", "hussan"},
    {"hassan", "hasan", "hasaan"},
    {"fatima", "fatimah", "fatma", "fatema"},
    {"ayesha", "aisha", "aysha", "aaisha", "ayisha"},
    {"zainab", "zenab", "zaynab"},
    {"rehman", "rahman", "rehmaan", "rahmaan"},
    {"usman", "osman", "uthman", "usmaan"},
    {"yousaf", "yusuf", "yousuf", "yusaf", "yousef"},
    {"iqbal", "ikbal"},
    {"qureshi", "kureshi", "quraishi"},
    {"noor", "nur", "noorr"},
    {"abdul", "abdal", "abd"},
    {"khadija", "khadijah", "khatija"},
    {"rukhsana", "ruksana", "rukhsaana"},
    {"nasreen", "nasrin", "nasreenn"},
    {"parveen", "parvin", "perveen"},
    {"kulsoom", "kulsum", "kalsoom"},
]
_VARIANT_INDEX = {v: i for i, g in enumerate(VARIANT_GROUPS) for v in g}

# Arabic -> Urdu letter folding (keyboard / OCR inconsistencies)
_FOLD = str.maketrans({"ي": "ی", "ى": "ی", "ئ": "ی", "ك": "ک", "ة": "ہ", "ه": "ہ", "ۀ": "ہ", "أ": "ا", "إ": "ا",
                       "آ": "ا", "ٱ": "ا", "ؤ": "و", "ـ": ""})
# Urdu letter -> Latin consonant skeleton (vowel-ish letters map to "")
_URDU_TO_LATIN = {
    "ا": "", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s", "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d",
    "ڈ": "d", "ذ": "z", "ر": "r", "ڑ": "r", "ز": "z", "ژ": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t",
    "ظ": "z", "ع": "", "غ": "gh", "ف": "f", "ق": "q", "ک": "k", "گ": "g", "ل": "l", "م": "m", "ن": "n", "ں": "n",
    "و": "w", "ہ": "h", "ھ": "h", "ء": "", "ی": "y", "ے": "y",
}
_ARABIC_RE = re.compile(r"[؀-ۿ]")
_DIACRITICS_RE = re.compile(r"[ً-ٰٟۖ-ۭ]")


def _is_urdu(token: str) -> bool:
    return bool(_ARABIC_RE.search(token))


def normalize(name: str | None) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKC", str(name)).translate(_FOLD)
    s = _DIACRITICS_RE.sub("", s)
    s = "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch) or _is_urdu(ch))
    s = s.lower()
    s = re.sub(r"[.\-_,'`/\\()]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def tokens(name: str | None) -> list[str]:
    toks = [t for t in normalize(name).split(" ") if t]
    stripped = [t for t in toks if t not in TITLES]
    return stripped or toks  # never strip a name down to nothing


def phonetic(token: str) -> str:
    """Consonant skeleton tuned for South-Asian romanisation; works for Urdu script too."""
    if _is_urdu(token):
        token = "".join(_URDU_TO_LATIN.get(ch, "") for ch in token)
    t = token.lower()
    for a, b in (("ph", "f"), ("kh", "k"), ("gh", "g"), ("sh", "s"), ("ch", "c"), ("th", "t"), ("dh", "d"),
                 ("q", "k"), ("w", "v"), ("ck", "k"), ("x", "ks")):
        t = t.replace(a, b)
    t = re.sub(r"[^a-z]", "", t)
    t = re.sub(r"[aeiouyv]", "", t)  # vowels + semi-vowels (و / ی are usually vowels in Urdu)
    t = re.sub(r"(.)\1+", r"\1", t)
    if len(t) > 2 and t.endswith("h"):
        t = t[:-1]
    return t


def token_similarity(a: str, b: str) -> float:
    if a == b:
        return 1.0
    ua, ub = _is_urdu(a), _is_urdu(b)
    if ua != ub:  # cross-script: only the consonant skeleton is comparable
        return SCRIPT_CROSS_SCORE if phonetic(a) and phonetic(a) == phonetic(b) else 0.3
    ga, gb = _VARIANT_INDEX.get(a), _VARIANT_INDEX.get(b)
    jw = JaroWinkler.normalized_similarity(a, b)
    if (ga is not None and ga == gb) or (len(a) > 2 and phonetic(a) and phonetic(a) == phonetic(b)):
        lo, hi = VARIANT_BAND
        return round(min(hi, max(lo, lo + (hi - lo) * jw)), 4)
    return round(jw, 4)


def name_similarity(a: str | None, b: str | None) -> float | None:
    """Order-insensitive token alignment. Returns None when either side is missing."""
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return None
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    remaining = list(long_)
    sims = []
    for t in short:
        best_i, best = max(enumerate(token_similarity(t, r) for r in remaining), key=lambda x: x[1])
        sims.append(best)
        remaining.pop(best_i)
    score = sum(sims) / len(sims)
    coverage = len(short) / len(long_)
    if coverage < 1:
        score *= coverage ** 0.35  # "Shazia" vs "Shazia Perveen" is weaker than an exact match
    return round(score, 4)


def match_names(a: str | None, b: str | None) -> dict:
    s = name_similarity(a, b)
    if s is None:
        band = "missing"
    elif s >= 0.999:
        band = "exact"
    elif s > VARIANT_BAND[1]:
        band = "strong"
    elif s >= 0.72:
        band = "borderline"
    else:
        band = "different"
    return {"score": s, "band": band, "needs_officer_review": band == "borderline",
            "normalized": [" ".join(tokens(a)), " ".join(tokens(b))],
            "phonetic": [" ".join(phonetic(t) for t in tokens(a)), " ".join(phonetic(t) for t in tokens(b))],
            "matcher_version": MATCHER_VERSION}
