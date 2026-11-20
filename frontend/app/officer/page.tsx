"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
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

const ROUTE_COLOR: Record<string, string> = { ESCALATE_HUMAN: "bg-human", ASK_MORE_PROOF: "bg-warn", AUTO_RECOMMEND: "bg-ok", OFFICER_REQUESTED_PROOF: "bg-warn" };

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
      <aside>
        <h2 className="text-xl font-bold">Queue (lowest confidence first)</h2>
        <ul className="mt-2 space-y-2">
          {queue.map((q) => (
            <li key={q.case_id}>
              <button onClick={() => void open(q.case_id)} className={`w-full rounded-xl border-2 p-3 text-left ${review?.case_id === q.case_id ? "border-brand bg-green-50" : "border-gray-300"}`}>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold text-white ${ROUTE_COLOR[q.status] || "bg-gray-500"}`}>{q.status}</span>
                  <span className="font-mono text-sm">#{q.case_id}</span>
                  <span className="ml-auto font-mono text-sm">p={q.probability.toFixed(2)}</span>
                </div>
                <div className="mt-1 text-sm">{q.locked ? "🔒 consent missing" : q.applicant_name}</div>
                {q.flags.length > 0 && <div className="mt-1 text-xs text-danger">{q.flags.join(" · ")}</div>}
              </button>
            </li>
          ))}
          {!queue.length && <li className="text-gray-600">Queue empty.</li>}
        </ul>
      </aside>
      <section>
        {msg && <p className="mb-3 rounded-lg bg-yellow-100 p-3 font-bold" role="status">{msg}</p>}
        {review && (
          <>
            <h2 className="text-2xl font-bold">Case #{review.case_id} — {review.scheme} (Rs {review.amount_pkr.toLocaleString()})</h2>
            <p className="text-sm">Consent scopes: {review.consent_scopes.join(", ")}</p>
            <h3 className="mt-4 text-lg font-bold">Input vs OCR vs Registry</h3>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead><tr className="bg-gray-100"><th className="border p-2">Field</th><th className="border p-2">Input</th><th className="border p-2">OCR</th><th className="border p-2">Registry</th></tr></thead>
              <tbody>
                {review.diff.map((d) => (
                  <tr key={d.field} className={d.mismatch ? "bg-red-50" : ""}>
                    <td className="border p-2 font-bold">{d.field}{d.mismatch ? " ⚠" : ""}</td>
                    <td className="border p-2">{String(d.input ?? "—")}</td>
                    <td className="border p-2">{String(d.ocr ?? "—")}</td>
                    <td className="border p-2">{String(d.registry ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {review.decision && (
              <div className="mt-4 rounded-xl border-2 border-gray-300 p-3">
                <h3 className="text-lg font-bold">Rule trace — engine says {review.decision.route} (p={review.decision.probability.toFixed(3)}), rule v{review.trace.rule_version}</h3>
                <p className="text-sm">{review.decision.reason_user_en}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  {Object.entries(review.trace.composite?.components || {}).map(([k, v]) => (
                    <div key={k} className="rounded bg-gray-100 p-2"><div className="text-xs">{k}</div><div className="font-mono text-lg">{v.toFixed(3)}</div></div>
                  ))}
                </div>
                {review.trace.composite?.min_guard_applied && <p className="mt-1 text-sm font-bold text-danger">Min-guard applied: one weak sub-score capped p.</p>}
                <ul className="mt-2 text-sm">
                  {review.trace.rules?.hard.map((r) => <li key={r.id}>{r.status === "pass" ? "✔" : r.status === "fail" ? "✖" : "?"} {r.label}</li>)}
                </ul>
                {!!review.trace.flags?.length && <p className="mt-1 text-sm text-danger">Flags: {review.trace.flags.join(", ")}</p>}
                <p className="mt-1 font-mono text-xs">inputs_hash {review.trace.inputs_hash?.slice(0, 16)}… · {JSON.stringify(review.trace.expected_costs)}</p>
              </div>
            )}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (mandatory for Request Proof / Reject)" className="mt-4 w-full rounded-xl border-2 border-black p-3" rows={2} />
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => void act("approve")} className="rounded-xl bg-ok px-5 py-3 font-bold text-white">Approve</button>
              <button onClick={() => void act("request_proof")} className="rounded-xl bg-warn px-5 py-3 font-bold text-white">Request proof</button>
              <button onClick={() => void act("reject")} disabled={reason.trim().length < 5} className="rounded-xl bg-danger px-5 py-3 font-bold text-white disabled:opacity-40">Reject</button>
              <button onClick={() => void disburse()} className="ml-auto rounded-xl bg-black px-5 py-3 font-bold text-white">💸 1-tap disburse</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function OfficerPage() {
  return (
    <>
      <AppHeader title="Officer" />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <RequireRole roles={["department_officer"]}>{() => <Workspace />}</RequireRole>
      </div>
    </>
  );
}
