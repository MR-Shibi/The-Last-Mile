"use client";

import { useLang } from "@/lib/i18n";
import Icon, { type IconName } from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";

export const SCOPES = [
  { scope: "identity", icon: "form", en: "Officer may see my name and CNIC", ur: "افسر میرا نام اور شناختی کارڈ دیکھ سکے" },
  { scope: "income", icon: "receipt", en: "Officer may see my income", ur: "افسر میری آمدنی دیکھ سکے" },
  { scope: "documents", icon: "camera", en: "Officer may see my CNIC photo", ur: "افسر میرے شناختی کارڈ کی تصویر دیکھ سکے" },
  { scope: "helper_access", icon: "users", en: "My community helper may help me", ur: "میری مددگار میری مدد کر سکے" },
] as const;

/** Opt-in consent toggles. Every toggle starts OFF; each has its own audio explanation. */
export default function ConsentPanel({ value, onChange, hide = [] }: {
  value: Record<string, boolean>; onChange: (scope: string, on: boolean) => void; hide?: string[];
}) {
  const { lang, L } = useLang();
  return (
    <ul className="space-y-3">
      {SCOPES.filter((s) => !hide.includes(s.scope)).map((s) => {
        const on = !!value[s.scope];
        return (
          <li key={s.scope} className={`flex items-center gap-3 rounded-2xl border-2 p-3 ${on ? "border-brand bg-tint" : "border-line bg-card"}`}>
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tint text-brand" aria-hidden>
              <Icon name={s.icon as IconName} size={24} />
            </span>
            <span className="flex-1 text-lg font-bold">{lang === "ur" ? s.ur : s.en}</span>
            <SpeakButton text={s.ur} textEn={s.en} />
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={s.en}
              onClick={() => onChange(s.scope, !on)}
              className={`relative h-11 w-20 shrink-0 rounded-full border-2 transition ${on ? "border-brand bg-brand" : "border-slate bg-[#e3e7e4]"}`}
              dir="ltr"
            >
              <span className="sr-only">{on ? L("On", "آن") : L("Off", "بند")}</span>
              <span className={`absolute top-1 h-8 w-8 rounded-full bg-white shadow transition-all ${on ? "left-10" : "left-1"}`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
