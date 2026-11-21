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
      <span data-testid="trust-notice" dir={lang === "ur" ? "rtl" : "ltr"} className={`${lang === "ur" ? "urdu" : ""} block text-xs font-normal text-white`}>
        {lang === "ur"
          ? "آزاد شہری ٹیکنالوجی پروٹوٹائپ — صرف مصنوعی نمونہ ریکارڈ؛ یہ سرکاری پورٹل نہیں۔ شہری کا ڈیٹا صرف قابلِ واپسی اجازت سے دیکھا جاتا ہے۔"
          : "Independent Civic-Tech Prototype — Synthetic demo records only; not an official government portal. Citizen data is accessed strictly with revocable consent."}
      </span>
    </footer>
  );
}
