"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { HOME_FOR_ROLE, login } from "@/lib/api";
import { useLang } from "@/lib/i18n";

const DEMO = ["sindh.citizen", "sindh.family01", "sindh.helper", "sindh.officer", "sindh.admin", "sindh.auditor", "punjab.officer"];

export default function LoginPage() {
  const { L } = useLang();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await login(username.trim(), password);
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : HOME_FOR_ROLE[s.role];
    } catch {
      setError(L("Wrong username or password", "غلط نام یا پاس ورڈ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader title={L("Login", "لاگ ان")} />
      <form onSubmit={go} className="mx-auto mt-8 max-w-md space-y-4 px-4">
        <h1 className="text-3xl font-bold">{L("Login", "لاگ ان")}</h1>
        <input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoComplete="username" className="w-full rounded-xl border-4 border-black p-4 text-xl" />
        <input dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" autoComplete="current-password" className="w-full rounded-xl border-4 border-black p-4 text-xl" />
        {error && <p className="font-bold text-danger" role="alert">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-brand py-4 text-2xl font-bold text-white disabled:opacity-50">{busy ? "…" : L("Login", "لاگ ان")}</button>
        <div className="rounded-xl bg-gray-100 p-3 text-sm" dir="ltr">
          <p className="font-bold">Synthetic demo accounts (password Demo@1234):</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DEMO.map((u) => (
              <button type="button" key={u} onClick={() => { setUsername(u); setPassword("Demo@1234"); }} className="rounded border border-gray-500 px-2 py-1">{u}</button>
            ))}
          </div>
        </div>
      </form>
    </>
  );
}
