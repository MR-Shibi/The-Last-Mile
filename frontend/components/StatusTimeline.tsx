"use client";

import Icon from "@/components/Icon";
import { useLang } from "@/lib/i18n";
import { STAGES, stagesDone } from "@/lib/status";

/** 4-stage progress timeline driven by the real backend status. */
export default function StatusTimeline({ status, compact = false }: { status: string | null | undefined; compact?: boolean }) {
  const { lang, L } = useLang();
  const done = stagesDone(status);
  const rejected = status === "OFFICER_REJECTED";
  return (
    <ol data-testid="status-timeline" className="space-y-0" aria-label={L("Application progress", "درخواست کی پیش رفت")}>
      {STAGES.map((s, i) => {
        const state = i < done ? "done" : i === done ? "current" : "todo";
        const last = i === STAGES.length - 1;
        const dot =
          state === "done"
            ? last && rejected ? "bg-danger-bg text-danger-ink border-danger-line" : "bg-brand text-white border-brand"
            : state === "current" ? "bg-review-bg text-review-ink border-gold" : "bg-card text-slate border-line";
        return (
          <li key={s.en} className="relative flex gap-3 pb-4" aria-current={state === "current" ? "step" : undefined}>
            {!last && <span className={`absolute top-10 bottom-0 start-[19px] w-0.5 ${i < done - 1 ? "bg-brand" : "bg-line"}`} aria-hidden />}
            <span className={`z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-lg font-bold ${dot}`}>
              {state === "done" ? <Icon name={last && rejected ? "x" : "check"} size={20} strokeWidth={3} /> : <span dir="ltr">{i + 1}</span>}
            </span>
            <div className="min-w-0 pt-1">
              <p className={`text-lg font-bold ${state === "todo" ? "text-slate" : "text-ink"}`}>
                <span dir="ltr" className="inline-block">{i + 1}.</span> {lang === "ur" ? s.ur : s.en}
                {state === "current" && <span className="pill pill-review ms-2 align-middle">{L("Now", "ابھی")}</span>}
              </p>
              {!compact && <p className="text-base text-slate">{lang === "ur" ? s.d_ur : s.d_en}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
