"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import BrandLogo from "@/components/BrandLogo";
import DecisionModal from "@/components/DecisionModal";
import Icon from "@/components/Icon";
import { FLASH_KEY, logoutAndGoHome, PORTAL, ROLE_LABEL, useSession } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useOnline, useSessionValue, writeSessionValue } from "@/lib/stores";
import { listOutbox, ownedBy } from "@/lib/offlineDb";
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
  const flash = useSessionValue(FLASH_KEY);
  const userId = session?.user_id;

  // One-shot "Logged out successfully" banner, auto-hidden after 6 s
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => writeSessionValue(FLASH_KEY, null), 6000);
    return () => window.clearTimeout(t);
  }, [flash]);

  // Pending uploads that belong to the account on this phone right now
  const refreshCount = useCallback(async () => {
    try {
      setPending((await listOutbox()).filter((i) => ownedBy(i, userId)).length);
    } catch {
      setPending(0);
    }
  }, [userId]);

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
    <header className="relative z-40 bg-brand sm:sticky sm:top-0 text-white shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 pt-1.5">
        <Link href="/" className="flex min-h-[44px] items-center gap-2 rounded-xl pe-2 text-xl font-bold whitespace-nowrap">
          <BrandLogo />
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
          <>
            <span
              data-testid="account-badge"
              data-role={session.role}
              className="order-last inline-flex min-h-[40px] w-full min-w-0 items-center gap-1.5 rounded-xl bg-gold px-3 text-base font-bold text-ink sm:order-none sm:w-auto sm:max-w-[22rem]"
              title={`${session.full_name} — ${ROLE_LABEL[session.role][0]}`}
            >
              <Icon name="users" size={18} strokeWidth={2.5} />
              <span className="truncate">
                {L("Logged in:", "لاگ ان:")} {L(ROLE_LABEL[session.role][0], ROLE_LABEL[session.role][1])}
                <span className="font-normal"> · <span dir="auto">{session.full_name}</span></span>
              </span>
            </span>
            {/* Way back to the role's own console from anywhere (Home included) */}
            <Link
              href={PORTAL[session.role].href}
              data-testid="portal-button"
              aria-current={pathname === PORTAL[session.role].href ? "page" : undefined}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gold px-3 font-semibold text-ink hover:brightness-95 sm:px-4"
            >
              <Icon name="layers" size={20} className="hidden sm:block" /> {L(PORTAL[session.role].en, PORTAL[session.role].ur)}
            </Link>
            <button
              type="button"
              data-testid="logout-button"
              onClick={() => void logoutAndGoHome()}
              aria-label={L("Logout", "لاگ آؤٹ")}
              className={`${navBtn} border-2 border-white/70`}
            >
              <Icon name="logout" size={20} /> <span className="hidden sm:inline">{L("Logout", "لاگ آؤٹ")}</span>
            </button>
          </>
        ) : (
          <Link href="/login" className={`${navBtn} text-base text-white/90`}>
            <Icon name="login" size={20} /> {L("Staff & Role Login", "عملہ و کردار لاگ ان")}
          </Link>
        )}
      </nav>
      {flash === "logged_out" && (
        <div role="status" data-testid="logout-toast" className="border-t-2 border-gold bg-tint text-brand">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 text-lg font-bold">
            <Icon name="checkCircle" size={22} />
            <span className="flex-1">
              <span dir="ltr" className="inline-block">Logged out successfully</span> / <span className="urdu">کامیابی سے لاگ آؤٹ ہو گئے</span>
            </span>
            <button type="button" onClick={() => writeSessionValue(FLASH_KEY, null)} className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-white" aria-label={L("Close", "بند کریں")}>
              <Icon name="x" size={20} />
            </button>
          </div>
        </div>
      )}
      <DecisionModal />
    </header>
  );
}

export function notifyOutboxChanged(): void {
  window.dispatchEvent(new Event("lm-outbox-changed"));
}
