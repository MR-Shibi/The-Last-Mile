"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import SpeakButton, { speak } from "@/components/SpeakButton";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useDictation } from "@/lib/useDictation";

const SAMPLE_SCAM = "Mubarak ho! Aap ka 25000 rupay ka BISP inaam nikla hai. Foran 500 rupay processing fee is number 0301-5550123 par Easypaisa karein warna raqam wapas chali jayegi.";
const SAMPLE_OFFICIAL = "8171: Aap ki BISP qist Rs 25000 tayyar hai. Asal CNIC ke sath qareebi campsite se wasool karein. Koi fee nahi. Apna PIN kisi ko na batayen.";

interface Citation { source: string; document: string; section: string; snippet: string }
type Verdict = "SCAM" | "UNCERTAIN_HUMAN_REVIEW" | "NOT_A_GOV_MESSAGE" | "OFFICIAL_STYLE_NOTICE" | "BLOCKED_PROMPT_INJECTION";
interface ScamResult {
  verdict: Verdict; color: "red" | "amber" | "neutral" | "green"; headline_en: string; headline_ur: string; probability: number;
  reasons_en: string[]; reasons_ur: string[]; citations: Citation[]; injection_detected: boolean;
}

/** Visual style per verdict. The headline text always comes from the server, which never claims a message is
 * "100% government": low risk alone only means "not a government relief message" unless official markers match. */
const STYLE: Record<Verdict, { bg: string; icon: string; label_en: string; label_ur: string; audio: string | null }> = {
  SCAM: { bg: "bg-danger text-white", icon: "⛔", label_en: "SCAM", label_ur: "دھوکہ دہی", audio: "scam_warning" },
  BLOCKED_PROMPT_INJECTION: { bg: "bg-danger text-white", icon: "🛑", label_en: "BLOCKED", label_ur: "روک دیا گیا", audio: "scam_warning" },
  UNCERTAIN_HUMAN_REVIEW: { bg: "bg-amber-400 text-black", icon: "⚠️", label_en: "NOT SURE", label_ur: "مشکوک", audio: null },
  NOT_A_GOV_MESSAGE: { bg: "bg-slate-600 text-white", icon: "💬", label_en: "NOT A GOVERNMENT MESSAGE", label_ur: "غیر سرکاری یا عام پیغام", audio: null },
  OFFICIAL_STYLE_NOTICE: { bg: "bg-ok text-white", icon: "ℹ️", label_en: "OFFICIAL-STYLE NOTICE", label_ur: "سرکاری طرز کا پیغام", audio: "safe_message" },
};

/** Shopkeeper Scam Shield: paste or speak an SMS -> big verdict card + Urdu reasons + official source. */
export default function ScamShield() {
  const { lang, L } = useLang();
  const [text, setText] = useState("");
  const [res, setRes] = useState<ScamResult | null>(null);
  const [busy, setBusy] = useState(false);
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
    try {
      const r = await api<ScamResult>("/scam/check", { body: { text: msg } });
      setRes(r);
      const audio = STYLE[r.verdict]?.audio ?? null;
      void speak({ audioKey: audio, text: r.reasons_ur.join(" "), textEn: r.reasons_en.join(" "), lang });
    } finally {
      setBusy(false);
    }
  }

  function runSample(msg: string) {
    if (dict.listening) dict.stop();
    setText(msg);
    void check(msg);
  }

  const s = res ? STYLE[res.verdict] ?? STYLE.UNCERTAIN_HUMAN_REVIEW : null;
  return (
    <>
      <AppHeader title={L("Scam Shield", "دھوکہ ڈھال")} />
      <div className="mx-auto max-w-xl px-4 py-6">
        <h1 className="text-3xl font-bold">🛡️ {L("Is this payment SMS real?", "کیا یہ ادائیگی کا پیغام اصلی ہے؟")}</h1>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button onClick={() => runSample(SAMPLE_SCAM)} className="rounded-2xl border-4 border-danger bg-red-50 px-3 py-3 text-lg font-bold">
            🧪 {L("Sample Scam SMS", "نمونہ دھوکہ پیغام")}
          </button>
          <button onClick={() => runSample(SAMPLE_OFFICIAL)} className="rounded-2xl border-4 border-ok bg-green-50 px-3 py-3 text-lg font-bold">
            🧪 {L("Sample Official SMS", "نمونہ اصلی پیغام")}
          </button>
        </div>
        <textarea value={shown} readOnly={dict.listening} onChange={(e) => setText(e.target.value)} rows={5} placeholder={L("Paste the SMS here", "پیغام یہاں چسپاں کریں")} className="mt-4 w-full rounded-2xl border-4 border-black p-4 text-xl" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          {!dict.listening ? (
            <button onClick={() => { setBase(text); dict.start(); }} className="rounded-2xl border-4 border-black bg-white py-4 text-xl font-bold">🎤 {L("Speak", "بولیں")}</button>
          ) : (
            <button onClick={dict.stop} className="animate-pulse rounded-2xl border-4 border-black bg-red-200 ring-4 ring-red-600 ring-offset-2 py-4 text-xl font-bold">⏹ {L("Stop", "روکیں")}</button>
          )}
          <button disabled={busy || dict.listening} onClick={() => void check()} className="rounded-2xl bg-brand py-4 text-xl font-bold text-white disabled:opacity-50">{busy ? "…" : L("Check", "چیک کریں")}</button>
        </div>
        {dict.error && <p className="mt-2 font-bold text-danger">{dict.error === "unsupported" ? L("Voice input is not supported in this browser — paste or use a sample.", "اس براؤزر میں آواز ممکن نہیں — پیغام چسپاں کریں یا نمونہ استعمال کریں۔") : L("Could not hear you. Try again.", "آواز سنائی نہیں دی۔ دوبارہ کوشش کریں۔")}</p>}
        {res && s && (
          <div className="mt-6" role="status" aria-live="polite">
            <div data-testid="scam-verdict" data-verdict={res.verdict} data-color={res.color} className={`${s.bg} flex items-center gap-4 rounded-3xl p-6`}>
              <span className="text-6xl" aria-hidden>{s.icon}</span>
              <div className="flex-1">
                <div className="text-sm font-bold opacity-90">{lang === "ur" ? s.label_ur : s.label_en}</div>
                <div className="text-2xl font-bold">{lang === "ur" ? res.headline_ur : res.headline_en}</div>
                <div className="text-sm opacity-90" dir="ltr">scam risk score {(res.probability * 100).toFixed(0)} / 100</div>
              </div>
              <SpeakButton audioKey={s.audio} text={res.reasons_ur.join(" ")} textEn={res.reasons_en.join(" ")} size="lg" />
            </div>
            <ul className="mt-4 space-y-2 text-xl">
              {(lang === "ur" ? res.reasons_ur : res.reasons_en).map((r) => <li key={r}>• {r}</li>)}
            </ul>
            {res.citations.length > 0 && (
              <div className="mt-4 rounded-2xl border-2 border-gray-400 bg-gray-50 p-4" dir="ltr">
                <p className="font-bold">📘 Official source</p>
                {res.citations.map((c) => (
                  <blockquote key={c.source + c.section} className="mt-2 border-s-4 border-brand ps-3">
                    <div className="text-sm font-bold">{c.document} › {c.section} <span className="font-mono text-xs">({c.source})</span></div>
                    <p className="text-base">{c.snippet}</p>
                  </blockquote>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
