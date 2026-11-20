"use client";

import { useLang } from "@/lib/i18n";

export default function PrototypeFooter() {
  const { lang } = useLang();
  return (
    <footer
      role="contentinfo"
      className="fixed bottom-0 inset-x-0 z-50 bg-black text-yellow-300 text-center text-sm font-bold py-2 px-3"
    >
      <span dir="ltr">PROTOTYPE — Simulated DPI &amp; Synthetic Data Only</span>
      {lang === "ur" && <span className="urdu block text-xs font-normal">پروٹوٹائپ — فرضی سرکاری نظام اور مصنوعی ڈیٹا</span>}
    </footer>
  );
}
