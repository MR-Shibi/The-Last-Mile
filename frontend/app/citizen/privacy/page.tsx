"use client";

import { useCallback, useEffect, useState } from "react";
import ConsentPanel from "@/components/ConsentPanel";
import RequireRole from "@/components/RequireRole";
import SpeakButton from "@/components/SpeakButton";
import { PageShell, StatusPill } from "@/components/ui";
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
    let pin: string | undefined;
    if (on) pin = (await api<{ helper_pin?: string }>("/consents", { body: { scope } })).helper_pin;
    else {
      for (const c of consents.filter((x) => x.scope === scope && x.active)) await api(`/consents/${c.id}`, { method: "DELETE" });
    }
    setMsg(
      pin
        ? L(`Permission given. Your community helper is now linked — tell them this family PIN in person (shown once): ${pin}`,
            `اجازت دے دی گئی۔ آپ کی کمیونٹی مددگار شامل ہو گئی — یہ خاندانی پن انہیں خود بتائیں (صرف ایک بار): ${pin}`)
        : on ? L("Permission given.", "اجازت دے دی گئی۔") : L("Access withdrawn. Nobody can see this from now on.", "اجازت واپس لے لی گئی۔ اب کوئی یہ نہیں دیکھ سکتا۔"),
    );
    await load();
  }

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-brand">{L("Who has my data?", "میرا ڈیٹا کس کے پاس ہے؟")}</h1>
          <p className="text-lg text-slate">{L("Switch OFF to take back access at once. Officers are blocked immediately.", "فوراً اجازت واپس لینے کے لیے بٹن بند کریں۔ افسر کی رسائی اسی وقت بند ہو جاتی ہے۔")}</p>
        </div>
        <SpeakButton audioKey="consent_ask" size="lg" />
      </div>
      <div className="card mt-4 p-4">
        <ConsentPanel value={active} onChange={(s, on) => void toggle(s, on)} />
      </div>
      {msg && <p className="panel-safe mt-4 rounded-xl p-3 text-xl font-bold" role="status">{msg}</p>}
      <h2 className="mt-8 text-2xl font-bold text-brand">{L("History", "تاریخ")}</h2>
      <div className="table-wrap mt-2">
        <table className="text-lg">
          <tbody>
            {consents.map((c) => (
              <tr key={c.id}>
                <td dir="ltr">{c.scope}</td>
                <td><StatusPill tone={c.active ? "safe" : "neutral"}>{c.active ? L("ON", "آن") : L("OFF", "بند")}</StatusPill></td>
                <td dir="ltr" className="text-slate">{new Date(c.revoked_at || c.granted_at).toLocaleString(lang === "ur" ? "ur-PK" : "en-GB")}</td>
              </tr>
            ))}
            {!consents.length && <tr><td className="text-slate">{L("No permissions yet.", "ابھی کوئی اجازت نہیں۔")}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function PrivacyPage() {
  const { L } = useLang();
  return (
    <PageShell title={L("Privacy", "رازداری")}>
      <RequireRole roles={["citizen"]}>{() => <PrivacyCenter />}</RequireRole>
    </PageShell>
  );
}
