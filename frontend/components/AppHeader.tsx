"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { logout, useSession } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useOnline } from "@/lib/stores";
import { listOutbox } from "@/lib/offlineDb";
import { flushOutbox } from "@/lib/sync";

/** Shared header: brand + Home/Back, live connectivity pill, pending-outbox badge (auto-sync on reconnect),
 * persistent اردو / English toggle, and a separate Staff & Role Login entry so citizens are not overwhelmed. */
export default function AppHeader({ title }: { title?: string }) {
  const { lang, setLang, t, L } = useLang();
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === "/";

  const refreshCount = useCallback(async () => {
    try {
      setPending((await listOutbox()).length);
    } catch {
      setPending(0);
    }
  }, []);

  const trySync = useCallback(async () => {
    await flushOutbox();
    await refreshCount();
  }, [refreshCount]);

  useEffect(() => {
    const on = () => void trySync(); // auto-sync the outbox the moment the connection returns
    window.addEventListener("online", on);
    window.addEventListener("lm-outbox-changed", refreshCount);
    const first = window.setTimeout(on, 0);
    const iv = window.setInterval(on, 15000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("lm-outbox-changed", refreshCount);
      window.clearTimeout(first);
      window.clearInterval(iv);
    };
  }, [trySync, refreshCount]);

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  const navBtn = "inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 font-bold text-white hover:bg-white/10";
  return (
    <header className="sticky top-0 z-40 bg-brand text-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 pt-1.5">
        <Link href="/" className="flex min-h-[44px] items-center gap-2 rounded-xl pe-2 text-xl font-bold whitespace-nowrap">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gold text-ink" aria-hidden>
            <Icon name="shield" size={22} />
          </span>
          <span dir="ltr" className="inline-block">The Last Mile</span>
        </Link>
        {title && <span className="hidden truncate text-lg text-white/80 md:inline">· {title}</span>}
        <div className="flex-1" />
        {/* Persistent language toggle (saved in localStorage, applies to every page) */}
        <div className="flex overflow-hidden rounded-xl border-2 border-white/70" role="group" aria-label={L("Language", "زبان")}>
          <button
            type="button"
            onClick={() => setLang("ur")}
            aria-pressed={lang === "ur"}
            className={`urdu min-h-[44px] px-3 text-lg font-bold ${lang === "ur" ? "bg-white text-brand" : "text-white hover:bg-white/10"}`}
          >
            اردو
          </button>
          <button
            type="button"
            onClick={() => setLang("en")}
            aria-pressed={lang === "en"}
            dir="ltr"
            className={`min-h-[44px] px-3 text-base font-bold ${lang === "en" ? "bg-white text-brand" : "text-white hover:bg-white/10"}`}
          >
            English
          </button>
        </div>
      </div>
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-3 pb-1.5" aria-label={L("Main", "مرکزی")}>
        {!isHome && (
          <>
            <button type="button" onClick={goBack} className={navBtn} aria-label={L("Back", "واپس")}>
              <Icon name="back" size={20} className="rtl:rotate-180" /> <span className="hidden sm:inline">{L("Back", "واپس")}</span>
            </button>
            <Link href="/" className={navBtn} aria-label={L("Home", "ہوم")}>
              <Icon name="home" size={20} /> <span className="hidden sm:inline">{L("Home", "ہوم")}</span>
            </Link>
          </>
        )}
        <span
          role="status"
          aria-live="polite"
          className={`pill ${online ? "pill-safe" : "pill-review"} ms-1`}
        >
          <Icon name={online ? "wifi" : "wifiOff"} size={16} strokeWidth={2.5} />
          {online ? t("online") : L("Offline — Saved Locally (Will Auto-Sync)", "آف لائن — فون میں محفوظ (خود بخود بھیج دیا جائے گا)")}
        </span>
        {pending > 0 && (
          <button
            data-testid="outbox-badge"
            type="button"
            onClick={() => void trySync()}
            className="pill pill-review min-h-[36px]"
            title={L("Pending uploads — tap to send now", "بھیجنے کے منتظر — ابھی بھیجنے کے لیے دبائیں")}
          >
            <Icon name="sync" size={16} strokeWidth={2.5} /> <span dir="ltr">{pending}</span>
          </button>
        )}
        <div className="flex-1" />
        {session ? (
          <button
            type="button"
            onClick={() => {
              logout();
              router.push("/");
            }}
            className={navBtn}
          >
            <Icon name="logout" size={20} /> <span className="hidden min-[400px]:inline">{L("Logout", "لاگ آؤٹ")}</span>
            <span className="sr-only min-[400px]:hidden">{L("Logout", "لاگ آؤٹ")}</span>
          </button>
        ) : (
          <Link href="/login" className={`${navBtn} text-base text-white/90`}>
            <Icon name="login" size={20} /> {L("Staff & Role Login", "عملہ و کردار لاگ ان")}
          </Link>
        )}
      </nav>
    </header>
  );
}

export function notifyOutboxChanged(): void {
  window.dispatchEvent(new Event("lm-outbox-changed"));
}
