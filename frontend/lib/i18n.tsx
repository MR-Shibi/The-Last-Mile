"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useStorageValue, writeStorage } from "@/lib/stores";

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

type Ctx = { lang: Lang; dir: "rtl" | "ltr"; setLang: (l: Lang) => void; toggle: () => void; t: (k: DictKey) => string; L: (en: string, ur: string) => string };

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const saved = useStorageValue("lm.lang");
  const lang: Lang = saved === "en" ? "en" : "ur";

  useEffect(() => {
    const dir = lang === "ur" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang]);

  const setLang = useCallback((l: Lang) => writeStorage("lm.lang", l), []);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      dir: lang === "ur" ? "rtl" : "ltr",
      setLang,
      toggle: () => setLang(lang === "ur" ? "en" : "ur"),
      t: (k) => DICT[k][lang],
      L: (en, ur) => (lang === "ur" ? ur : en),
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
