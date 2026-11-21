"use client";

import { QRCodeSVG } from "qrcode.react";
import type { Receipt } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { COLOR_TONE } from "@/lib/status";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import StatusTimeline from "@/components/StatusTimeline";

const BADGE: Record<string, { en: string; ur: string; icon: "checkCircle" | "alert" | "users" | "x" }> = {
  green: { en: "GREEN", ur: "سبز", icon: "checkCircle" },
  yellow: { en: "YELLOW — MORE PROOF", ur: "پیلا — مزید ثبوت", icon: "alert" },
  blue: { en: "WITH AN OFFICER — NOT REJECTED", ur: "افسر کے پاس — مسترد نہیں", icon: "users" },
  red: { en: "NOT APPROVED — YOU CAN APPEAL", ur: "منظور نہیں — اپیل ممکن", icon: "x" },
};

/** Printable, scannable QR Citizen Parchi. The Application ID is printed at the top. */
export default function Parchi({ r }: { r: Receipt }) {
  const { lang, L } = useLang();
  const b = BADGE[r.color] || BADGE.blue;
  const tone = COLOR_TONE[r.color] || "review";
  return (
    <div data-testid="parchi" className="parchi card mx-auto max-w-md overflow-hidden text-ink">
      <div className="flex items-center justify-between gap-2 bg-brand px-5 py-3 text-white">
        <div>
          <h2 className="text-2xl font-bold">{L("Your Parchi", "آپ کی پرچی")}</h2>
          <p className="text-base text-white/85">
            {L("Application ID", "درخواست آئی ڈی")}: <span dir="ltr" className="inline-block font-mono font-bold">{r.reference}</span>
          </p>
        </div>
        <SpeakButton audioKey={r.audio_key} text={r.reason_ur || r.status_ur} textEn={r.reason_en || r.status_en} size="lg" />
      </div>
      <div className="p-5">
        <div data-testid="parchi-badge" data-color={r.color} className={`panel-${tone} flex items-center gap-3 rounded-2xl p-4`}>
          <Icon name={b.icon} size={36} />
          <div>
            <div className="text-base font-bold opacity-90">{lang === "ur" ? b.ur : b.en}</div>
            <div className="text-xl font-bold">{lang === "ur" ? r.status_ur : r.status_en}</div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <div className="rounded-xl border-2 border-line bg-white p-1">
            <QRCodeSVG value={r.qr} size={140} level="M" includeMargin aria-label="Parchi QR" />
          </div>
          <div>
            <div className="text-base text-slate">{L("6-digit PIN", "6 ہندسوں کا پن")}</div>
            <div data-testid="parchi-pin" className="font-mono text-4xl font-bold tracking-widest" dir="ltr">{r.pin}</div>
            <p className="mt-1 text-base text-slate">{L("Keep this PIN private.", "یہ پن کسی کو نہ بتائیں۔")}</p>
          </div>
        </div>
        <p className="mt-4 text-lg">
          {lang === "ur" ? r.scheme_ur : r.scheme_en} — <span dir="ltr" className="inline-block font-bold">Rs {r.amount_pkr?.toLocaleString()}</span>
        </p>
        {(r.reason_en || r.reason_ur) && <p className="mt-2 text-lg font-bold">{lang === "ur" ? r.reason_ur : r.reason_en}</p>}
        <div className="mt-4 rounded-xl bg-page p-3">
          <StatusTimeline status={r.status} compact />
        </div>
        <p className="mt-3 text-base text-slate" dir="ltr">{r.notice}</p>
        <button type="button" onClick={() => window.print()} className="no-print btn btn-primary mt-4 w-full">
          <Icon name="print" size={22} /> {L("Print / Save as PDF", "پرنٹ / پی ڈی ایف محفوظ کریں")}
        </button>
      </div>
    </div>
  );
}
