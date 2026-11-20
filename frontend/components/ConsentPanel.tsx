"use client";

import { useLang } from "@/lib/i18n";
import SpeakButton from "@/components/SpeakButton";

export const SCOPES = [
  { scope: "identity", icon: "🪪", en: "Officer may see my name and CNIC", ur: "افسر میرا نام اور شناختی کارڈ دیکھ سکے" },
  { scope: "income", icon: "💰", en: "Officer may see my income", ur: "افسر میری آمدنی دیکھ سکے" },
  { scope: "documents", icon: "📷", en: "Officer may see my CNIC photo", ur: "افسر میرے شناختی کارڈ کی تصویر دیکھ سکے" },
  { scope: "helper_access", icon: "🤝", en: "My community helper may help me", ur: "میری مددگار میری مدد کر سکے" },
] as const;

/** Step-by-step consent toggles. Every toggle starts OFF; each has its own audio explanation. */
export default function ConsentPanel({ value, onChange, hide = [] }: {
  value: Record<string, boolean>; onChange: (scope: string, on: boolean) => void; hide?: string[];
}) {
  const { lang } = useLang();
  return (
    <ul className="space-y-3">
      {SCOPES.filter((s) => !hide.includes(s.scope)).map((s) => {
        const on = !!value[s.scope];
        return (
          <li key={s.scope} className={`flex items-center gap-3 rounded-2xl border-4 p-3 ${on ? "border-ok bg-green-50" : "border-gray-400 bg-white"}`}>
            <span className="text-3xl" aria-hidden>{s.icon}</span>
            <span className="flex-1 text-lg font-bold">{lang === "ur" ? s.ur : s.en}</span>
            <SpeakButton text={s.ur} textEn={s.en} />
            <button
              role="switch"
              aria-checked={on}
              aria-label={s.en}
              onClick={() => onChange(s.scope, !on)}
              className={`relative h-10 w-20 shrink-0 rounded-full border-4 border-black transition ${on ? "bg-ok" : "bg-gray-300"}`}
            >
              <span className={`absolute top-0.5 h-7 w-7 rounded-full bg-white shadow transition-all ${on ? "left-10" : "left-0.5"}`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
