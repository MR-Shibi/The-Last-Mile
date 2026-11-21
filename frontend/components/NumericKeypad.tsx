"use client";

import { useLang } from "@/lib/i18n";
import Icon from "@/components/Icon";

/** Large, high-contrast 3x4 keypad (1–9, Clear, 0, ⌫): a zero-friction backup to voice in noisy places.
 * Buttons are type="button" so tapping never submits the surrounding form. */
export default function NumericKeypad({ onDigit, onBackspace, onClear }: {
  onDigit: (d: string) => void; onBackspace: () => void; onClear: () => void;
}) {
  const { L } = useLang();
  const key = "min-h-[56px] rounded-xl border-2 border-line text-2xl font-bold shadow-sm active:bg-gold/40";
  const digit = `${key} bg-card text-ink hover:bg-tint`;
  const ctrl = `${key} bg-tint text-brand hover:brightness-95`;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-page p-2" dir="ltr" role="group" aria-label={L("Number keypad", "نمبر کی پیڈ")}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" data-testid={`keypad-${d}`} onClick={() => onDigit(d)} className={digit}>{d}</button>
      ))}
      <button type="button" data-testid="keypad-clear" onClick={onClear} className={`${ctrl} text-lg`}>
        {L("Clear", "صاف کریں")}
      </button>
      <button type="button" data-testid="keypad-0" onClick={() => onDigit("0")} className={digit}>0</button>
      <button type="button" data-testid="keypad-back" onClick={onBackspace} className={`${ctrl} inline-flex items-center justify-center`} aria-label={L("Delete", "مٹائیں")}>
        <Icon name="backspace" size={26} />
      </button>
    </div>
  );
}
