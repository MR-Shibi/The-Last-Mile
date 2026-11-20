"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

/** Plays a pre-cached prompt (/audio/{lang}/{key}.mp3, works offline) or dynamic text via /voice/tts,
 * falling back to the browser's speechSynthesis when TTS is unavailable. */
export default function SpeakButton({ audioKey, text, textEn, size = "md", label }: {
  audioKey?: string | null; text?: string | null; textEn?: string | null; size?: "md" | "lg"; label?: string;
}) {
  const { lang, L } = useLang();
  const [busy, setBusy] = useState(false);

  async function play() {
    setBusy(true);
    try {
      if (audioKey) {
        await new Audio(`/audio/${lang}/${audioKey}.mp3`).play();
        return;
      }
      const say = lang === "ur" ? text : textEn || text;
      if (!say) return;
      try {
        const blob = await api<Blob>("/voice/tts", { body: { text: say, lang }, auth: false });
        await new Audio(URL.createObjectURL(blob)).play();
      } catch {
        if ("speechSynthesis" in window) {
          const u = new SpeechSynthesisUtterance(say);
          u.lang = lang === "ur" ? "ur-PK" : "en-US";
          window.speechSynthesis.speak(u);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const cls = size === "lg" ? "h-14 w-14 text-2xl" : "h-11 w-11 text-xl";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void play();
      }}
      aria-label={label || L("Listen", "سنیں")}
      className={`${cls} shrink-0 rounded-full bg-yellow-300 text-black shadow focus:outline-none ${busy ? "animate-pulse" : ""}`}
    >
      🔊
    </button>
  );
}
