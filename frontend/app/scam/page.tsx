"use client";

import { useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import SpeakButton, { speak } from "@/components/SpeakButton";
import { PageShell } from "@/components/ui";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useDictation } from "@/lib/useDictation";

const SAMPLE_SCAM = "Mubarak ho! Aap ka 25000 rupay ka BISP inaam nikla hai. Foran 500 rupay processing fee is number 0301-5550123 par Easypaisa karein warna raqam wapas chali jayegi.";
const SAMPLE_OFFICIAL = "8171: Aap ki BISP qist Rs 25000 tayyar hai. Asal CNIC ke sath qareebi campsite se wasool karein. Koi fee nahi. Apna PIN kisi ko na batayen.";

interface Citation { source: string; document: string; section: string; snippet: string }
type Verdict = "SCAM" | "UNCERTAIN_HUMAN_REVIEW" | "NOT_A_GOV_MESSAGE" | "OFFICIAL_STYLE_NOTICE" | "BLOCKED_PROMPT_INJECTION";
interface ScamResult {
  verdict: Verdict; color: "red" | "amber" | "neutral" | "green"; headline_en: string; headline_ur: string; probability: number;
  reasons_en: string[]; reasons_ur: string[]; citations: Citation[]; injection_detected: boolean; scam_indicators?: string[]; signals?: string[];
}
type Tone = "danger" | "review" | "neutral" | "safe";

/** Visual style per verdict (4 tiers + blocked). Headlines always come from the server, which never claims a
 * message is certainly from the government. */
const STYLE: Record<Verdict, { tone: Tone; icon: IconName; label_en: string; label_ur: string; audio: string | null }> = {
  SCAM: { tone: "danger", icon: "alert", label_en: "SCAM", label_ur: "دھوکہ", audio: "scam_warning" },
  BLOCKED_PROMPT_INJECTION: { tone: "danger", icon: "x", label_en: "BLOCKED", label_ur: "روک دیا گیا", audio: "scam_warning" },
  UNCERTAIN_HUMAN_REVIEW: { tone: "review", icon: "help", label_en: "UNCERTAIN", label_ur: "غیر یقینی", audio: null },
  NOT_A_GOV_MESSAGE: { tone: "neutral", icon: "info", label_en: "NOT A GOVERNMENT MESSAGE", label_ur: "سرکاری پیغام نہیں", audio: null },
  OFFICIAL_STYLE_NOTICE: { tone: "safe", icon: "checkCircle", label_en: "OFFICIAL-STYLE NOTICE", label_ur: "سرکاری طرز کا پیغام", audio: "safe_message" },
};

/** Plain-language names for the server's concrete scam indicators / signals. */
const TRIGGER: Record<string, { en: string; ur: string }> = {
  advance_fee: { en: "Advance-fee trick: promises money but asks you to pay first", ur: "پیشگی فیس کا دھوکہ: رقم کا وعدہ مگر پہلے پیسے مانگے" },
  fee_request: { en: "Asks for a fee, charge or money transfer", ur: "فیس، چارجز یا رقم بھیجنے کا مطالبہ" },
  pin_otp_request: { en: "Asks for your PIN, OTP, password or CNIC photo", ur: "پن، او ٹی پی، پاس ورڈ یا شناختی کارڈ کی تصویر مانگی" },
  threat: { en: "Threat or deadline pressure (\"or your money is cancelled\")", ur: "دھمکی یا وقت کا دباؤ (ورنہ رقم منسوخ)" },
  suspicious_link: { en: "Link to a website that is not .gov.pk", ur: "ایسی ویب سائٹ کا لنک جو .gov.pk نہیں" },
  personal_number: { en: "Personal mobile or WhatsApp number instead of 8171", ur: "8171 کے بجائے ذاتی موبائل یا واٹس ایپ نمبر" },
  urgency: { en: "Rushes you (\"foran\", \"urgent\")", ur: "جلدی کا دباؤ (فوراً، فوری)" },
  prize_lure: { en: "Prize or lucky-draw wording", ur: "انعام یا قرعہ اندازی کے الفاظ" },
};

const ACTION: Record<Tone, { en: string; ur: string }> = {
  danger: { en: "Do not send money and never share your PIN or OTP. Delete the message and verify directly by calling 8171 or at an authorised outlet.", ur: "کوئی رقم نہ بھیجیں اور اپنا پن یا او ٹی پی کبھی نہ بتائیں۔ پیغام مٹا دیں اور براہِ راست 8171 یا مجاز دکان سے تصدیق کریں۔" },
  review: { en: "Do not pay anything or share your PIN/OTP yet. Verify directly via 8171 or at an authorised outlet before acting.", ur: "ابھی کوئی رقم نہ دیں اور پن/او ٹی پی نہ بتائیں۔ کچھ کرنے سے پہلے 8171 یا مجاز دکان سے تصدیق کریں۔" },
  neutral: { en: "This does not look like a relief or payment message. If someone later asks for a fee or your PIN about it, treat it as a scam.", ur: "یہ امداد یا ادائیگی کا پیغام نہیں لگتا۔ اگر بعد میں کوئی اس بارے میں فیس یا پن مانگے تو اسے دھوکہ سمجھیں۔" },
  safe: { en: "Collect only in person with your original CNIC. No fee is ever charged — never share your PIN, even with an agent.", ur: "رقم صرف اصل شناختی کارڈ کے ساتھ خود جا کر وصول کریں۔ کبھی کوئی فیس نہیں لی جاتی — اپنا پن کسی ایجنٹ کو بھی نہ بتائیں۔" },
};

/** Payment Message Verification (Scam Shield): type, paste or speak an SMS -> structured verdict card. */
export default function ScamShield() {
  const { lang, L } = useLang();
  const [text, setText] = useState("");
  const [checked, setChecked] = useState("");
  const [res, setRes] = useState<ScamResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const dict = useDictation({
    lang,
    onEnd: (finalText) => setText([base, finalText].filter(Boolean).join(" ").trim()),
  });
  // While dictating, the box shows everything said so far plus the live interim words.
  const shown = dict.listening ? [base, dict.finalText, dict.interim].filter(Boolean).join(" ") : text;

  async function check(msg: string = text) {
    if (!msg.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<ScamResult>("/scam/check", { body: { text: msg } });
      setRes(r);
      setChecked(msg);
      const audio = STYLE[r.verdict]?.audio ?? null;
      void speak({ audioKey: audio, text: r.reasons_ur.join(" "), textEn: r.reasons_en.join(" "), lang });
    } catch {
      setErr(L("Could not check right now. Please try again when you are online.", "ابھی جانچ نہیں ہو سکی۔ انٹرنیٹ آنے پر دوبارہ کوشش کریں۔"));
    } finally {
      setBusy(false);
    }
  }

  function runSample(msg: string) {
    if (dict.listening) dict.stop();
    setText(msg);
    void check(msg);
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
    } catch {
      setErr(L("Paste is blocked on this phone — long-press the box and choose Paste.", "اس فون پر پیسٹ بند ہے — خانے کو دبا کر رکھیں اور پیسٹ چنیں۔"));
    }
  }

  const s = res ? STYLE[res.verdict] ?? STYLE.UNCERTAIN_HUMAN_REVIEW : null;
  const triggers = res ? Array.from(new Set([...(res.scam_indicators || []), ...(res.signals || []).filter((x) => x === "urgency" || x === "prize_lure")])).filter((x) => TRIGGER[x]) : [];
  const no8171 = !!res && (s?.tone === "danger" || s?.tone === "review") && !/\b8171\b/.test(checked);

  return (
    <PageShell title={L("Verify Payment Message", "پیغام کی تصدیق")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-brand">{L("Is this payment SMS real?", "کیا یہ ادائیگی کا پیغام اصلی ہے؟")}</h1>
          <p className="text-lg text-slate">{L("Type, paste or speak the message. We explain the warning signs in plain words.", "پیغام لکھیں، پیسٹ کریں یا بولیں۔ ہم خطرے کی نشانیاں آسان الفاظ میں بتائیں گے۔")}</p>
        </div>
        <SpeakButton text="پیغام لکھیں، پیسٹ کریں یا بول کر بتائیں، پھر چیک کریں دبائیں۔" textEn="Type, paste or speak the message, then press Check." size="lg" />
      </div>

      <div className="card mt-4 p-4">
        <label htmlFor="sms-box" className="block text-xl font-bold">{L("The message", "پیغام")}</label>
        <textarea
          id="sms-box"
          value={shown}
          readOnly={dict.listening}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder={L("Paste the SMS here", "پیغام یہاں چسپاں کریں")}
          className="field mt-2 text-xl"
        />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button type="button" onClick={() => void paste()} className="btn btn-secondary">
            <Icon name="paste" size={22} /> {L("Paste", "پیسٹ")}
          </button>
          {!dict.listening ? (
            <button type="button" onClick={() => { setBase(text); dict.start(); }} className="btn btn-secondary">
              <Icon name="mic" size={22} /> {L("Speak", "بولیں")}
            </button>
          ) : (
            <button type="button" onClick={dict.stop} aria-pressed="true" className="btn animate-pulse border-2 border-danger-line bg-danger-bg text-danger-ink ring-4 ring-gold ring-offset-2">
              <Icon name="stop" size={22} /> {L("Stop", "روکیں")}
            </button>
          )}
          <button type="button" disabled={busy || dict.listening} onClick={() => void check()} className="btn btn-primary col-span-2 sm:col-span-1">
            <Icon name="shield" size={22} /> {busy ? "…" : L("Check", "چیک کریں")}
          </button>
        </div>
        {dict.error && <p className="mt-2 text-lg font-bold text-danger-ink" role="alert">{dict.error === "unsupported" ? L("Voice input is not supported in this browser — paste or use a sample.", "اس براؤزر میں آواز ممکن نہیں — پیغام چسپاں کریں یا نمونہ استعمال کریں۔") : L("Could not hear you. Try again.", "آواز سنائی نہیں دی۔ دوبارہ کوشش کریں۔")}</p>}
        {err && <p className="mt-2 text-lg font-bold text-danger-ink" role="alert">{err}</p>}
        <p className="mt-4 text-base font-bold text-slate">{L("Quick test samples", "فوری نمونے")}</p>
        <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => runSample(SAMPLE_SCAM)} className="btn btn-danger text-base">
            <Icon name="alert" size={20} /> {L("Sample Scam SMS", "نمونہ دھوکہ پیغام")}
          </button>
          <button type="button" onClick={() => runSample(SAMPLE_OFFICIAL)} className="btn panel-safe text-base">
            <Icon name="checkCircle" size={20} /> {L("Sample Official SMS", "نمونہ اصلی پیغام")}
          </button>
        </div>
      </div>

      {res && s && (
        <section data-testid="scam-verdict" data-verdict={res.verdict} data-color={res.color} className="card mt-6 overflow-hidden" role="status" aria-live="polite">
          <div className={`panel-${s.tone} flex items-start gap-3 border-0 p-4 sm:gap-4 sm:p-5`}>
            <Icon name={s.icon} size={36} />
            <div className="min-w-0 flex-1">
              <span className={`pill pill-${s.tone} bg-card`}>{lang === "ur" ? s.label_ur : s.label_en}</span>
              <h2 className="mt-2 text-xl font-bold sm:text-2xl">{lang === "ur" ? res.headline_ur : res.headline_en}</h2>
              <p className="text-base opacity-90" dir="ltr">scam risk score {(res.probability * 100).toFixed(0)} / 100</p>
            </div>
            <SpeakButton audioKey={s.audio} text={[res.headline_ur, ...res.reasons_ur].join("۔ ")} textEn={[res.headline_en, ...res.reasons_en].join(". ")} size="lg" />
          </div>
          <div className="space-y-5 p-5">
            <div>
              <h3 className="text-xl font-bold">{L("Why — detected reasons", "کیوں — پائی گئی وجوہات")}</h3>
              <ul className="mt-2 space-y-2 text-lg">
                {triggers.map((t) => (
                  <li key={t} className="flex items-start gap-2"><Icon name="alert" size={20} className="mt-1 text-danger-ink" /> {lang === "ur" ? TRIGGER[t].ur : TRIGGER[t].en}</li>
                ))}
                {no8171 && (
                  <li className="flex items-start gap-2"><Icon name="info" size={20} className="mt-1 text-review-ink" /> {L("Not sent from the official 8171 sender code", "سرکاری 8171 کوڈ سے نہیں بھیجا گیا")}</li>
                )}
                {(lang === "ur" ? res.reasons_ur : res.reasons_en).map((r) => (
                  <li key={r} className="flex items-start gap-2"><Icon name="forward" size={20} className="mt-1 text-slate rtl:rotate-180" /> {r}</li>
                ))}
              </ul>
            </div>
            <div className={`panel-${s.tone} rounded-2xl p-4`}>
              <h3 className="text-lg font-bold">{L("Recommended safety action", "حفاظتی قدم")}</h3>
              <p className="text-lg">{lang === "ur" ? ACTION[s.tone].ur : ACTION[s.tone].en}</p>
            </div>
            {res.citations.length > 0 && (
              <div className="rounded-2xl border-2 border-line bg-page p-4" dir="ltr">
                <p className="text-lg font-bold">Official source</p>
                {res.citations.map((c) => (
                  <blockquote key={c.source + c.section} className="mt-2 border-s-4 border-brand ps-3">
                    <div className="text-base font-bold">{c.document} › {c.section} <span className="font-mono text-sm text-slate">({c.source})</span></div>
                    <p className="text-base">{c.snippet}</p>
                  </blockquote>
                ))}
              </div>
            )}
            <p className="flex items-start gap-2 text-base text-slate">
              <Icon name="info" size={18} className="mt-1" />
              {L("AI verification is advisory guidance, not a guarantee. When in doubt, always confirm via 8171.", "اے آئی کی جانچ صرف رہنمائی ہے، ضمانت نہیں۔ شک ہو تو ہمیشہ 8171 سے تصدیق کریں۔")}
            </p>
          </div>
        </section>
      )}
    </PageShell>
  );
}
