"use client";

import Icon from "@/components/Icon";
import { useLang } from "@/lib/i18n";

export const TRUST_EN =
  "Independent Civic-Tech Prototype — Uses synthetic demo records only; not affiliated with or endorsed by any government department. Citizen data is encrypted, used solely for eligibility verification, and accessible strictly with revocable consent. AI outputs are advisory and never auto-reject applicants.";
export const TRUST_UR =
  "آزاد شہری ٹیکنالوجی پروٹوٹائپ — صرف مصنوعی نمونہ ریکارڈ استعمال ہوتے ہیں؛ کسی سرکاری محکمے سے وابستہ یا اس کا منظور شدہ نہیں۔ شہری کا ڈیٹا محفوظ (انکرپٹڈ) رکھا جاتا ہے، صرف اہلیت کی تصدیق کے لیے استعمال ہوتا ہے، اور صرف قابلِ واپسی اجازت سے دیکھا جا سکتا ہے۔ اے آئی کے نتائج صرف مشورہ ہیں اور کبھی کسی درخواست کو خودبخود مسترد نہیں کرتے۔";

/** Persistent trust & privacy notice on every page, plus an always-visible slim PROTOTYPE strip. */
export default function SafetyBar() {
  const { lang } = useLang();
  return (
    <>
      <footer role="contentinfo" className="mt-8 border-t-2 border-line bg-card">
        <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-5">
          <span className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand" aria-hidden>
            <Icon name="shield" size={22} />
          </span>
          <p data-testid="trust-notice" className="text-lg text-ink">
            {lang === "ur" ? TRUST_UR : TRUST_EN}
          </p>
        </div>
      </footer>
      <div className="fixed inset-x-0 bottom-0 z-50 bg-brand px-2 py-1 text-center text-[13px] font-bold tracking-tight whitespace-nowrap text-white sm:py-1.5 sm:text-base sm:tracking-normal" aria-label="Prototype notice">
        <span dir="ltr" className="inline-block">PROTOTYPE — Simulated DPI &amp; Synthetic Data Only</span>
        {lang === "ur" && <span className="urdu ms-2 hidden text-base font-normal sm:inline">· پروٹوٹائپ — فرضی سرکاری نظام اور مصنوعی ڈیٹا</span>}
      </div>
    </>
  );
}
