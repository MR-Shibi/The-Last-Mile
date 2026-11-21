"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { PageShell } from "@/components/ui";
import RequireRole from "@/components/RequireRole";
import { api, ApiError, type Scheme } from "@/lib/api";

interface Version { id: number; version: number; is_active: boolean; rules_json: Record<string, unknown>; notes: string; created_at: string }
interface Sim { baseline_approved: number; projected_approved: number; baseline_escalated: number; projected_escalated: number; baseline_ask: number; projected_ask: number; total_cases: number; real_cases: number; synthetic_cases: number; changed_case_ids: (number | string)[]; changes: { case_id: number | string; from: string; to: string }[] }
type Faults = { nadra_timeout: boolean; raast_error: boolean; force_low_ocr: boolean };

const FAULT_LABEL: Record<keyof Faults, string> = { nadra_timeout: "NADRA Timeout", raast_error: "Raast Error", force_low_ocr: "Low OCR" };

function Console() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = useState<number | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [editor, setEditor] = useState("");
  const [notes, setNotes] = useState("");
  const [sim, setSim] = useState<Sim | null>(null);
  const [faults, setFaults] = useState<Faults | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadRules = useCallback(async (id: number) => {
    const r = await api<{ versions: Version[]; active: Version | null }>(`/rules/${id}`);
    setVersions(r.versions);
    if (r.active) setEditor(JSON.stringify(r.active.rules_json, null, 2));
  }, []);

  useEffect(() => {
    api<Scheme[]>("/schemes").then((s) => {
      setSchemes(s);
      if (s[0]) {
        setSchemeId(s[0].id);
        void loadRules(s[0].id);
      }
    }).catch(() => undefined);
    api<Faults>("/admin/faults").then(setFaults).catch(() => undefined);
  }, [loadRules]);

  function parse(): Record<string, unknown> | null {
    try {
      return JSON.parse(editor);
    } catch {
      setMsg("Invalid JSON");
      return null;
    }
  }

  async function simulate() {
    const rules = parse();
    if (!rules || !schemeId) return;
    try {
      setSim(await api<Sim>("/rules/simulate", { body: { scheme_id: schemeId, rules_json: rules } }));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function publish() {
    const rules = parse();
    if (!rules || !schemeId) return;
    try {
      const v = await api<Version>(`/rules/${schemeId}/publish`, { body: { rules_json: rules, notes } });
      setMsg(`Published v${v.version} — live immediately, no redeploy.`);
      setSim(null);
      await loadRules(schemeId);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function toggleFault(k: keyof Faults) {
    if (!faults) return;
    setFaults(await api<Faults>("/admin/faults", { body: { [k]: !faults[k] } }));
  }

  return (
    <div dir="ltr" className="space-y-6">
      {msg && <p className="panel-review rounded-xl p-3 font-bold" role="status">{msg}</p>}
      <section className="card p-4">
        <h2 className="text-2xl font-bold text-brand">Live fault injection</h2>
        <p className="text-base text-slate">Simulate a failing government rail. Applicants are routed to a human, never auto-rejected.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {faults && (Object.keys(FAULT_LABEL) as (keyof Faults)[]).map((k) => (
            <button key={k} role="switch" aria-checked={faults[k]} onClick={() => void toggleFault(k)}
              className={`inline-flex min-h-[56px] items-center gap-3 rounded-2xl border-2 px-4 text-lg font-bold ${faults[k] ? "border-danger-line bg-danger-bg text-danger-ink" : "border-line bg-card text-ink hover:bg-tint"}`}>
              <span className={`relative h-7 w-12 rounded-full transition ${faults[k] ? "bg-danger-ink" : "bg-[#c9d1cc]"}`} aria-hidden>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${faults[k] ? "left-6" : "left-1"}`} />
              </span>
              {faults[k] ? "ON" : "OFF"} · {FAULT_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-2xl font-bold text-brand">No-code rule editor</h2>
        <select value={schemeId ?? ""} onChange={(e) => { setSchemeId(Number(e.target.value)); void loadRules(Number(e.target.value)); }} className="field mt-2 max-w-md text-lg">
          {schemes.map((s) => <option key={s.id} value={s.id}>{s.name_en}</option>)}
        </select>
        <textarea value={editor} onChange={(e) => setEditor(e.target.value)} rows={18} spellCheck={false} className="field mt-3 font-mono text-sm" />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Change notes" className="field mt-2 text-lg" />
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" onClick={() => void simulate()} className="btn btn-gold"><Icon name="layers" size={20} /> Run Digital Twin</button>
          <button type="button" onClick={() => void publish()} className="btn btn-primary">Publish new version</button>
        </div>
        <h3 className="mt-5 text-lg font-bold">Version history</h3>
        <div className="table-wrap mt-2">
          <table className="text-base">
            <thead><tr><th>Version</th><th>Status</th><th>Notes</th><th>Created</th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono font-bold">v{v.version}</td>
                  <td>{v.is_active ? <span className="pill pill-safe text-sm">active</span> : <span className="pill pill-neutral text-sm">archived</span>}</td>
                  <td>{v.notes}</td>
                  <td className="whitespace-nowrap text-slate">{new Date(v.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {sim && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-labelledby="twin-title">
          <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
            <h2 id="twin-title" className="text-2xl font-bold text-brand">Digital Twin — projected impact</h2>
            <p className="text-base text-slate">{sim.total_cases} cases replayed ({sim.real_cases} real, {sim.synthetic_cases} synthetic). Nothing was written.</p>
            <div className="table-wrap mt-4">
            <table className="text-center text-lg">
              <thead><tr><th /><th>Baseline</th><th>Projected</th><th>Δ</th></tr></thead>
              <tbody>
                {([["Auto-recommend", "approved"], ["Ask more proof", "ask"], ["Escalate to human", "escalated"]] as const).map(([label, k]) => {
                  const b = sim[`baseline_${k}` as keyof Sim] as number;
                  const p = sim[`projected_${k}` as keyof Sim] as number;
                  return <tr key={k}><td className="text-left font-bold">{label}</td><td>{b}</td><td>{p}</td><td className={`font-bold ${p - b > 0 ? "text-brand" : p - b < 0 ? "text-danger-ink" : ""}`}>{p - b > 0 ? "+" : ""}{p - b}</td></tr>;
                })}
              </tbody>
            </table>
            </div>
            <h3 className="mt-4 text-lg font-bold">{sim.changed_case_ids.length} cases change route</h3>
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-line bg-page p-2 font-mono text-sm">
              {sim.changes.map((c) => <li key={String(c.case_id)}>{String(c.case_id)}: {c.from} → {c.to}</li>)}
            </ul>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => void publish()} className="btn btn-primary">Publish</button>
              <button type="button" onClick={() => setSim(null)} className="btn btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <PageShell title="Admin" width="wide">
      <RequireRole roles={["platform_admin"]}>{() => <Console />}</RequireRole>
    </PageShell>
  );
}
