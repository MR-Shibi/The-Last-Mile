"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ApplyWizard from "@/components/ApplyWizard";
import Icon, { type IconName } from "@/components/Icon";
import Parchi from "@/components/Parchi";
import RequireRole from "@/components/RequireRole";
import SpeakButton from "@/components/SpeakButton";
import { PageShell, StatusPill } from "@/components/ui";
import { api, type Receipt, type Scheme } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { COLOR_TONE } from "@/lib/status";

const ICONS: Record<string, IconName> = { heart: "hand", home: "home", hand: "hand" };

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
  if (open)
    return (
      <>
        <Parchi r={open} />
        <button type="button" onClick={() => setOpen(null)} className="btn btn-secondary mt-4 w-full">
          <Icon name="back" size={22} className="rtl:rotate-180" /> {L("Back to my applications", "میری درخواستوں پر واپس")}
        </button>
      </>
    );

  return (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-brand">{L("Choose the help you need", "اپنی ضرورت کی مدد منتخب کریں")}</h1>
          <p className="text-lg text-slate">{L("Tap a programme to start. It takes about 4 short steps.", "شروع کرنے کے لیے پروگرام دبائیں۔ صرف 4 آسان مراحل۔")}</p>
        </div>
        <SpeakButton audioKey="welcome" size="lg" />
      </div>
      <div className="mt-4 grid gap-3">
        {schemes.map((s) => (
          <div key={s.id} className="relative" data-testid="scheme-card">
            <button
              type="button"
              data-testid="scheme-open"
              onClick={() => setActive(s)}
              className="card flex min-h-[132px] w-full items-center gap-4 p-4 pe-20 text-start transition hover:border-brand hover:bg-tint"
            >
              <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand text-gold" aria-hidden>
                <Icon name={ICONS[s.icon] || "hand"} size={30} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="urdu-title block text-xl font-bold text-brand">{lang === "ur" ? s.name_ur : s.name_en}</span>
                <span className="urdu-body block text-lg text-slate">{lang === "ur" ? s.description_ur : s.description_en}</span>
                <span className="block text-xl font-bold text-ink" dir="ltr">Rs {s.amount_pkr.toLocaleString()}</span>
              </span>
            </button>
            <SpeakButton
              text={`${s.name_ur}۔ ${s.description_ur}`}
              textEn={`${s.name_en}. ${s.description_en}`}
              size="lg"
              className="absolute end-4 top-1/2 -translate-y-1/2"
            />
          </div>
        ))}
        {!schemes.length && <p className="card p-4 text-lg">{L("Loading…", "لوڈ ہو رہا ہے…")}</p>}
      </div>

      {receipts.length > 0 && (
        <section className="mt-8">
          <h2 className="text-2xl font-bold text-brand">{L("My applications", "میری درخواستیں")}</h2>
          <ul className="mt-3 space-y-2">
            {receipts.map((r) => (
              <li key={r.case_id}>
                <button type="button" onClick={() => setOpen(r)} className="card flex min-h-[64px] w-full flex-wrap items-center gap-3 p-3 text-start hover:bg-tint">
                  <StatusPill tone={COLOR_TONE[r.color] || "review"}>{lang === "ur" ? r.status_ur : r.status_en}</StatusPill>
                  <span className="flex-1" />
                  <span className="font-mono text-lg" dir="ltr">{r.reference}</span>
                  <Icon name="forward" size={20} className="text-slate rtl:rotate-180" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href="/citizen/privacy" className="btn btn-primary mt-8 w-full text-xl">
        <Icon name="lock" size={22} /> {L("Who has my data?", "میرا ڈیٹا کس کے پاس ہے؟")}
      </Link>
    </>
  );
}

export default function CitizenPage() {
  const { L } = useLang();
  return (
    <PageShell title={L("Apply for Assistance", "امداد کے لیے درخواست")}>
      <RequireRole roles={["citizen"]}>{() => <CitizenHome />}</RequireRole>
    </PageShell>
  );
}
