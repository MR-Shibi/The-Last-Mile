"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import ConsentPanel from "@/components/ConsentPanel";
import RequireRole from "@/components/RequireRole";
import SpeakButton from "@/components/SpeakButton";
import { api, type Consent } from "@/lib/api";
import { useLang } from "@/lib/i18n";

/** "Who Has My Data" privacy centre: one tap withdraws access immediately (server re-checks every read). */
function PrivacyCenter() {
  const { lang, L } = useLang();
  const [consents, setConsents] = useState<Consent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api<Consent[]>("/consents").then(setConsents).catch(() => undefined), []);
  useEffect(() => void load(), [load]);

  const active = Object.fromEntries(consents.filter((c) => c.active).map((c) => [c.scope, true]));

  async function toggle(scope: string, on: boolean) {
    if (on) await api("/consents", { body: { scope } });
    else {
      for (const c of consents.filter((x) => x.scope === scope && x.active)) await api(`/consents/${c.id}`, { method: "DELETE" });
    }
    setMsg(on ? L("Permission given.", "اجازت دے دی گئی۔") : L("Access withdrawn. Nobody can see this from now on.", "اجازت واپس لے لی گئی۔ اب کوئی یہ نہیں دیکھ سکتا۔"));
    await load();
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">{L("Who has my data?", "میرا ڈیٹا کس کے پاس ہے؟")}</h1>
        <SpeakButton audioKey="consent_ask" size="lg" />
      </div>
      <p className="my-3 text-lg">{L("Switch OFF to take back access at once.", "فوراً اجازت واپس لینے کے لیے بٹن بند کریں۔")}</p>
      <ConsentPanel value={active} onChange={(s, on) => void toggle(s, on)} />
      {msg && <p className="mt-4 rounded-xl bg-green-100 p-3 text-xl font-bold text-green-900" role="status">{msg}</p>}
      <h2 className="mt-8 text-2xl font-bold">{L("History", "تاریخ")}</h2>
      <ul className="mt-2 space-y-1 text-base">
        {consents.map((c) => (
          <li key={c.id} className="flex justify-between gap-2 border-b py-1" dir="ltr">
            <span>{c.scope}</span>
            <span>{c.active ? "ON" : "OFF"} · {new Date(c.revoked_at || c.granted_at).toLocaleString(lang === "ur" ? "ur-PK" : "en-GB")}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function PrivacyPage() {
  const { L } = useLang();
  return (
    <>
      <AppHeader title={L("Privacy", "رازداری")} />
      <div className="mx-auto max-w-xl px-4 py-6">
        <RequireRole roles={["citizen"]}>{() => <PrivacyCenter />}</RequireRole>
      </div>
    </>
  );
}
