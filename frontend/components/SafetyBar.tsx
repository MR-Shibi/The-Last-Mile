"use client";

import { useLang } from "@/lib/i18n";

export const TRUST_EN =
  "Independent civic-tech prototype (not an official government portal). AI checks are advisory guidance; citizen records are accessed strictly with revocable consent.";
export const TRUST_UR =
  "یہ ایک آزاد شہری ٹیکنالوجی پروٹوٹائپ ہے (سرکاری پورٹل نہیں)۔ اے آئی کی معلومات صرف رہنمائی کے لیے ہیں اور شہری ڈیٹا بااختیار اجازت سے محفوظ ہے۔";

const Ltr = ({ children }: { children: React.ReactNode }) => <span dir="ltr" className="inline-block">{children}</span>;
const EMAIL = "support@thelastmile.pk";

/** Institutional 3-line footer on every page, plus the always-visible slim PROTOTYPE strip (CLAUDE.md rule 1). */
export default function SafetyBar() {
  const { lang } = useLang();
  const ur = lang === "ur";
  const mail = <a href={`mailto:${EMAIL}`} className="font-semibold text-brand underline underline-offset-2"><Ltr>{EMAIL}</Ltr></a>;
  return (
    <>
      <footer role="contentinfo" className="mt-8 border-t-2 border-line bg-card">
        <div className="mx-auto max-w-6xl space-y-1 px-4 py-5 text-center">
          <p className="text-lg font-bold text-brand">
            {ur ? <>© <Ltr>2026</Ltr> دی لاسٹ مائل — ایک آزاد شہری فلاحی پلیٹ فارم</> : "© 2026 The Last Mile — Inclusive Civic-Tech Initiative"}
          </p>
          <p className="text-base text-ink">
            {ur ? (
              <>رابطہ: {mail} <span aria-hidden>•</span> سرکاری امداد کی تصدیق کے لیے <Ltr>8171</Ltr> پر رابطہ کریں</>
            ) : (
              <>Support: {mail} <span aria-hidden>•</span> Official Relief Verification: SMS or Dial 8171</>
            )}
          </p>
          <p data-testid="trust-notice" className="text-sm text-slate">
            {ur ? TRUST_UR : TRUST_EN}
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
