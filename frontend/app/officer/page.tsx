"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { PageShell } from "@/components/ui";
import RequireRole from "@/components/RequireRole";
import { api, ApiError } from "@/lib/api";

interface QItem { case_id: number; status: string; probability: number; flags: string[]; locked: boolean; applicant_name: string | null; reason_user_en: string | null }
interface DiffRow { field: string; input: unknown; ocr: unknown; registry: unknown; mismatch: boolean }
interface Review {
  case_id: number; status: string; scheme: string; amount_pkr: number; diff: DiffRow[]; consent_scopes: string[];
  decision: { id: number; route: string; probability: number; reason_user_en: string } | null;
  trace: { composite?: { components: Record<string, number>; min_guard_applied: boolean }; rules?: { hard: { id: string; label: string; status: string }[] };
           flags?: string[]; rule_version?: number; rule_version_id?: number; expected_costs?: Record<string, number>; inputs_hash?: string; model_version?: Record<string, string> };
}

const ROUTE_PILL: Record<string, string> = { ESCALATE_HUMAN: "pill-review", ASK_MORE_PROOF: "pill-review", AUTO_RECOMMEND: "pill-safe", OFFICER_REQUESTED_PROOF: "pill-review", OFFICER_APPROVED: "pill-safe", PAID: "pill-safe", OFFICER_REJECTED: "pill-danger" };

function Workspace() {
  const [queue, setQueue] = useState<QItem[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => api<QItem[]>("/officer/queue").then(setQueue).catch(() => undefined), []);
  useEffect(() => void load(), [load]);

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
      await api(`/cases/${review.case_id}/officer-action`, { body: { action, reason } });
      setMsg(`Recorded: ${action}`);
      await open(review.case_id);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function disburse() {
    if (!review) return;
    try {
      const r = await api<{ txn_id: string }>(`/cases/${review.case_id}/disburse`, { body: {} });
      setMsg(`Paid (simulated): ${r.txn_id}`);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? `${e.status}: ${e.message}` : String(e));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]" dir="ltr">
      <aside className="card h-fit p-3">
        <h2 className="text-xl font-bold text-brand">Queue (lowest confidence first)</h2>
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
          {!queue.length && <li className="text-slate">Queue empty.</li>}
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
      <RequireRole roles={["department_officer"]}>{() => <Workspace />}</RequireRole>
    </PageShell>
  );
}
