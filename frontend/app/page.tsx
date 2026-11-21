"use client";

import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import SpeakButton from "@/components/SpeakButton";
import { useLang } from "@/lib/i18n";

const CARDS = [
  { href: "/citizen", icon: "🤲", en: "Apply for relief", ur: "امداد کے لیے درخواست", sub_en: "Widow grant, flood support", sub_ur: "بیوہ گرانٹ، سیلاب امداد", color: "bg-ok", audio: "welcome" },
  { href: "/scam", icon: "🛡️", en: "Check a payment SMS", ur: "ادائیگی کا پیغام چیک کریں", sub_en: "Scam Shield for shopkeepers", sub_ur: "دکانداروں کے لیے دھوکہ ڈھال", color: "bg-danger" },
  { href: "/helper", icon: "👥", en: "Helper mode", ur: "مددگار موڈ", sub_en: "Help up to 40 families", sub_ur: "40 خاندانوں تک کی مدد", color: "bg-human" },
  { href: "/receipt", icon: "🧾", en: "Check my Parchi", ur: "اپنی پرچی چیک کریں", sub_en: "Status with your 6-digit PIN", sub_ur: "6 ہندسوں کے پن سے حالت", color: "bg-warn" },
];

export default function Home() {
  const { lang, L } = useLang();
  return (
    <>
      <AppHeader />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center gap-3">
          <h1 data-testid="hero-title" className="urdu-title text-3xl font-bold text-brand">
            {L("Government assistance, made simple", "سرکاری امداد، اب نہایت آسان")}
          </h1>
          <SpeakButton audioKey="welcome" size="lg" />
        </div>
        <p data-testid="hero-subtitle" className="urdu-body mt-2 text-lg text-gray-800">
          {L(
            "Apply for support, verify payment messages, help families, and track applications.",
            "امداد کے لیے درخواست دیں، پیغامات کی تصدیق کریں، خاندانوں کی مدد کریں اور اپنی درخواست کا حال جانیں۔",
          )}
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {CARDS.map((c) => (
            // Speaker is a sibling of the Link (not inside it), so tapping it can never navigate.
            <div key={c.href} className="relative" data-testid="home-card">
              <Link href={c.href} className={`${c.color} flex min-h-[168px] items-center gap-4 rounded-3xl p-5 pe-20 text-white shadow-lg`}>
                <span className="shrink-0 text-6xl" aria-hidden>{c.icon}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-3">
                  <span data-testid="card-title" className="urdu-title block text-2xl font-bold break-words">{lang === "ur" ? c.ur : c.en}</span>
                  <span data-testid="card-subtitle" className="urdu-body block text-lg opacity-90 break-words">{lang === "ur" ? c.sub_ur : c.sub_en}</span>
                </span>
              </Link>
              <SpeakButton text={c.ur} textEn={c.en} className="absolute end-4 top-1/2 -translate-y-1/2" />
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-2xl border-2 border-gray-300 p-4">
          <h2 className="text-xl font-bold">{L("Staff workspaces", "عملے کے لیے")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {[["/officer", "Officer", "افسر"], ["/admin", "Admin", "ایڈمن"], ["/auditor", "Auditor", "آڈیٹر"], ["/eval", "Evaluation", "جائزہ"]].map(([h, en, ur]) => (
              <Link key={h} href={h} className="rounded-xl border-2 border-brand px-4 py-2 font-bold text-brand">{lang === "ur" ? ur : en}</Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
