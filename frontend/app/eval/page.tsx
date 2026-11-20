"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";

interface ThresholdRow { threshold: number; wrong_approvals: number; wrongly_blocked_eligible: number; eligible_delayed_by_proof: number; human_review_load: number; slow_proof_requests: number; total_expected_cost: number }
interface Family { family: string; total: number; passed: number; pass_rate: number }
interface FamilyDetail extends Family { failures: { id: string; note: string; expected: unknown; got: unknown }[] }
interface Summary {
  generated_at: string; runtime_seconds: number; total: number; passed: number; pass_rate: number; never_auto_reject: boolean;
  threshold_analysis: ThresholdRow[]; optimal_threshold: number; cost_weights: Record<string, number>;
  scam_metrics: Record<string, number>; forensics_metrics: Record<string, number>; engine_cases_in_cost_analysis: number;
  families: Family[]; notes: string[];
}

// Validated categorical slots 1-3 (fixed order, never cycled); text always uses ink tokens.
const S1 = "#2a78d6", S2 = "#eb6834", S3 = "#1baf7a";
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-sm text-gray-600">{label}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-gray-950">{value}</div>
      {sub && <div className="mt-1 text-xs text-gray-600">{sub}</div>}
    </div>
  );
}

export default function EvalDashboard() {
  const [s, setS] = useState<Summary | null>(null);
  const [fams, setFams] = useState<FamilyDetail[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Summary>("/eval/summary", { auth: false }).then(setS).catch((e) => setErr(String(e)));
    api<FamilyDetail[]>("/eval/by-family", { auth: false }).then(setFams).catch(() => undefined);
  }, []);

  const rows = (s?.threshold_analysis || []).map((r) => ({ ...r, label: r.threshold.toFixed(2) }));
  const minCost = Math.min(...rows.map((r) => r.total_expected_cost));

  return (
    <>
      <AppHeader title="Evaluation" />
      <div className="mx-auto max-w-6xl px-4 py-6" dir="ltr">
        <h1 className="text-3xl font-bold">Evaluation dashboard</h1>
        {err && <p className="mt-3 rounded bg-red-100 p-3">No results yet — run <code>python scripts/run_eval.py</code>. ({err})</p>}
        {s && (
          <>
            <p className="mt-1 text-sm text-gray-600">
              {s.total} synthetic edge cases · 13 families · real engine + API · run {new Date(s.generated_at).toLocaleString()} ({s.runtime_seconds}s)
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Cases passing expectations" value={pct(s.pass_rate)} sub={`${s.passed} / ${s.total}`} />
              <Tile label="Auto-rejections" value={s.never_auto_reject ? "0" : "!"} sub="engine never rejects; only officers can" />
              <Tile label="Chosen AUTO threshold" value={s.optimal_threshold.toFixed(2)} sub="lowest cost; ties → safest" />
              <Tile label="Engine cases in cost study" value={String(s.engine_cases_in_cost_analysis)} />
            </div>

            <section className="mt-8">
              <h2 className="text-2xl font-bold">Cost-threshold optimization</h2>
              <p className="text-sm text-gray-600">
                Weights: wrong approval {s.cost_weights.wrong_approval} · wrong block {s.cost_weights.wrong_block} · human review {s.cost_weights.human_review} · slow proof {s.cost_weights.slow_proof}.
                Break-even for auto vs. review: (1−p)·20 = 1 ⇒ p = 0.95.
              </p>
              <div className="mt-4 grid gap-6 lg:grid-cols-2">
                <figure className="rounded-xl border border-gray-200 bg-[#fcfcfb] p-3">
                  <figcaption className="font-bold">Total expected cost by AUTO threshold (lower is better)</figcaption>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 4 }}>
                        <CartesianGrid vertical={false} stroke="#e7e6e2" />
                        <XAxis dataKey="label" tickLine={false} stroke="#52514e" />
                        <YAxis tickLine={false} axisLine={false} stroke="#52514e" />
                        <Tooltip cursor={{ fill: "rgba(0,0,0,0.05)" }} formatter={(v) => [String(v), "Total expected cost"]} labelFormatter={(l) => `Threshold ${l}`} />
                        <Bar dataKey="total_expected_cost" radius={[4, 4, 0, 0]} maxBarSize={44}>
                          {rows.map((r) => <Cell key={r.label} fill={S1} fillOpacity={r.threshold === s.optimal_threshold ? 1 : 0.45} />)}
                          <LabelList dataKey="total_expected_cost" position="top" fill="#0b0b0b" fontSize={12} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </figure>
                <figure className="rounded-xl border border-gray-200 bg-[#fcfcfb] p-3">
                  <figcaption className="font-bold">Outcome counts by threshold</figcaption>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={2}>
                        <CartesianGrid vertical={false} stroke="#e7e6e2" />
                        <XAxis dataKey="label" tickLine={false} stroke="#52514e" />
                        <YAxis tickLine={false} axisLine={false} stroke="#52514e" />
                        <Tooltip cursor={{ fill: "rgba(0,0,0,0.05)" }} labelFormatter={(l) => `Threshold ${l}`} />
                        <Legend wrapperStyle={{ color: "#0b0b0b" }} />
                        <Bar dataKey="wrong_approvals" name="Wrong approvals" fill={S1} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="wrongly_blocked_eligible" name="Eligible escalated (wrong block)" fill={S2} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="human_review_load" name="Human review load" fill={S3} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </figure>
              </div>
              <table className="mt-4 w-full text-sm tabular-nums">
                <thead><tr className="border-b text-left"><th className="p-2">Threshold</th><th>Wrong approvals</th><th>Eligible escalated</th><th>Eligible delayed by proof</th><th>Human review load</th><th>Proof requests</th><th>Total cost</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className={`border-b ${r.threshold === s.optimal_threshold ? "bg-blue-50 font-bold" : ""}`}>
                      <td className="p-2">{r.label}{r.threshold === s.optimal_threshold ? " ✔ chosen" : ""}</td><td>{r.wrong_approvals}</td><td>{r.wrongly_blocked_eligible}</td>
                      <td>{r.eligible_delayed_by_proof}</td><td>{r.human_review_load}</td><td>{r.slow_proof_requests}</td>
                      <td>{r.total_expected_cost}{r.total_expected_cost === minCost ? " (min)" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm text-gray-700">
                Honest reading: in this cohort every fraud case is caught by an explicit flag, so thresholds 0.75–0.95 tie on cost and 0.98 only adds
                proof requests for genuine applicants. 0.95 is the safest threshold among the cheapest, and the one the cost derivation predicts.
              </p>
            </section>

            <section className="mt-10 grid gap-6 md:grid-cols-2">
              <div>
                <h2 className="text-2xl font-bold">Scam Shield (held-out messages)</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Tile label="Precision (SCAM verdict)" value={pct(s.scam_metrics.precision)} />
                  <Tile label="False-alarm rate" value={pct(s.scam_metrics.false_alarm_rate)} sub="genuine notices marked SCAM" />
                  <Tile label="Recall — hard SCAM" value={pct(s.scam_metrics.recall_flagged_as_scam)} sub="rest sent to human review" />
                  <Tile label="Recall incl. human review" value={pct(s.scam_metrics.recall_incl_human_review)} />
                  <Tile label="Genuine sent to review" value={pct(s.scam_metrics.legit_sent_to_review_rate)} />
                  <Tile label="Scams missed" value={pct(s.scam_metrics.missed_scam_rate)} />
                </div>
              </div>
              <div>
                <h2 className="text-2xl font-bold">Document forensics</h2>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Tile label="Precision" value={pct(s.forensics_metrics.precision)} />
                  <Tile label="Recall" value={pct(s.forensics_metrics.recall)} />
                  <Tile label="False-alarm rate" value={pct(s.forensics_metrics.false_alarm_rate)} sub={`${s.forensics_metrics.true_negative + s.forensics_metrics.false_positive} clean controls`} />
                  <Tile label="Cases" value={String(s.forensics_metrics.n)} sub="bad photos + forged docs" />
                </div>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="text-2xl font-bold">Per-family pass rate</h2>
              <table className="mt-3 w-full text-sm tabular-nums">
                <thead><tr className="border-b text-left"><th className="p-2">Family</th><th>Passed</th><th>Total</th><th>Pass rate</th><th>First failures</th></tr></thead>
                <tbody>
                  {(fams.length ? fams : s.families.map((f) => ({ ...f, failures: [] }))).map((f) => (
                    <tr key={f.family} className="border-b align-top">
                      <td className="p-2 font-bold">{f.family}</td><td>{f.passed}</td><td>{f.total}</td>
                      <td><span className={f.pass_rate === 1 ? "text-green-800" : "text-red-800"}>{f.pass_rate === 1 ? "✔ " : "✖ "}{pct(f.pass_rate)}</span></td>
                      <td className="text-xs">{f.failures.slice(0, 2).map((x) => `${x.id}: ${x.note}`).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-4 list-disc pl-5 text-sm text-gray-700">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}
