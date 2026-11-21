/**
 * Spoken-number parsing for low-literacy users (Urdu script, Roman Urdu, English) — runs fully on-device,
 * so voice entry works offline. Two entry points:
 *
 *  - parseSpokenCnic(text):   digit-by-digit ("چار دو پانچ") AND grouped numbers ("پینتالیس ہزار چار سو ایک"),
 *                             mixed freely; concatenates up to 13 digits; formats XXXXX-XXXXXXX-X when complete.
 *  - parseSpokenAmount(text): South-Asian amounts with scales (سو/ہزار/لاکھ/ملین/کروڑ/ارب) and colloquial
 *                             fractions: ڈیڑھ 1.5, ڈھائی 2.5, ساڑھے N+0.5, سوا N+0.25, پونے N−0.25.
 *
 * Only erasable TypeScript syntax is used so Node can run the unit tests natively (node --test).
 */

// ------------------------------------------------------------------ vocabulary
const UR_0_99 = [
  "صفر", "ایک", "دو", "تین", "چار", "پانچ", "چھ", "سات", "آٹھ", "نو",
  "دس", "گیارہ", "بارہ", "تیرہ", "چودہ", "پندرہ", "سولہ", "سترہ", "اٹھارہ", "انیس",
  "بیس", "اکیس", "بائیس", "تیئیس", "چوبیس", "پچیس", "چھبیس", "ستائیس", "اٹھائیس", "انتیس",
  "تیس", "اکتیس", "بتیس", "تینتیس", "چونتیس", "پینتیس", "چھتیس", "سینتیس", "اڑتیس", "انتالیس",
  "چالیس", "اکتالیس", "بیالیس", "تینتالیس", "چوالیس", "پینتالیس", "چھیالیس", "سینتالیس", "اڑتالیس", "انچاس",
  "پچاس", "اکیاون", "باون", "ترپن", "چون", "پچپن", "چھپن", "ستاون", "اٹھاون", "انسٹھ",
  "ساٹھ", "اکسٹھ", "باسٹھ", "ترسٹھ", "چونسٹھ", "پینسٹھ", "چھیاسٹھ", "سڑسٹھ", "اڑسٹھ", "انہتر",
  "ستر", "اکہتر", "بہتر", "تہتر", "چوہتر", "پچھتر", "چھہتر", "ستتر", "اٹھہتر", "اناسی",
  "اسی", "اکیاسی", "بیاسی", "تراسی", "چوراسی", "پچاسی", "چھیاسی", "ستاسی", "اٹھاسی", "نواسی",
  "نوے", "اکانوے", "بانوے", "ترانوے", "چورانوے", "پچانوے", "چھیانوے", "ستانوے", "اٹھانوے", "ننانوے",
];
const RU_0_99 = [
  "sifar", "aik", "do", "teen", "chaar", "paanch", "chhe", "saat", "aath", "nau",
  "das", "gyarah", "barah", "terah", "chaudah", "pandrah", "solah", "satrah", "atharah", "unnees",
  "bees", "ikkees", "baees", "teyees", "chaubees", "pachees", "chhabbees", "sattaees", "atthaees", "untees",
  "tees", "ikattees", "battees", "taintees", "chautees", "paintees", "chhattees", "saintees", "artees", "untalees",
  "chalees", "iktalees", "bayalees", "taintalees", "chawalees", "paintalees", "chhiyalees", "saintalees", "artalees", "unchaas",
  "pachaas", "ikyavan", "baavan", "trepan", "chauvan", "pachpan", "chhappan", "sattavan", "athavan", "unsath",
  "saath", "iksath", "baasath", "tresath", "chausath", "painsath", "chhiyasath", "sarsath", "arsath", "unhattar",
  "sattar", "ikhattar", "bahattar", "tihattar", "chauhattar", "pachhattar", "chhihattar", "satattar", "athattar", "unaasi",
  "assi", "ikyaasi", "bayaasi", "tiraasi", "chauraasi", "pachaasi", "chhiyaasi", "sattaasi", "athaasi", "navaasi",
  "nabbe", "ikyaanve", "baanve", "tiraanve", "chauraanve", "pachaanve", "chhiyaanve", "sattaanve", "athaanve", "ninyaanve",
];
// Common alternative spellings (speech engines and people spell these many ways)
const VARIANTS: Record<string, number> = {
  // Urdu script
  "چھے": 6, "اٹھ": 8, "گیارا": 11, "بارا": 12, "تیرا": 13, "پندرا": 15, "سولا": 16, "سترا": 17, "اٹھارا": 18,
  "تئیس": 23, "پینتس": 35, "ننانوں": 99, "نوّے": 90, "اسّی": 80,
  // Roman Urdu
  zero: 0, ek: 1, ik: 1, ak: 1, tin: 3, char: 4, chhar: 4, panch: 5, paanj: 5, che: 6, chay: 6, chhay: 6, chheh: 6, cheh: 6,
  sat: 7, aat: 8, aanth: 8, no: 9, gyara: 11, giyarah: 11, baara: 12, bara: 12, tera: 13, chauda: 14, choda: 14,
  pandra: 15, sola: 16, satra: 17, athara: 18, unees: 19, unis: 19, bis: 20, ikkis: 21, bais: 22, tais: 23, chaubis: 24,
  pachis: 25, pachchees: 25, chabbis: 26, sattais: 27, atthais: 28, untis: 29, tis: 30, battis: 32, chhattis: 36,
  chalis: 40, iktalis: 41, bayalis: 42, byalis: 42, paintalis: 45, pentalis: 45, chhiyalis: 46, pachas: 50, pachaas: 50,
  sath: 60, assee: 80, asi: 80, nabbay: 90, navve: 90, nawway: 90,
};
const EN: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const EN_TENS = new Set(["twenty", "thirty", "forty", "fourty", "fifty", "sixty", "seventy", "eighty", "ninety"]);

const SCALES: Record<string, number> = {
  "سو": 100, sau: 100, so: 100, hundred: 100,
  "ہزار": 1e3, hazar: 1e3, hazaar: 1e3, hajar: 1e3, thousand: 1e3,
  "لاکھ": 1e5, lakh: 1e5, lac: 1e5, laakh: 1e5,
  "ملین": 1e6, million: 1e6,
  "کروڑ": 1e7, crore: 1e7, karor: 1e7, karod: 1e7, krore: 1e7,
  "ارب": 1e9, arab: 1e9, "بلین": 1e9, billion: 1e9,
};

// Colloquial fractions
const DEDH = new Set(["ڈیڑھ", "ڈیڑ", "dedh", "derh", "dairh", "deddh"]);          // 1.5
const DHAI = new Set(["ڈھائی", "ڈھایی", "dhai", "dhaai", "adhai", "اڑھائی", "arhai"]); // 2.5
const SADHE = new Set(["ساڑھے", "ساڑے", "sadhe", "sarhe", "saadhe", "saarhe"]);   // N + 0.5
const SAWA = new Set(["سوا", "sawa", "sava", "swa"]);                              // N + 0.25 (N defaults to 1)
const PAUNE = new Set(["پونے", "paune", "pone", "pauney"]);                         // N − 0.25 (N defaults to 1)

const SEPARATORS = new Set(["dash", "ڈیش", "hyphen", "minus", "-"]);
const FILLERS = new Set(["aur", "اور", "and", "rupay", "rupees", "rupee", "روپے", "rs"]);
const HEDGES = /(shayad|taqreeban|lagbhag|about|around|maybe|approximately|شاید|تقریباً|تقریبا|لگ\s*بھگ)/i;

const WORDS: Record<string, number> = { ...VARIANTS, ...EN };
UR_0_99.forEach((w, i) => (WORDS[w] = i));
RU_0_99.forEach((w, i) => (WORDS[w] = i));

// ------------------------------------------------------------------ normalisation
const DIGIT_MAP: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d);
}

function tokenize(text: string): string[] {
  let t = normalizeDigits(text ?? "").toLowerCase();
  t = t.replace(/(\d)[,٬](?=\d{3}\b)/g, "$1");          // 45,401 -> 45401 ; 1,500 -> 1500
  t = t.replace(/(\d)\s*-\s*(?=\d)/g, "$1 - ");          // keep CNIC dashes as separators
  t = t.replace(/([a-z])-([a-z])/g, "$1 $2");            // forty-five -> forty five
  t = t.replace(/[،؛؟!?,;:()"'“”۔]/g, " ").replace(/\.(?!\d)/g, " ");
  return t.split(/\s+/).filter(Boolean);
}

type Tok =
  | { k: "num"; v: number; tens: boolean; literal: string | null }
  | { k: "scale"; v: number }
  | { k: "frac"; f: "dedh" | "dhai" | "sadhe" | "sawa" | "paune" }
  | { k: "sep" }
  | { k: "filler" }
  | { k: "other" };

function classify(w: string): Tok {
  if (/^\d+(\.\d+)?$/.test(w)) return { k: "num", v: Number(w), tens: false, literal: w };
  if (w in SCALES) return { k: "scale", v: SCALES[w] };
  if (w in WORDS) return { k: "num", v: WORDS[w], tens: EN_TENS.has(w), literal: null };
  if (DEDH.has(w)) return { k: "frac", f: "dedh" };
  if (DHAI.has(w)) return { k: "frac", f: "dhai" };
  if (SADHE.has(w)) return { k: "frac", f: "sadhe" };
  if (SAWA.has(w)) return { k: "frac", f: "sawa" };
  if (PAUNE.has(w)) return { k: "frac", f: "paune" };
  if (SEPARATORS.has(w)) return { k: "sep" };
  if (FILLERS.has(w)) return { k: "filler" };
  return { k: "other" };
}

// ------------------------------------------------------------------ CNIC
export function formatCnic(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

/**
 * Digits from speech. Each spoken chunk is evaluated on its own and the chunks are concatenated:
 * "چار دو پانچ صفر ایک" -> 4|2|5|0|1, "پینتالیس ہزار چار سو ایک" -> 45401, "بیالیس پانچ سو ایک" -> 42|501.
 * Returns the bare digits until 13 are present, then the formatted XXXXX-XXXXXXX-X.
 */
export function parseSpokenCnic(text: string): string {
  let out = "";
  let total = 0;
  let current = 0;
  let open = false;            // a chunk is being built
  let prev: Tok | null = null;

  const close = () => {
    if (open) out += String(Math.round(total + current));
    total = 0;
    current = 0;
    open = false;
  };

  for (const w of tokenize(text)) {
    const t = classify(w);
    if (t.k === "num") {
      if (t.literal !== null) {               // spoken/typed digits are taken verbatim (keeps leading zeros)
        close();
        out += t.literal.replace(/\D/g, "");
      } else if (!open) {
        current = t.v;
        open = true;
      } else if (prev && prev.k === "scale") {
        current += t.v;                       // "... ہزار چار" / "... سو ایک"
      } else if (prev && prev.k === "num" && prev.tens && t.v < 10 && current % 10 === 0) {
        current += t.v;                       // English "forty five"
      } else {
        close();                              // adjacent numbers without a scale: digit-by-digit
        current = t.v;
        open = true;
      }
    } else if (t.k === "scale") {
      if (!open) {
        current = 1;
        open = true;
      }
      if (t.v === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * t.v;
        current = 0;
      }
    } else if (t.k === "sep" || t.k === "other" || t.k === "filler") {
      close();
    }
    prev = t;
  }
  close();
  const digits = out.slice(0, 13);
  return digits.length === 13 ? formatCnic(digits) : digits;
}

// ------------------------------------------------------------------ amounts
export interface AmountResult {
  value: number | null;
  ambiguous: boolean;
}

/** Detailed parse: also reports ambiguity ("do teen hazar", hedges like "shayad") so the UI can ask again. */
export function parseSpokenAmountDetailed(text: string): AmountResult {
  const toks = tokenize(text).map(classify);
  let total = 0;
  let current = 0;
  let seen = false;
  let ambiguous = HEDGES.test(text ?? "");
  let pending: "sadhe" | "sawa" | "paune" | null = null;
  let prev: Tok | null = null;

  const applyPending = (n: number): number => {
    if (pending === "sadhe") n += 0.5;
    else if (pending === "sawa") n += 0.25;
    else if (pending === "paune") n -= 0.25;
    pending = null;
    return n;
  };

  for (const t of toks) {
    if (t.k === "num") {
      seen = true;
      if (prev && prev.k === "num" && !(prev.tens && t.v < 10 && current % 10 === 0)) {
        ambiguous = true;                     // two bare numbers in a row: "do teen hazar"
        current += applyPending(t.v);
      } else {
        current += applyPending(t.v);
      }
    } else if (t.k === "frac") {
      seen = true;
      if (t.f === "dedh") current += 1.5;
      else if (t.f === "dhai") current += 2.5;
      else pending = t.f;
    } else if (t.k === "scale") {
      seen = true;
      if (pending) current += applyPending(1); // "سوا لاکھ" / "پونے لاکھ": N defaults to 1
      const base = current || 1;
      if (t.v === 100) current = base * 100;
      else if (total > 0 && total < t.v && current === 0) total *= t.v; // rare: "ek sau hazar"
      else {
        total += base * t.v;
        current = 0;
      }
    } else if (t.k === "sep" || t.k === "filler") {
      // ignore ("das hazar aur paanch sau", "rupay")
    }
    if (t.k !== "filler" && t.k !== "other") prev = t;
  }
  if (pending) current += applyPending(1);
  if (!seen) return { value: null, ambiguous };
  const value = Math.round((total + current) * 100) / 100;
  return { value, ambiguous };
}

export function parseSpokenAmount(text: string): number | null {
  return parseSpokenAmountDetailed(text).value;
}
