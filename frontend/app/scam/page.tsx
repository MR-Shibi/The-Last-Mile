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
interface ScamResult { verdict: string; color: "red" | "yellow" | "green"; probability: number; reasons_en: string[]; reasons_ur: string[]; citations: Citation[]; injection_detected: boolean }

const STYLE = {
  red: { bg: "bg-danger", icon: "⛔", en: "SCAM — do not pay", ur: "دھوکہ — رقم نہ بھیجیں", audio: "scam_warning" },
  yellow: { bg: "bg-warn", icon: "⚠️", en: "NOT SURE — call the helpline first", ur: "یقین نہیں — پہلے ہیلپ لائن پر فون کریں", audio: null },
  green: { bg: "bg-ok", icon: "✅", en: "Looks official", ur: "سرکاری لگتا ہے", audio: "safe_message" },
} as const;

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
      const audio = STYLE[r.color].audio;
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

  const s = res ? STYLE[res.color] : null;
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
            <button onClick={dict.stop} className="animate-pulse rounded-2xl border-4 border-black bg-red-200 py-4 text-xl font-bold">⏹ {L("Stop", "روکیں")}</button>
          )}
          <button disabled={busy || dict.listening} onClick={() => void check()} className="rounded-2xl bg-brand py-4 text-xl font-bold text-white disabled:opacity-50">{busy ? "…" : L("Check", "چیک کریں")}</button>
        </div>
        {dict.error && <p className="mt-2 font-bold text-danger">{dict.error === "unsupported" ? L("Voice input is not supported in this browser — paste or use a sample.", "اس براؤزر میں آواز ممکن نہیں — پیغام چسپاں کریں یا نمونہ استعمال کریں۔") : L("Could not hear you. Try again.", "آواز سنائی نہیں دی۔ دوبارہ کوشش کریں۔")}</p>}
        {res && s && (
          <div className="mt-6" role="status" aria-live="polite">
            <div data-testid="scam-verdict" data-verdict={res.verdict} className={`${s.bg} flex items-center gap-4 rounded-3xl p-6 text-white`}>
              <span className="text-6xl" aria-hidden>{s.icon}</span>
              <div className="flex-1">
                <div className="text-3xl font-bold">{lang === "ur" ? s.ur : s.en}</div>
                <div className="text-sm opacity-90" dir="ltr">{res.verdict} · risk {(res.probability * 100).toFixed(0)}%</div>
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
