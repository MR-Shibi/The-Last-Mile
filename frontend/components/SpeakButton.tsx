"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { useLang, type Lang } from "@/lib/i18n";

/** Text of every pre-cached prompt, so a missing/failed MP3 can still be spoken via TTS. */
export const PROMPT_TEXT: Record<string, Record<Lang, string>> = {
  welcome: { ur: "خوش آمدید۔ امداد کے لیے درخواست دینے کے لیے نیچے بڑا بٹن دبائیں۔", en: "Welcome. Press the big button below to apply for relief." },
  consent_ask: { ur: "کیا آپ اجازت دیتی ہیں کہ افسر آپ کی معلومات دیکھ سکے؟ آپ یہ اجازت کسی بھی وقت واپس لے سکتی ہیں۔", en: "Do you allow the officer to see your information? You can take this permission back at any time." },
  retake_photo: { ur: "تصویر صاف نہیں ہے۔ براہ کرم روشنی میں فون ساکن رکھ کر دوبارہ تصویر لیں۔", en: "The photo is not clear. Please hold the phone still in good light and take it again." },
  sent_to_officer: { ur: "ہمیں یقین نہیں، اس لیے آپ کا کیس ایک افسر کو بھیج دیا گیا ہے۔ آپ کی درخواست مسترد نہیں ہوئی۔", en: "We are not sure, so your case has been sent to an officer. You have not been rejected." },
  scam_warning: { ur: "خبردار! یہ پیغام دھوکہ لگتا ہے۔ کوئی رقم یا کوڈ نہ بھیجیں۔", en: "Warning! This message looks like a scam. Do not send any money or codes." },
  safe_message: { ur: "یہ پیغام سرکاری لگتا ہے۔ پھر بھی کبھی کسی کو فیس یا پن نہ دیں۔", en: "This message looks official. Still, never give anyone a fee or your PIN." },
};

let current: HTMLAudioElement | null = null;

/** Resolves once playback has actually started; rejects if the file is missing or cannot play. */
function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    current?.pause();
    const a = new Audio(url);
    current = a;
    a.onerror = () => reject(new Error(`audio failed: ${url}`));
    a.play().then(resolve, reject);
  });
}

function speakBrowser(text: string, lang: Lang): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "ur" ? "ur-PK" : "en-US";
  window.speechSynthesis.speak(u);
  return true;
}

/** Fallback chain so no speaker is ever silent: static clip -> /voice/tts -> speechSynthesis. */
export async function speak(opts: { audioKey?: string | null; text?: string | null; textEn?: string | null; lang: Lang }): Promise<void> {
  const { audioKey, lang } = opts;
  if (audioKey) {
    try {
      await playUrl(`/audio/${lang}/${audioKey}.mp3`);
      return;
    } catch {
      /* fall through to TTS */
    }
  }
  const say = (lang === "ur" ? opts.text : opts.textEn || opts.text) || (audioKey ? PROMPT_TEXT[audioKey]?.[lang] : null);
  if (!say) return;
  try {
    const blob = await api<Blob>("/voice/tts", { body: { text: say, lang }, auth: false });
    if (!(blob instanceof Blob) || blob.size === 0) throw new Error("empty tts");
    await playUrl(URL.createObjectURL(blob));
  } catch {
    speakBrowser(say, lang);
  }
}

export default function SpeakButton({ audioKey, text, textEn, size = "md", label, className = "" }: {
  audioKey?: string | null; text?: string | null; textEn?: string | null; size?: "md" | "lg"; label?: string; className?: string;
}) {
  const { lang, L } = useLang();
  const [busy, setBusy] = useState(false);

  async function play() {
    setBusy(true);
    try {
      await speak({ audioKey, text, textEn, lang });
    } finally {
      setBusy(false);
    }
  }

  // Never let a speaker tap bubble to an enclosing card/link/form (it must not navigate or submit).
  const block = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const cls = size === "lg" ? "h-14 w-14 text-2xl" : "h-11 w-11 text-xl";
  return (
    <button
      type="button"
      data-testid="speak-button"
      onMouseDown={block}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        block(e);
        void play();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          block(e);
          void play();
        }
      }}
      aria-label={label || L("Listen", "سنیں")}
      className={`${cls} shrink-0 rounded-full bg-yellow-300 text-black shadow ${busy ? "animate-pulse" : ""} ${className}`}
    >
      🔊
    </button>
  );
}
