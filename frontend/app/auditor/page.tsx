"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
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
    <div dir="ltr" className="space-y-8">
      <section>
        <button onClick={() => void api<Chain>("/audit/verify-chain").then(setChain)} className="rounded-2xl bg-brand px-6 py-4 text-xl font-bold text-white">
          🔗 Verify Hash Chain Integrity
        </button>
        {chain && (
          <p className={`mt-3 rounded-xl p-4 text-lg font-bold text-white ${chain.valid ? "bg-ok" : "bg-danger"}`} role="status">
            {chain.valid ? `VALID — ${chain.verified_count} entries verified · head ${chain.head_hash?.slice(0, 16)}…` : `TAMPERING DETECTED at row ${chain.broken_at}: ${chain.reason}`}
          </p>
        )}
      </section>
      <section>
        <h2 className="text-xl font-bold">Decision trace viewer</h2>
        <div className="mt-2 flex gap-2">
          <input value={decisionId} onChange={(e) => setDecisionId(e.target.value)} placeholder="Decision ID" className="rounded-lg border-2 border-black p-2" />
          <button onClick={() => void loadTrace()} className="rounded-lg bg-black px-4 py-2 font-bold text-white">Load</button>
        </div>
        {trace !== null && <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-green-200">{JSON.stringify(trace, null, 2)}</pre>}
      </section>
      <section>
        <h2 className="text-xl font-bold">Consent history timeline</h2>
        <ol className="mt-2 max-h-72 overflow-y-auto border-l-4 border-brand pl-4 text-sm">
          {consents.map((c) => (
            <li key={c.id} className="mb-2">
              <span className={`mr-2 rounded px-2 font-bold text-white ${c.active ? "bg-ok" : "bg-gray-500"}`}>{c.active ? "GRANTED" : "REVOKED"}</span>
              citizen #{c.citizen_user_id} · {c.scope} · via {c.granted_via} · {new Date(c.revoked_at || c.granted_at).toLocaleString()}
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2 className="text-xl font-bold">Audit log</h2>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter action…" className="mt-2 rounded-lg border-2 border-gray-400 p-2" />
        <table className="mt-2 w-full text-xs">
          <thead><tr className="bg-gray-100 text-left"><th className="p-1">#</th><th>time</th><th>action</th><th>actor</th><th>resource</th><th>row_hash</th></tr></thead>
          <tbody>
            {logs.filter((l) => l.action.includes(filter)).map((l) => (
              <tr key={l.id} className="border-t"><td className="p-1">{l.id}</td><td>{l.ts.slice(0, 19)}</td><td className="font-bold">{l.action}</td><td>{l.actor_role}</td><td>{l.resource_type}:{l.resource_id}</td><td className="font-mono">{l.row_hash.slice(0, 12)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default function AuditorPage() {
  return (
    <>
      <AppHeader title="Auditor (read-only)" />
      <div className="mx-auto max-w-5xl px-4 py-6">
        <RequireRole roles={["auditor"]}>{() => <Console />}</RequireRole>
      </div>
    </>
  );
}
