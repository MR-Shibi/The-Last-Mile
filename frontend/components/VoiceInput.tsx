"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useDictation } from "@/lib/useDictation";
import { speak } from "@/components/SpeakButton";

interface SttResult { value: string | number | null; ambiguous: boolean; confirmation_en: string; confirmation_ur: string; yes_no: string | null; transcript: string }

/** Mic -> continuous Web Speech transcript -> /voice/stt normaliser -> mandatory read-back
 * ("Haan Sahi Hai" / "Dobara Bolein"). Typing always works too. */
export default function VoiceInput({ field, onConfirm }: { field: string; onConfirm: (value: string) => void }) {
  const { lang, L } = useLang();
  const [pending, setPending] = useState<SttResult | null>(null);

  async function normalise(transcript: string) {
    if (!transcript.trim()) return;
    try {
      const r = await api<SttResult>("/voice/stt", { body: { transcript, lang, field }, auth: false });
      setPending(r);
      void speak({ text: r.confirmation_ur, textEn: r.confirmation_en, lang });
    } catch {
      setPending({ value: transcript, ambiguous: false, confirmation_en: `You said: ${transcript}`, confirmation_ur: `آپ نے کہا: ${transcript}`, yes_no: null, transcript });
    }
  }

  const dict = useDictation({ lang, onEnd: (t) => void normalise(t) });
  const live = `${dict.finalText} ${dict.interim}`.trim();

  return (
    <div className="mt-3">
      {!dict.listening ? (
        <button type="button" onClick={() => { setPending(null); dict.start(); }} className="w-full rounded-2xl border-4 border-black bg-white py-4 text-xl font-bold">
          🎤 {L("Speak your answer", "جواب بول کر دیں")}
        </button>
      ) : (
        <button type="button" onClick={dict.stop} className="w-full animate-pulse rounded-2xl border-4 border-black bg-red-200 py-4 text-xl font-bold">
          ⏹ {L("Stop", "روکیں")}
        </button>
      )}
      {dict.listening && (
        <p className="mt-2 min-h-12 rounded-xl bg-gray-100 p-3 text-xl" aria-live="polite">
          {dict.finalText} <span className="text-gray-500">{dict.interim}</span>
          {!live && <span className="text-gray-500">{L("Listening…", "سن رہی ہوں…")}</span>}
        </p>
      )}
      {dict.error && (
        <p className="mt-2 font-bold text-danger">
          {dict.error === "unsupported"
            ? L("Voice input is not supported on this phone. Please type.", "اس فون پر آواز سے لکھنا ممکن نہیں۔ براہ کرم ٹائپ کریں۔")
            : L("Could not hear you. Try again.", "آواز سنائی نہیں دی۔ دوبارہ کوشش کریں۔")}
        </p>
      )}
      {pending && (
        <div className="mt-3 rounded-2xl border-4 border-human bg-blue-50 p-4" role="alertdialog">
          <p className="text-xl font-bold">{lang === "ur" ? pending.confirmation_ur : pending.confirmation_en}</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={pending.ambiguous || pending.value === null}
              onClick={() => {
                onConfirm(String(pending.value));
                setPending(null);
              }}
              className="rounded-xl bg-ok py-4 text-xl font-bold text-white disabled:opacity-40"
            >
              ✔ {L("Haan, Sahi Hai", "ہاں، صحیح ہے")}
            </button>
            <button type="button" onClick={() => { setPending(null); dict.start(); }} className="rounded-xl bg-warn py-4 text-xl font-bold text-white">
              ↻ {L("Dobara Bolein", "دوبارہ بولیں")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
