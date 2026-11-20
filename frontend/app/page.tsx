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
  const { lang, t, L } = useLang();
  return (
    <>
      <AppHeader />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-brand">{t("tagline")}</h1>
          <SpeakButton audioKey="welcome" size="lg" />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {CARDS.map((c) => (
            <Link key={c.href} href={c.href} className={`${c.color} flex min-h-36 items-center gap-4 rounded-3xl p-5 text-white shadow-lg`}>
              <span className="text-6xl" aria-hidden>{c.icon}</span>
              <span className="flex-1">
                <span className="block text-2xl font-bold">{lang === "ur" ? c.ur : c.en}</span>
                <span className="block text-lg opacity-90">{lang === "ur" ? c.sub_ur : c.sub_en}</span>
              </span>
              <SpeakButton text={c.ur} textEn={c.en} />
            </Link>
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
