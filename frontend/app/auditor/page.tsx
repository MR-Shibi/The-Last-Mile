"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { PageShell } from "@/components/ui";
import RequireRole from "@/components/RequireRole";
import { api, ApiError, type Consent } from "@/lib/api";

interface Chain { valid: boolean; verified_count: number; broken_at?: number; reason?: string; head_hash?: string }
interface Log { id: number; ts: string; action: string; actor_role: string | null; resource_type: string | null; resource_id: string | null; row_hash: string }

/** Read-only auditor console (the API rejects every write from this role). */
function Console() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [consents, setConsents] = useState<Consent[]>([]);
  const [decisionId, setDecisionId] = useState("");
  const [trace, setTrace] = useState<unknown>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api<Log[]>("/audit/logs?limit=300").then(setLogs).catch(() => undefined);
    api<Consent[]>("/consents").then(setConsents).catch(() => undefined);
  }, []);

  async function loadTrace() {
    try {
      setTrace(await api(`/decisions/${Number(decisionId)}/trace`));
    } catch (e) {
      setTrace({ error: e instanceof ApiError ? `${e.status} ${e.message}` : String(e) });
    }
  }

  return (
    <div dir="ltr" className="space-y-6">
      <section className="card p-4">
        <button type="button" onClick={() => void api<Chain>("/audit/verify-chain").then(setChain)} className="btn btn-primary text-xl">
          <Icon name="link" size={22} /> Verify Hash Chain Integrity
        </button>
        {chain && (
          <p className={`mt-3 break-all rounded-xl p-4 text-lg font-bold ${chain.valid ? "panel-safe" : "panel-danger"}`} role="status">
            {chain.valid ? `VALID — ${chain.verified_count} entries verified · head ${chain.head_hash?.slice(0, 16)}…` : `TAMPERING DETECTED at row ${chain.broken_at}: ${chain.reason}`}
          </p>
        )}
      </section>
      <section className="card p-4">
        <h2 className="text-xl font-bold text-brand">Decision trace viewer</h2>
        <div className="mt-2 flex gap-2">
          <input value={decisionId} onChange={(e) => setDecisionId(e.target.value)} placeholder="Decision ID" className="field max-w-xs text-lg" />
          <button type="button" onClick={() => void loadTrace()} className="btn btn-primary">Load</button>
        </div>
        {trace !== null && <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-brand-hover p-3 text-sm text-tint">{JSON.stringify(trace, null, 2)}</pre>}
      </section>
      <section className="card p-4">
        <h2 className="text-xl font-bold text-brand">Consent history timeline</h2>
        <ol className="mt-2 max-h-72 overflow-y-auto border-l-4 border-line pl-4 text-base">
          {consents.map((c) => (
            <li key={c.id} className="mb-2">
              <span className={`pill mr-2 text-sm ${c.active ? "pill-safe" : "pill-neutral"}`}>{c.active ? "GRANTED" : "REVOKED"}</span>
              citizen #{c.citizen_user_id} · {c.scope} · via {c.granted_via} · {new Date(c.revoked_at || c.granted_at).toLocaleString()}
            </li>
          ))}
        </ol>
      </section>
      <section className="card p-4">
        <h2 className="text-xl font-bold text-brand">Audit log</h2>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter action…" className="field mt-2 max-w-sm text-lg" />
        <div className="table-wrap mt-2 max-h-[32rem] overflow-y-auto">
          <table className="text-sm">
            <thead><tr><th>#</th><th>time</th><th>action</th><th>actor</th><th>resource</th><th>row_hash</th></tr></thead>
            <tbody>
              {logs.filter((l) => l.action.includes(filter)).map((l) => (
                <tr key={l.id}><td>{l.id}</td><td className="whitespace-nowrap">{l.ts.slice(0, 19)}</td><td className="font-bold">{l.action}</td><td>{l.actor_role}</td><td>{l.resource_type}:{l.resource_id}</td><td className="font-mono">{l.row_hash.slice(0, 12)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AuditorPage() {
  return (
    <PageShell title="Auditor (read-only)" width="wide">
      <RequireRole roles={["auditor"]}>{() => <Console />}</RequireRole>
    </PageShell>
  );
}
