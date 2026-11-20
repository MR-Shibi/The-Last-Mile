"use client";

import { useLang } from "@/lib/i18n";

export default function Home() {
  const { t, toggle } = useLang();
  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-brand">{t("appName")}</h1>
        <button onClick={toggle} className="rounded-xl border-2 border-black px-4 py-2 text-lg font-bold">
          {t("toggle")}
        </button>
      </header>
      <p className="mt-4 text-xl">{t("tagline")}</p>
    </div>
  );
}
