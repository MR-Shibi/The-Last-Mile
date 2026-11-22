"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { PageShell } from "@/components/ui";
import RequireRole from "@/components/RequireRole";
import SpeakButton from "@/components/SpeakButton";
import { api, ApiError, type Session } from "@/lib/api";

interface QItem { case_id: number; status: string; probability: number; flags: string[]; locked: boolean; applicant_name: string | null; reason_user_en: string | null }
interface DiffRow { field: string; input: unknown; ocr: unknown; registry: unknown; mismatch: boolean }
interface Doc { id: number; kind: string; sha256: string; ocr_confidence: number; quality_score: number; forgery_score: number; flags: string[]; ocr: Record<string, unknown>; created_at: string | null }
interface Review {
  documents?: Doc[]; documents_hidden?: boolean;
  case_id: number; status: string; scheme: string; amount_pkr: number; diff: DiffRow[]; consent_scopes: string[];
  decision: { id: number; route: string; probability: number; reason_user_en: string } | null;
  trace: { composite?: { components: Record<string, number>; min_guard_applied: boolean }; rules?: { hard: { id: string; label: string; status: string }[] };
           flags?: string[]; rule_version?: number; rule_version_id?: number; expected_costs?: Record<string, number>; inputs_hash?: string; model_version?: Record<string, string> };
}

const ROUTE_PILL: Record<string, string> = { ESCALATE_HUMAN: "pill-review", ASK_MORE_PROOF: "pill-review", AUTO_RECOMMEND: "pill-safe", OFFICER_REQUESTED_PROOF: "pill-review", OFFICER_APPROVED: "pill-safe", PAID: "pill-safe", OFFICER_REJECTED: "pill-danger" };

function DecisionConfirm({ d, onClose }: { d: { action: "approve" | "reject"; reference: string; reason: string }; onClose: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => okRef.current?.focus(), []);
  const approved = d.action === "approve";
  const en = approved
    ? `Application ${d.reference} has been APPROVED by you.`
    : `Application ${d.reference} has been REJECTED by you. Reason: ${d.reason}.`;
  const ur = approved
    ? `درخواست (${d.reference}) آپ کی جانب سے منظور کر لی گئی ہے۔`
    : `درخواست (${d.reference}) آپ کی جانب سے مسترد کر دی گئی ہے۔`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="officer-decision-title" data-testid="officer-decision-modal" data-action={d.action}
        className={`w-full max-w-lg overflow-hidden rounded-2xl border-2 shadow-xl ${approved ? "border-brand bg-tint" : "border-danger-line bg-danger-bg"}`}>
        <div className={`flex items-center gap-2 px-5 py-3 text-white ${approved ? "bg-brand" : "bg-danger-ink"}`}>
          <Icon name={approved ? "checkCircle" : "x"} size={26} />
          <h2 id="officer-decision-title" className="text-xl font-bold">{approved ? "Approved" : "Rejected"}</h2>
        </div>
        <div className="flex items-start gap-3 p-5">
          <div className={`min-w-0 flex-1 ${approved ? "text-brand" : "text-danger-ink"}`}>
            <p data-testid="officer-decision-text" className="text-lg font-bold">{en}</p>
            <p dir="rtl" lang="ur" className="urdu mt-2 text-lg">{ur}</p>
          </div>
          <SpeakButton text={ur} textEn={en} label="Listen to the decision" />
        </div>
        <div className="px-5 pb-5">
          <button ref={okRef} type="button" onClick={onClose} data-testid="officer-decision-ok" className="btn btn-primary w-full text-xl">
            OK / <span className="urdu">ٹھیک ہے</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Workspace({ session }: { session: Session }) {
  const [queue, setQueue] = useState<QItem[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ action: "approve" | "reject"; reference: string; reason: string } | null>(null);

  // Never fail silently: a cold-starting free-tier API or a network blip used to leave an empty "Queue empty." list.
  // Retry a few times with back-off, then show the real error with a Retry button.
  const load = useCallback(async (closed: boolean) => {
    setLoadState("loading");
    let last: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const q = await api<QItem[]>(`/officer/queue${closed ? "?include_closed=true" : ""}`);
        setQueue(q);
        setLoadErr(null);
        setLoadState("ready");
        return;
      } catch (e) {
        last = e;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    setLoadErr(last instanceof ApiError ? `${last.status}: ${last.message}` : "Network error — the server may be waking up.");
    setLoadState("error");
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void load(showClosed), 0);
    return () => window.clearTimeout(t);
  }, [load, showClosed]);

  async function open(id: number) {
    setMsg(null);
    setReason("");
    try {
      setReview(await api<Review>(`/officer/cases/${id}/review`));
    } catch (e) {
      setReview(null);
      setMsg(e instanceof ApiError && e.status === 403 ? "Consent withdrawn or missing — data hidden (403)." : String(e));
    }
  }

  async function act(action: "approve" | "request_proof" | "reject") {
    if (!review) return;
    try {
      const id = review.case_id;
      const d = await api<{ route: string }>(`/cases/${id}/officer-action`, { body: { action, reason } });
      // Reflect the new status on the queue card right away (no reload that would drop the now-closed case)
      setQueue((q) => q.map((it) => (it.case_id === id ? { ...it, status: d.route } : it)));
      setMsg(`Recorded: ${action}`);
      if (action !== "request_proof") {
        setConfirmed({ action, reference: `LM-${String(session.tenant_id).padStart(2, "0")}-${String(id).padStart(6, "0")}`, reason: reason.trim() });
      }
      await open(id);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function disburse() {
    if (!review) return;
    try {
      const r = await api<{ txn_id: string }>(`/cases/${review.case_id}/disburse`, { body: {} });
      setMsg(`Paid (simulated): ${r.txn_id}`);
      await load(showClosed);
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]" dir="ltr">
      {confirmed && <DecisionConfirm d={confirmed} onClose={() => setConfirmed(null)} />}
      <aside className="card h-fit p-3">
        <h2 className="text-xl font-bold text-brand">Queue (lowest confidence first)</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-base font-bold">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-5 w-5 accent-[#123C35]" />
            Show decided cases too
          </label>
          <button type="button" onClick={() => void load(showClosed)} className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded-xl border-2 border-line px-3 font-bold text-brand hover:bg-tint">
            <Icon name="sync" size={18} /> Refresh
          </button>
        </div>
        <p data-testid="queue-count" className="mt-1 text-sm text-slate">{loadState === "ready" ? `${queue.length} case(s)` : loadState === "loading" ? "Loading…" : ""}</p>
        {loadState === "error" && (
          <div role="alert" className="panel-danger mt-2 rounded-xl p-3 text-base">
            <p className="font-bold">Could not load the queue.</p>
            <p className="break-words">{loadErr}</p>
            <button type="button" onClick={() => void load(showClosed)} className="btn btn-danger mt-2 w-full">Retry</button>
          </div>
        )}
        <ul className="mt-2 space-y-2">
          {queue.map((q) => (
            <li key={q.case_id}>
              <button onClick={() => void open(q.case_id)} className={`w-full rounded-xl border-2 p-3 text-left hover:bg-tint ${review?.case_id === q.case_id ? "border-brand bg-tint" : "border-line bg-card"}`}>
                <div className="flex items-center gap-2">
                  <span className={`pill text-sm ${ROUTE_PILL[q.status] || "pill-neutral"}`}>{q.status}</span>
                  <span className="font-mono text-base font-bold">#{q.case_id}</span>
                  <span className="ml-auto font-mono text-base">p={q.probability.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-base">{q.locked ? "🔒 consent missing" : q.applicant_name}</div>
                {q.flags.length > 0 && <div className="mt-1 text-sm text-danger-ink">{q.flags.join(" · ")}</div>}
              </button>
            </li>
          ))}
          {loadState === "loading" && !queue.length && <li className="text-slate">Loading cases…</li>}
          {loadState === "ready" && !queue.length && <li className="text-slate">Queue empty — no open cases in your department.</li>}
        </ul>
      </aside>
      <section className="min-w-0">
        {msg && <p className="panel-review mb-3 rounded-xl p-3 font-bold" role="status">{msg}</p>}
        {!review && !msg && <p className="card p-6 text-lg text-slate">Select a case from the queue to review it.</p>}
        {review && (
          <div className="card p-4">
            <h2 className="text-2xl font-bold text-brand">Case #{review.case_id} — {review.scheme} (Rs {review.amount_pkr.toLocaleString()})</h2>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-base">Consent scopes: {review.consent_scopes.map((c) => <span key={c} className="pill pill-safe text-sm">{c}</span>)}</p>
            <h3 className="mt-4 text-lg font-bold">Input vs OCR vs Registry</h3>
            <div className="table-wrap mt-2">
              <table className="text-base">
                <thead><tr><th>Field</th><th>Input</th><th>OCR</th><th>Registry</th></tr></thead>
                <tbody>
                  {review.diff.map((d) => (
                    <tr key={d.field} className={d.mismatch ? "bg-danger-bg" : ""}>
                      <td className="font-bold">{d.field}{d.mismatch && <span className="pill pill-danger ml-2 text-sm">mismatch</span>}</td>
                      <td>{String(d.input ?? "—")}</td>
                      <td>{String(d.ocr ?? "—")}</td>
                      <td>{String(d.registry ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-4 text-lg font-bold">Attached documents</h3>
            {review.documents_hidden ? (
              <p className="mt-1 text-base text-danger-ink">Documents consent not given — hidden.</p>
            ) : !review.documents?.length ? (
              <p className="mt-1 text-base text-slate">No document uploaded for this case yet.</p>
            ) : (
              <ul className="mt-2 space-y-2" data-testid="officer-documents">
                {review.documents.map((d) => (
                  <li key={d.id} className="rounded-xl border-2 border-line bg-page p-3 text-base">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pill pill-neutral text-sm">{d.kind}</span>
                      <span className="font-mono text-sm">sha256 {d.sha256.slice(0, 12)}…</span>
                      <span className="text-sm text-slate">{d.created_at?.slice(0, 16).replace("T", " ")}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 text-sm">
                      <div>OCR conf. <b className="font-mono">{d.ocr_confidence.toFixed(2)}</b></div>
                      <div>Quality <b className="font-mono">{d.quality_score.toFixed(2)}</b></div>
                      <div className={d.forgery_score >= 0.6 ? "text-danger-ink" : ""}>Tamper risk <b className="font-mono">{d.forgery_score.toFixed(2)}</b></div>
                    </div>
                    {d.flags.length > 0 && <div className="mt-1 text-sm text-danger-ink">Flags: {d.flags.join(", ")}</div>}
                    <p className="mt-1 text-sm text-slate">Image not retained (data minimisation) — OCR values appear in the table above.</p>
                  </li>
                ))}
              </ul>
            )}
            {review.decision && (
              <div className="mt-4 rounded-xl border-2 border-line bg-page p-3">
                <h3 className="text-lg font-bold">Rule trace — engine says {review.decision.route} (p={review.decision.probability.toFixed(3)}), rule v{review.trace.rule_version}</h3>
                <p className="text-base">{review.decision.reason_user_en}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  {Object.entries(review.trace.composite?.components || {}).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-line bg-card p-2"><div className="text-sm text-slate">{k}</div><div className="font-mono text-lg">{v.toFixed(3)}</div></div>
                  ))}
                </div>
                {review.trace.composite?.min_guard_applied && <p className="mt-1 text-base font-bold text-danger-ink">Min-guard applied: one weak sub-score capped p.</p>}
                <ul className="mt-2 text-base">
                  {review.trace.rules?.hard.map((r) => <li key={r.id}>{r.status === "pass" ? "✔" : r.status === "fail" ? "✖" : "?"} {r.label}</li>)}
                </ul>
                {!!review.trace.flags?.length && <p className="mt-1 text-base text-danger-ink">Flags: {review.trace.flags.join(", ")}</p>}
                <p className="mt-1 break-all font-mono text-sm text-slate">inputs_hash {review.trace.inputs_hash?.slice(0, 16)}… · {JSON.stringify(review.trace.expected_costs)}</p>
              </div>
            )}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (mandatory for Request Proof / Reject)" className="field mt-4 text-lg" rows={2} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void act("approve")} className="btn btn-primary"><Icon name="check" size={20} /> Approve</button>
              <button type="button" onClick={() => void act("request_proof")} className="btn panel-review">Request proof</button>
              <button type="button" onClick={() => void act("reject")} disabled={reason.trim().length < 5} className="btn btn-danger">Reject</button>
              <button type="button" onClick={() => void disburse()} className="btn btn-gold ml-auto">1-tap disburse (simulated)</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function OfficerPage() {
  return (
    <PageShell title="Officer" width="full">
      {/* keyed by account: no queue/review state can survive a logout + login as someone else */}
      <RequireRole roles={["department_officer"]}>{(s) => <Workspace key={s.user_id} session={s} />}</RequireRole>
    </PageShell>
  );
}
