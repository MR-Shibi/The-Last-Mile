"use client";

import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import Icon, { type IconName } from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import { isStaff, PORTAL, ROLE_LABEL, useSession } from "@/lib/api";
import { useLang } from "@/lib/i18n";

const CARDS: { href: string; icon: IconName; en: string; ur: string; sub_en: string; sub_ur: string }[] = [
  { href: "/citizen", icon: "hand", en: "Apply for Assistance", ur: "امداد کے لیے درخواست دیں", sub_en: "Widow grant, flood relief and more", sub_ur: "بیوہ گرانٹ، سیلاب امداد اور مزید" },
  { href: "/scam", icon: "shield", en: "Verify Payment Message", ur: "ادائیگی کے پیغام کی تصدیق کریں", sub_en: "Check if an SMS is real or a scam", sub_ur: "جانیں کہ پیغام اصلی ہے یا دھوکہ" },
  { href: "/helper", icon: "users", en: "Help Multiple Families", ur: "متعدد خاندانوں کی مدد کریں", sub_en: "For community helpers — up to 40 families", sub_ur: "کمیونٹی مددگاروں کے لیے — 40 خاندان تک" },
  { href: "/receipt", icon: "receipt", en: "Track Application", ur: "اپنی درخواست کا حال جانیں", sub_en: "Use your Application ID and PIN", sub_ur: "درخواست آئی ڈی اور پن سے" },
];

export default function Home() {
  const { lang, L } = useLang();
  const session = useSession();
  // A citizen/family session must not open Helper mode (it would ask for a second login inside an active session).
  const helperLocked = session?.role === "citizen";
  return (
    <>
      <AppHeader />
      <div className="mx-auto max-w-4xl px-4 pt-3 pb-2">
        {session && isStaff(session.role) && (
          <div data-testid="staff-return-banner" role="region" aria-label={L("Your portal", "آپ کا پورٹل")} className="mb-3 rounded-2xl border-2 border-brand bg-tint p-3 text-brand">
            <p className="text-lg font-bold">
              {L(`You are currently signed in as ${ROLE_LABEL[session.role][0]}.`, `آپ اس وقت ${ROLE_LABEL[session.role][1]} کے طور پر سائن ان ہیں۔`)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={PORTAL[session.role].href} data-testid="staff-return-button" className="btn btn-primary">
                {L(`Return to ${ROLE_LABEL[session.role][0]} Portal`, `${ROLE_LABEL[session.role][1]} پورٹل پر واپس جائیں`)}{" "}
                <Icon name="forward" size={20} className="rtl:rotate-180" />
              </Link>
              {session.role === "platform_admin" && (
                <Link href="/eval" className="btn btn-secondary">
                  <Icon name="chart" size={20} /> {L("Evaluation dashboard", "جائزہ ڈیش بورڈ")}
                </Link>
              )}
            </div>
          </div>
        )}
        {/* Compact hero: one headline + one sentence, so the 4 service cards sit above the fold */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 data-testid="hero-title" className="urdu-title text-xl leading-tight font-bold text-brand sm:text-3xl">
              {L("Government assistance, made simple", "سرکاری امداد، اب نہایت آسان")}
            </h1>
            <p data-testid="hero-subtitle" className="urdu-body mt-1 text-base leading-snug text-slate sm:text-lg">
              {L(
                "Apply for support, verify payment messages, help families, and track applications.",
                "امداد کے لیے درخواست دیں، پیغامات کی تصدیق کریں، خاندانوں کی مدد کریں اور اپنی درخواست کا حال جانیں۔",
              )}
            </p>
          </div>
          <SpeakButton audioKey="welcome" size="lg" />
        </div>

        <div className="mt-3 grid auto-rows-fr gap-2 sm:grid-cols-2 sm:gap-3">
          {CARDS.map((c) =>
            helperLocked && c.href === "/helper" ? (
              <div
                key={c.href}
                data-testid="home-card"
                data-locked="true"
                aria-disabled="true"
                className="card flex h-full min-h-[80px] items-center gap-3 border-dashed bg-page p-3 text-slate sm:min-h-[112px] sm:gap-4 sm:p-4"
              >
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-line text-slate sm:h-14 sm:w-14" aria-hidden>
                  <Icon name="lock" size={26} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span data-testid="card-title" className="urdu-title block text-lg leading-snug font-bold break-words sm:text-xl">{lang === "ur" ? c.ur : c.en}</span>
                  <span data-testid="helper-locked-note" className="urdu-body block text-base leading-snug break-words">
                    {L("Helper Mode is for registered Helpers only — Logout first to switch roles", "مددگار موڈ صرف رجسٹرڈ مددگاروں کے لیے ہے — کردار بدلنے کے لیے پہلے لاگ آؤٹ کریں")}
                  </span>
                </span>
              </div>
            ) : (
            // The speaker is a sibling of the Link (never inside it), so tapping it can never navigate.
            <div key={c.href} className="relative h-full" data-testid="home-card">
              <Link
                href={c.href}
                className="card flex h-full min-h-[80px] items-center gap-3 p-3 pe-[4.5rem] transition hover:border-brand hover:bg-tint sm:min-h-[112px] sm:gap-4 sm:p-4 sm:pe-20"
              >
                <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-gold sm:h-14 sm:w-14" aria-hidden>
                  <Icon name={c.icon} size={28} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span data-testid="card-title" className="urdu-title block text-lg leading-snug font-bold break-words text-brand sm:text-xl">{lang === "ur" ? c.ur : c.en}</span>
                  <span data-testid="card-subtitle" className="urdu-body block text-base leading-snug break-words text-slate sm:text-lg">{lang === "ur" ? c.sub_ur : c.sub_en}</span>
                </span>
              </Link>
              <SpeakButton
                text={`${c.ur}۔ ${c.sub_ur}`}
                textEn={`${c.en}. ${c.sub_en}`}
                label={L(`Listen: ${c.en}`, `سنیں: ${c.ur}`)}
                className="absolute end-3 top-1/2 -translate-y-1/2 sm:end-4"
              />
            </div>
            ),
          )}
        </div>
      </div>
    </>
  );
}
