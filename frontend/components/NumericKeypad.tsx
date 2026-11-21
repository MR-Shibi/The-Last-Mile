"use client";

import { useLang } from "@/lib/i18n";

/** Large, high-contrast 3x4 keypad (1–9, Clear, 0, ⌫): a zero-friction backup to voice in noisy places.
 * Buttons are type="button" so tapping never submits the surrounding form. */
export default function NumericKeypad({ onDigit, onBackspace, onClear }: {
  onDigit: (d: string) => void; onBackspace: () => void; onClear: () => void;
}) {
  const { L } = useLang();
  const key = "min-h-[52px] rounded-xl border-4 border-black bg-white text-2xl font-bold active:bg-yellow-200";
  return (
    <div className="mt-3 grid grid-cols-3 gap-2" dir="ltr" role="group" aria-label={L("Number keypad", "نمبر کی پیڈ")}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" data-testid={`keypad-${d}`} onClick={() => onDigit(d)} className={key}>{d}</button>
      ))}
      <button type="button" data-testid="keypad-clear" onClick={onClear} className={`${key} bg-gray-200 text-lg`}>
        {L("Clear", "صاف کریں")}
      </button>
      <button type="button" data-testid="keypad-0" onClick={() => onDigit("0")} className={key}>0</button>
      <button type="button" data-testid="keypad-back" onClick={onBackspace} className={`${key} bg-gray-200`} aria-label={L("Delete", "مٹائیں")}>
        ⌫
      </button>
    </div>
  );
}
