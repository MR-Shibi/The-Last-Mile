"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { PageShell } from "@/components/ui";
import { afterLoginPath, hardNavigate, HOME_FOR_ROLE, login, logoutAndGoHome, ROLE_LABEL, useSession } from "@/lib/api";
import { useLang } from "@/lib/i18n";

const DEMO = ["sindh.citizen", "sindh.family01", "sindh.helper", "sindh.officer", "sindh.admin", "sindh.auditor", "punjab.officer"];
const WORKSPACES: { href: string; icon: IconName; en: string; ur: string }[] = [
  { href: "/officer", icon: "clipboard", en: "Officer workspace", ur: "افسر" },
  { href: "/admin", icon: "bolt", en: "Admin console", ur: "ایڈمن" },
  { href: "/auditor", icon: "link", en: "Auditor (read-only)", ur: "آڈیٹر" },
  { href: "/eval", icon: "chart", en: "Evaluation dashboard", ur: "جائزہ ڈیش بورڈ" },
];

export default function LoginPage() {
  const { L } = useLang();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = useSession();
  const router = useRouter();
  // Already-signed-in staff/helpers go straight to their console instead of a re-login screen
  const autoGo = !!session && !busy && session.role !== "citizen";
  useEffect(() => {
    if (autoGo && session) router.replace(HOME_FOR_ROLE[session.role]);
  }, [autoGo, session, router]);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await login(username.trim(), password); // token + role saved → header badge updates everywhere
      const next = new URLSearchParams(window.location.search).get("next");
      // A `next` this role cannot open is ignored, so the user is never bounced back to this form
      hardNavigate(afterLoginPath(s.role, next)); // full load: no hidden page state from a previous account survives
    } catch {
      setError(L("Wrong username or password", "غلط نام یا پاس ورڈ"));
      setBusy(false);
    }
  }

  if (autoGo && session) {
    return (
      <PageShell title={L("Login", "لاگ ان")}>
        <p data-testid="login-redirecting" role="status" className="card mx-auto max-w-md p-5 text-lg">
          {L("You are already signed in — opening your portal…", "آپ پہلے سے سائن ان ہیں — آپ کا پورٹل کھل رہا ہے…")}
        </p>
      </PageShell>
    );
  }

  if (session && !busy) {
    const mine = L(ROLE_LABEL[session.role][0], ROLE_LABEL[session.role][1]);
    return (
      <PageShell title={L("Login", "لاگ ان")}>
        <div data-testid="already-logged-in" className="card mx-auto max-w-md space-y-4 p-5">
          <h1 className="text-2xl font-bold text-brand">{L("You are already logged in", "آپ پہلے سے لاگ ان ہیں")}</h1>
          <p className="text-lg">
            {L("Logged in:", "لاگ ان:")} <span dir="auto" className="font-bold">{session.full_name}</span> · {mine}.{" "}
            {L("Logout first to switch to another account or role.", "دوسرے اکاؤنٹ یا کردار کے لیے پہلے لاگ آؤٹ کریں۔")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={session.role === "citizen" || session.role === "community_helper" ? "/" : HOME_FOR_ROLE[session.role]} className="btn btn-primary">
              <Icon name="home" size={20} /> {L("Continue", "جاری رکھیں")}
            </Link>
            <button type="button" className="btn btn-secondary" onClick={() => void logoutAndGoHome()}>
              <Icon name="logout" size={20} /> {L("Logout", "لاگ آؤٹ")}
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title={L("Login", "لاگ ان")}>
      <div className="mx-auto max-w-md">
        <form onSubmit={go} className="card space-y-4 p-5">
          <h1 className="text-3xl font-bold text-brand">{L("Login", "لاگ ان")}</h1>
          <p className="text-lg text-slate">{L("Citizens, community helpers and staff all sign in here. Your role decides what you can see — checked on the server.", "شہری، مددگار اور عملہ سب یہیں لاگ ان کریں۔ آپ کا کردار طے کرتا ہے کہ آپ کیا دیکھ سکتے ہیں — سرور پر جانچا جاتا ہے۔")}</p>
          <div>
            <label htmlFor="login-user" className="block text-lg font-bold">{L("Username", "صارف نام")}</label>
            <input id="login-user" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="username" className="field mt-1" />
          </div>
          <div>
            <label htmlFor="login-pass" className="block text-lg font-bold">{L("Password", "پاس ورڈ")}</label>
            <input id="login-pass" dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" autoComplete="current-password" className="field mt-1" />
          </div>
          {error && <p className="panel-danger rounded-xl p-3 text-lg font-bold" role="alert">{error}</p>}
          <button type="submit" disabled={busy} className="btn btn-primary w-full text-xl">{busy ? "…" : L("Login", "لاگ ان")}</button>
          <div className="rounded-xl border-2 border-line bg-page p-3" dir="ltr">
            <p className="text-base font-bold">Synthetic demo accounts (password Demo@1234):</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEMO.map((u) => (
                <button type="button" key={u} onClick={() => { setUsername(u); setPassword("Demo@1234"); }} className="min-h-[44px] rounded-lg border-2 border-line bg-card px-3 font-mono text-base hover:bg-tint">{u}</button>
              ))}
            </div>
          </div>
        </form>
        <section className="mt-6">
          <h2 className="text-xl font-bold text-brand">{L("Staff workspaces", "عملے کے لیے")}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {WORKSPACES.map((w) => (
              <Link key={w.href} href={w.href} className="card flex min-h-[56px] items-center gap-2 p-3 text-lg font-bold text-brand hover:bg-tint">
                <Icon name={w.icon} size={22} /> {L(w.en, w.ur)}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
