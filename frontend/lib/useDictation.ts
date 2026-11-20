"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Continuous Web Speech dictation: keeps listening across short pauses, accumulates every final
 * segment, exposes live interim words, and stops only on stop() or after `silenceMs` of silence. */
interface RecResultAlt { transcript: string }
interface RecResult { isFinal: boolean; 0: RecResultAlt; length: number }
interface RecEvent { resultIndex: number; results: { length: number; [i: number]: RecResult } }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null; onerror: ((e: { error?: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type RecCtor = new () => Recognition;

function getCtor(): RecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useDictation({ lang, silenceMs = 4000, onEnd }: { lang: "ur" | "en"; silenceMs?: number; onEnd?: (finalText: string) => void }) {
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const finalRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const finish = useCallback(() => {
    wantRef.current = false;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  const armSilence = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(finish, silenceMs);
  }, [finish, silenceMs]);

  const start = useCallback(() => {
    const Ctor = getCtor();
    setError(null);
    if (!Ctor) {
      setError("unsupported");
      return;
    }
    finalRef.current = "";
    setFinalText("");
    setInterim("");
    const rec = new Ctor();
    rec.lang = lang === "ur" ? "ur-PK" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current = `${finalRef.current} ${r[0].transcript}`.trim();
        else live += r[0].transcript;
      }
      setFinalText(finalRef.current);
      setInterim(live.trim());
      armSilence();
    };
    rec.onerror = (e) => {
      if (e.error && e.error !== "no-speech" && e.error !== "aborted") setError(e.error);
    };
    rec.onend = () => {
      // Browsers end sessions on their own after a pause; keep going until the user stops or silence expires.
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through and finish */
        }
      }
      setListening(false);
      setInterim("");
      onEndRef.current?.(finalRef.current);
    };
    recRef.current = rec;
    wantRef.current = true;
    setListening(true);
    armSilence();
    rec.start();
  }, [lang, armSilence]);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort();
  }, []);

  return { listening, finalText, interim, error, start, stop: finish, supported: getCtor() !== null };
}
