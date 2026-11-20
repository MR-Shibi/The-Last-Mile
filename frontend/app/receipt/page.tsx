"use client";

import { useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";

interface Verify { valid: boolean; reason?: string; reference?: string; status_en?: string; status_ur?: string; color?: string }

export default function ReceiptCheck() {
  const { lang, L } = useLang();
  const [caseId, setCaseId] = useState("");
  const [pin, setPin] = useState("");
  const [res, setRes] = useState<Verify | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(caseId.replace(/\D/g, "").slice(-6));
    setRes(await api<Verify>("/receipts/verify", { body: { case_id: id, pin }, auth: false }).catch(() => ({ valid: false })));
  }

  return (
    <>
      <AppHeader title={L("Parchi status", "پرچی کی حالت")} />
      <form onSubmit={check} className="mx-auto mt-6 max-w-md space-y-4 px-4">
        <h1 className="text-3xl font-bold">{L("Check my Parchi", "اپنی پرچی چیک کریں")}</h1>
        <input dir="ltr" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="LM-01-000123" className="w-full rounded-xl border-4 border-black p-4 text-2xl" />
        <input dir="ltr" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" className="w-full rounded-xl border-4 border-black p-4 text-center font-mono text-3xl tracking-widest" />
        <button className="w-full rounded-xl bg-brand py-4 text-2xl font-bold text-white">{L("Check", "چیک کریں")}</button>
        {res && (
          <div className={`rounded-2xl p-5 text-xl font-bold text-white ${res.valid ? { green: "bg-ok", yellow: "bg-warn", blue: "bg-human", red: "bg-danger" }[res.color || "blue"] : "bg-gray-700"}`} role="status">
            {res.valid ? (lang === "ur" ? res.status_ur : res.status_en) : L("Not found — check the number and PIN.", "نہیں ملی — نمبر اور پن دوبارہ چیک کریں۔")}
          </div>
        )}
      </form>
    </>
  );
}
