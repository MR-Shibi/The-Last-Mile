"use client";

import { QRCodeSVG } from "qrcode.react";
import type { Receipt } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import SpeakButton from "@/components/SpeakButton";

const BADGE: Record<string, { bg: string; icon: string; en: string; ur: string }> = {
  green: { bg: "bg-ok", icon: "✔", en: "GREEN", ur: "سبز" },
  yellow: { bg: "bg-warn", icon: "!", en: "YELLOW", ur: "پیلا" },
  blue: { bg: "bg-human", icon: "👤", en: "BLUE — HUMAN", ur: "نیلا — افسر" },
  red: { bg: "bg-danger", icon: "✖", en: "RED", ur: "سرخ" },
};

/** High-contrast printable citizen receipt ("Parchi"). */
export default function Parchi({ r }: { r: Receipt }) {
  const { lang, L } = useLang();
  const b = BADGE[r.color] || BADGE.blue;
  return (
    <div data-testid="parchi" className="parchi mx-auto max-w-md rounded-3xl border-[6px] border-black bg-white p-5 text-black">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">{L("Your Parchi", "آپ کی پرچی")}</h2>
        <SpeakButton audioKey={r.audio_key} text={r.reason_ur || r.status_ur} textEn={r.reason_en || r.status_en} size="lg" />
      </div>
      <div data-testid="parchi-badge" data-color={r.color} className={`mt-3 flex items-center gap-3 rounded-2xl ${b.bg} p-4 text-white`}>
        <span className="text-4xl" aria-hidden>{b.icon}</span>
        <div>
          <div className="text-sm font-bold opacity-90">{lang === "ur" ? b.ur : b.en}</div>
          <div className="text-xl font-bold">{lang === "ur" ? r.status_ur : r.status_en}</div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <QRCodeSVG value={r.qr} size={150} level="M" includeMargin aria-label="Parchi QR" />
        <div>
          <div className="text-sm">{L("PIN", "پن")}</div>
          <div data-testid="parchi-pin" className="font-mono text-4xl font-bold tracking-widest" dir="ltr">{r.pin}</div>
          <div className="mt-2 text-sm" dir="ltr">{r.reference}</div>
        </div>
      </div>
      <p className="mt-3 text-lg">{lang === "ur" ? r.scheme_ur : r.scheme_en} — Rs {r.amount_pkr?.toLocaleString()}</p>
      {(r.reason_en || r.reason_ur) && <p className="mt-2 text-lg font-bold">{lang === "ur" ? r.reason_ur : r.reason_en}</p>}
      <p className="mt-3 text-xs" dir="ltr">{r.notice}</p>
      <button onClick={() => window.print()} className="no-print mt-4 w-full rounded-xl bg-black py-3 text-lg font-bold text-white">
        🖨 {L("Print / Save as PDF", "پرنٹ / پی ڈی ایف محفوظ کریں")}
      </button>
    </div>
  );
}
