"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

interface SttResult { value: string | number | null; ambiguous: boolean; confirmation_en: string; confirmation_ur: string; yes_no: string | null; transcript: string }

type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; maxAlternatives: number;
  onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
  onerror: () => void; onend: () => void; start: () => void;
};

/** Mic -> Web Speech API transcript -> /voice/stt normaliser -> mandatory read-back
 * ("Haan Sahi Hai" / "Dobara Bolein"). Typing always works too. */
export default function VoiceInput({ field, onConfirm }: { field: string; onConfirm: (value: string) => void }) {
  const { lang, L } = useLang();
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<SttResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function normalise(transcript: string) {
    try {
      const r = await api<SttResult>("/voice/stt", { body: { transcript, lang, field }, auth: false });
      setPending(r);
      const say = lang === "ur" ? r.confirmation_ur : r.confirmation_en;
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(say);
        u.lang = lang === "ur" ? "ur-PK" : "en-US";
        window.speechSynthesis.speak(u);
      }
    } catch {
      setPending({ value: transcript, ambiguous: false, confirmation_en: `You said: ${transcript}`, confirmation_ur: `آپ نے کہا: ${transcript}`, yes_no: null, transcript });
    }
  }

  function listen() {
    setErr(null);
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) {
      setErr(L("Voice input is not supported on this phone. Please type.", "اس فون پر آواز سے لکھنا ممکن نہیں۔ براہ کرم ٹائپ کریں۔"));
      return;
    }
    const rec = new Ctor();
    rec.lang = lang === "ur" ? "ur-PK" : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => void normalise(e.results[0][0].transcript);
    rec.onerror = () => setErr(L("Could not hear you. Try again.", "آواز سنائی نہیں دی۔ دوبارہ کوشش کریں۔"));
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={listen} className={`w-full rounded-2xl border-4 border-black py-4 text-xl font-bold ${listening ? "bg-red-200 animate-pulse" : "bg-white"}`}>
        🎤 {listening ? L("Listening…", "سن رہی ہوں…") : L("Speak your answer", "جواب بول کر دیں")}
      </button>
      {err && <p className="mt-2 text-danger font-bold">{err}</p>}
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
            <button type="button" onClick={() => { setPending(null); listen(); }} className="rounded-xl bg-warn py-4 text-xl font-bold text-white">
              ↻ {L("Dobara Bolein", "دوبارہ بولیں")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
