"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import StatusTimeline from "@/components/StatusTimeline";
import { PageShell, StatusPill } from "@/components/ui";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { COLOR_TONE } from "@/lib/status";

interface Verify { valid: boolean; reason?: string; reference?: string; status?: string; status_en?: string; status_ur?: string; color?: string }

/** Track Application: Application ID + 6-digit PIN -> live status from the server + 4-stage timeline. */
export default function ReceiptCheck() {
  const { lang, L } = useLang();
  const [caseId, setCaseId] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Verify | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const id = Number(caseId.replace(/\D/g, "").slice(-6));
    setRes(await api<Verify>("/receipts/verify", { body: { case_id: id, pin }, auth: false }).catch(() => ({ valid: false })));
    setBusy(false);
  }

  return (
    <PageShell title={L("Track Application", "درخواست کا حال")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-brand">{L("Track Application", "اپنی درخواست کا حال جانیں")}</h1>
          <p className="text-lg text-slate">
            {L("Your Application ID is printed at the top of your QR Parchi (for example LM-01-000123). The 6-digit PIN is next to the QR code.",
              "آپ کی درخواست آئی ڈی QR پرچی کے اوپر لکھی ہے (مثلاً LM-01-000123)۔ 6 ہندسوں کا پن QR کوڈ کے ساتھ لکھا ہے۔")}
          </p>
        </div>
        <SpeakButton
          text="آپ کی درخواست آئی ڈی پرچی کے اوپر لکھی ہے۔ چھ ہندسوں کا پن کیو آر کوڈ کے ساتھ لکھا ہے۔"
          textEn="Your Application ID is printed at the top of your Parchi. The six digit PIN is next to the QR code."
          size="lg"
        />
      </div>

      <form onSubmit={check} className="card mt-4 space-y-4 p-4">
        <div>
          <label htmlFor="receipt-id" className="block text-xl font-bold">{L("Application ID", "درخواست آئی ڈی")}</label>
          <input id="receipt-id" dir="ltr" value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="LM-01-000123" autoComplete="off" className="field mt-2 font-mono text-2xl" />
        </div>
        <div>
          <label htmlFor="receipt-pin" className="block text-xl font-bold">{L("6-digit PIN", "6 ہندسوں کا پن")}</label>
          <div className="relative mt-2" dir="ltr">
            <input
              id="receipt-pin"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              type={showPin ? "text" : "password"}
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              className="field pe-24 text-center font-mono text-3xl tracking-[0.4em]"
            />
            <button
              type="button"
              onClick={() => setShowPin((s) => !s)}
              aria-controls="receipt-pin"
              aria-pressed={showPin}
              aria-label={showPin ? L("Hide PIN", "پن چھپائیں") : L("Show PIN", "پن دکھائیں")}
              className="absolute end-1.5 top-1/2 flex min-h-[48px] min-w-[76px] -translate-y-1/2 items-center justify-center gap-1 rounded-lg bg-gold px-2 text-base font-bold text-ink"
            >
              <Icon name={showPin ? "eyeOff" : "eye"} size={20} />
              <span>{showPin ? L("Hide", "چھپائیں") : L("Show", "دکھائیں")}</span>
            </button>
          </div>
        </div>
        <button type="submit" disabled={busy || !caseId.trim() || pin.length < 4} className="btn btn-primary w-full text-xl">
          <Icon name="search" size={22} /> {busy ? "…" : L("Check", "چیک کریں")}
        </button>
        <details className="rounded-xl border-2 border-line bg-page p-3">
          <summary className="cursor-pointer text-lg font-bold text-brand">{L("Lost your PIN? How to recover", "پن کھو گیا؟ واپس کیسے لیں")}</summary>
          <ul className="mt-2 list-disc space-y-1 ps-6 text-lg">
            <li>{L("Log in to your citizen account and open “My applications” — your Parchi and PIN are shown there.", "اپنے شہری اکاؤنٹ میں لاگ ان کر کے “میری درخواستیں” کھولیں — وہاں پرچی اور پن موجود ہیں۔")}</li>
            <li>{L("If a community helper applied for you, ask them to open your family record with your family PIN.", "اگر کسی مددگار نے آپ کی درخواست دی تھی تو ان سے اپنے خاندانی پن کے ساتھ ریکارڈ کھلوائیں۔")}</li>
            <li>{L("Or visit the help desk with your original CNIC.", "یا اپنا اصل شناختی کارڈ لے کر ہیلپ ڈیسک جائیں۔")}</li>
            <li className="font-bold">{L("Never share your PIN with anyone who calls or sends an SMS.", "کال یا پیغام کرنے والے کسی شخص کو کبھی اپنا پن نہ بتائیں۔")}</li>
          </ul>
        </details>
      </form>

      {res && (
        <section className="mt-5" aria-live="polite">
          {res.valid ? (
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 bg-brand px-4 py-3 text-white">
                <span className="text-lg">{L("Application ID", "درخواست آئی ڈی")}</span>
                <span dir="ltr" className="inline-block font-mono text-xl font-bold">{res.reference}</span>
              </div>
              <div className="p-4">
                <div role="status">
                  <StatusPill tone={COLOR_TONE[res.color || "blue"] || "review"} className="text-lg">
                    {lang === "ur" ? res.status_ur : res.status_en}
                  </StatusPill>
                </div>
                <div className="mt-4">
                  <StatusTimeline status={res.status} />
                </div>
                <p className="mt-2 text-lg text-slate">
                  {L("The full printable QR Parchi is in your citizen account (My applications).", "مکمل پرنٹ ہونے والی QR پرچی آپ کے شہری اکاؤنٹ میں (میری درخواستیں) موجود ہے۔")}
                </p>
              </div>
            </div>
          ) : (
            <p className="panel-danger rounded-2xl p-4 text-xl font-bold" role="status">
              {L("Not found — check the Application ID and PIN.", "نہیں ملی — درخواست آئی ڈی اور پن دوبارہ چیک کریں۔")}
            </p>
          )}
        </section>
      )}
    </PageShell>
  );
}
