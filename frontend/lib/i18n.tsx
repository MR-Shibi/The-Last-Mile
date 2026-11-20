"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "ur" | "en";

const DICT = {
  appName: { ur: "آخری میل", en: "The Last Mile" },
  tagline: { ur: "سرکاری امداد، آسان زبان میں", en: "Public relief, in plain language" },
  prototype: {
    ur: "پروٹوٹائپ — فرضی سرکاری نظام اور مصنوعی ڈیٹا",
    en: "PROTOTYPE — Simulated DPI & Synthetic Data Only",
  },
  toggle: { ur: "English", en: "اردو" },
  online: { ur: "آن لائن", en: "Online" },
  offline: { ur: "آف لائن", en: "Offline" },
} as const;

export type DictKey = keyof typeof DICT;

type Ctx = { lang: Lang; dir: "rtl" | "ltr"; setLang: (l: Lang) => void; toggle: () => void; t: (k: DictKey) => string };

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ur");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("lm.lang");
      if (saved === "en" || saved === "ur") setLangState(saved);
    } catch {
      /* storage unavailable: keep default */
    }
  }, []);

  useEffect(() => {
    const dir = lang === "ur" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem("lm.lang", l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      dir: lang === "ur" ? "rtl" : "ltr",
      setLang,
      toggle: () => setLang(lang === "ur" ? "en" : "ur"),
      t: (k) => DICT[k][lang],
    }),
    [lang, setLang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used inside LanguageProvider");
  return ctx;
}
