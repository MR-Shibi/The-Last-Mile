"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import SpeakButton from "@/components/SpeakButton";
import { api, useSession, type Receipt } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useStorageValue, writeStorage } from "@/lib/stores";

const APPROVED = new Set(["OFFICER_APPROVED", "PAID"]);
const REJECTED = new Set(["OFFICER_REJECTED"]);

type DecidedReceipt = Receipt & { officer_reason?: string | null };

/** Citizen pop-up for an officer's final decision (approved / not approved), shown once per case+status.
 * Text mirrors the exact backend status; the rejection reason is the officer's own written reason. */
export default function DecisionModal() {
  const session = useSession();
  const { lang, L } = useLang();
  const userId = session?.role === "citizen" ? session.user_id : null;
  const seenKey = `lm.seenDecision.${userId ?? "none"}`;
  const seenRaw = useStorageValue(seenKey);
  const [found, setFound] = useState<{ user: number; r: DecidedReceipt } | null>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (userId === null) return;
    let alive = true;
    const seen = new Set<string>((seenRaw || "").split(",").filter(Boolean));
    api<{ id: number; status: string }[]>("/cases")
      .then(async (cases) => {
        const next = cases.find((c) => (APPROVED.has(c.status) || REJECTED.has(c.status)) && !seen.has(`${c.id}:${c.status}`));
        if (!next || !alive) return;
        const r = await api<DecidedReceipt>(`/cases/${next.id}/receipt`);
        if (alive) setFound({ user: userId, r });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId, seenRaw]);

  const r = found && found.user === userId ? found.r : null;
  const isSeen = r ? (seenRaw || "").split(",").includes(`${r.case_id}:${r.status}`) : true;
  const open = !!r && !isSeen;

  useEffect(() => {
    if (open) okRef.current?.focus();
  }, [open]);

  if (!open || !r) return null;
  const approved = APPROVED.has(r.status);
  const reasonEn = r.officer_reason || r.reason_en || "—";
  const reasonUr = r.officer_reason || r.reason_ur || "—";
  const en = approved
    ? `Congratulations! Your application (${r.reference}) has been APPROVED by the Officer.`
    : `Your application (${r.reference}) was NOT approved. Reason: ${reasonEn}.`;
  const ur = approved
    ? `مبارک ہو! آپ کی درخواست (${r.reference}) افسر کی جانب سے منظور کر لی گئی ہے۔`
    : `آپ کی درخواست (${r.reference}) منظور نہیں ہو سکی۔ وجہ: ${reasonUr}۔`;

  function dismiss() {
    const seen = new Set<string>((seenRaw || "").split(",").filter(Boolean));
    seen.add(`${r!.case_id}:${r!.status}`);
    writeStorage(seenKey, [...seen].join(","));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onKeyDown={(e) => e.key === "Escape" && dismiss()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-title"
        data-testid="decision-modal"
        data-status={r.status}
        className={`w-full max-w-lg rounded-2xl p-5 shadow-xl ${approved ? "panel-safe bg-card" : "panel-danger"}`}
      >
        <div className="flex items-start gap-3">
          <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${approved ? "bg-brand text-gold" : "bg-danger-ink text-white"}`} aria-hidden>
            <Icon name={approved ? "checkCircle" : "alert"} size={28} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="decision-title" className="text-2xl font-bold">
              {approved ? L("Application approved", "درخواست منظور") : L("Application not approved", "درخواست منظور نہیں ہوئی")}
            </h2>
            <p data-testid="decision-text" className="mt-2 text-lg font-bold">
              {lang === "ur" ? ur : en}
            </p>
            {!approved && (
              <p className="mt-2 text-base">
                {L("Only a human officer can make this decision. You can appeal with more documents.", "یہ فیصلہ صرف انسانی افسر کر سکتا ہے۔ آپ مزید کاغذات کے ساتھ اپیل کر سکتے ہیں۔")}
              </p>
            )}
          </div>
          <SpeakButton text={ur} textEn={en} label={L("Listen to the decision", "فیصلہ سنیں")} />
        </div>
        <button ref={okRef} type="button" onClick={dismiss} data-testid="decision-ok" className="btn btn-primary mt-4 w-full text-xl">
          <span dir="ltr" className="inline-block">OK</span> / <span className="urdu">ٹھیک ہے</span>
        </button>
      </div>
    </div>
  );
}
