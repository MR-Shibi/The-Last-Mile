"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import ApplyWizard from "@/components/ApplyWizard";
import Parchi from "@/components/Parchi";
import RequireRole from "@/components/RequireRole";
import SpeakButton from "@/components/SpeakButton";
import { api, type Receipt, type Scheme } from "@/lib/api";
import { useLang } from "@/lib/i18n";

const ICONS: Record<string, string> = { heart: "💗", home: "🏠", hand: "🤲" };

function CitizenHome() {
  const { lang, L } = useLang();
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [active, setActive] = useState<Scheme | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [open, setOpen] = useState<Receipt | null>(null);

  useEffect(() => {
    api<Scheme[]>("/schemes").then(setSchemes).catch(() => undefined);
    api<{ id: number }[]>("/cases")
      .then((cases) => Promise.all(cases.slice(0, 5).map((c) => api<Receipt>(`/cases/${c.id}/receipt`))))
      .then(setReceipts)
      .catch(() => undefined);
  }, [active]);

  if (active) return <ApplyWizard scheme={active} onCancel={() => setActive(null)} />;
  if (open) return (<><Parchi r={open} /><button onClick={() => setOpen(null)} className="mt-4 w-full rounded-xl border-4 border-black py-3 text-xl font-bold">← {L("Back", "پیچھے")}</button></>);

  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">{L("Choose help", "مدد منتخب کریں")}</h1>
        <SpeakButton audioKey="welcome" size="lg" />
      </div>
      <div className="mt-4 grid gap-4">
        {schemes.map((s) => (
          <div key={s.id} className="relative" data-testid="scheme-card">
            <button data-testid="scheme-open" onClick={() => setActive(s)} className="flex min-h-[168px] w-full items-center gap-4 rounded-3xl border-4 border-black bg-white p-5 pe-24 text-start shadow">
              <span className="shrink-0 text-6xl" aria-hidden>{ICONS[s.icon] || "🤲"}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-3">
                <span className="urdu-title block text-2xl font-bold">{lang === "ur" ? s.name_ur : s.name_en}</span>
                <span className="urdu-body block text-lg">{lang === "ur" ? s.description_ur : s.description_en}</span>
                <span className="block text-xl font-bold text-ok" dir="ltr">Rs {s.amount_pkr.toLocaleString()}</span>
              </span>
            </button>
            <SpeakButton text={`${s.name_ur}۔ ${s.description_ur}`} textEn={`${s.name_en}. ${s.description_en}`} size="lg"
              className="absolute end-4 top-1/2 -translate-y-1/2" />
          </div>
        ))}
        {!schemes.length && <p className="text-lg">{L("Loading…", "لوڈ ہو رہا ہے…")}</p>}
      </div>
      {receipts.length > 0 && (
        <>
          <h2 className="mt-8 text-2xl font-bold">{L("My applications", "میری درخواستیں")}</h2>
          <ul className="mt-3 space-y-2">
            {receipts.map((r) => (
              <li key={r.case_id}>
                <button onClick={() => setOpen(r)} className="flex w-full items-center gap-3 rounded-2xl border-2 border-gray-400 p-3 text-start">
                  <span className={`h-6 w-6 rounded-full ${{ green: "bg-ok", yellow: "bg-warn", blue: "bg-human", red: "bg-danger" }[r.color]}`} />
                  <span className="flex-1 text-lg">{lang === "ur" ? r.status_ur : r.status_en}</span>
                  <span className="font-mono" dir="ltr">{r.reference}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link href="/citizen/privacy" className="mt-8 block rounded-2xl bg-black p-5 text-center text-2xl font-bold text-white">
        🔒 {L("Who has my data?", "میرا ڈیٹا کس کے پاس ہے؟")}
      </Link>
    </>
  );
}

export default function CitizenPage() {
  const { L } = useLang();
  return (
    <>
      <AppHeader title={L("Citizen", "شہری")} />
      <div className="mx-auto max-w-xl px-4 py-6">
        <RequireRole roles={["citizen"]}>{() => <CitizenHome />}</RequireRole>
      </div>
    </>
  );
}
