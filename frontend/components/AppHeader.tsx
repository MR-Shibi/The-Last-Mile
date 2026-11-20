"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { logout, useSession } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useOnline } from "@/lib/stores";
import { listOutbox } from "@/lib/offlineDb";
import { flushOutbox } from "@/lib/sync";

/** Sticky header: language toggle, Online/Offline pill, pending-outbox badge, auto-sync on reconnect. */
export default function AppHeader({ title }: { title?: string }) {
  const { t, toggle, L } = useLang();
  const online = useOnline();
  const [pending, setPending] = useState(0);
  const session = useSession();
  const router = useRouter();

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

  return (
    <header className="sticky top-0 z-40 bg-brand text-white shadow">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2">
        <Link href="/" className="text-xl font-bold whitespace-nowrap">{t("appName")}</Link>
        {title && <span className="hidden sm:inline text-lg opacity-90">· {title}</span>}
        <div className="flex-1" />
        <span
          role="status"
          aria-live="polite"
          className={`rounded-full px-3 py-1 text-sm font-bold ${online ? "bg-green-200 text-green-900" : "bg-red-200 text-red-900"}`}
        >
          ● {online ? t("online") : t("offline")}
        </span>
        {pending > 0 && (
          <button data-testid="outbox-badge" onClick={() => void trySync()} className="rounded-full bg-yellow-300 px-3 py-1 text-sm font-bold text-black" title={L("Pending uploads", "بھیجنے کے منتظر")}>
            ⏳ {pending}
          </button>
        )}
        <button onClick={toggle} className="rounded-lg border-2 border-white px-3 py-1 font-bold">{t("toggle")}</button>
        {session && (
          <button
            onClick={() => {
              logout();
              router.push("/");
            }}
            className="rounded-lg bg-white/20 px-3 py-1 text-sm"
          >
            {L("Logout", "لاگ آؤٹ")}
          </button>
        )}
      </div>
    </header>
  );
}

export function notifyOutboxChanged(): void {
  window.dispatchEvent(new Event("lm-outbox-changed"));
}
