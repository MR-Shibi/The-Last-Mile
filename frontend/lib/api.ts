/** Thin API client. Security is enforced server-side; the UI only mirrors it. */
import { useMemo } from "react";
import { useStorageValue, writeStorage } from "@/lib/stores";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export type Role = "citizen" | "community_helper" | "department_officer" | "platform_admin" | "auditor";

export interface Session {
  access_token: string;
  refresh_token: string;
  role: Role;
  user_id: number;
  tenant_id: number;
  full_name: string;
}

const KEY = "lm.session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null): void {
  writeStorage(KEY, s ? JSON.stringify(s) : null);
}

/** Reactive session (hydration-safe). */
export function useSession(): Session | null {
  const raw = useStorageValue(KEY);
  return useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  }, [raw]);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function refresh(): Promise<boolean> {
  const s = getSession();
  if (!s) return false;
  const r = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: s.refresh_token }),
  });
  if (!r.ok) return false;
  const t = await r.json();
  setSession({ ...s, access_token: t.access_token, refresh_token: t.refresh_token });
  return true;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData; auth?: boolean } = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  const s = getSession();
  if (opts.auth !== false && s) headers.Authorization = `Bearer ${s.access_token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const r = await fetch(`${API_BASE}${path}`, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  if (r.status === 401 && !retried && s && (await refresh())) return api<T>(path, opts, true);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await r.json() : await r.blob();
  if (!r.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    throw new ApiError(r.status, typeof detail === "string" ? detail : `HTTP ${r.status}`, data);
  }
  return data as T;
}

export async function login(username: string, password: string): Promise<Session> {
  const s = await api<Session>("/auth/login", { body: { username, password }, auth: false });
  setSession(s);
  return s;
}

export function logout(): void {
  setSession(null);
}

export const HOME_FOR_ROLE: Record<Role, string> = {
  citizen: "/citizen",
  community_helper: "/helper",
  department_officer: "/officer",
  platform_admin: "/admin",
  auditor: "/auditor",
};

// ---------------------------------------------------------------- shared response types
export interface Scheme { id: number; code: string; name_en: string; name_ur: string; description_en: string; description_ur: string; amount_pkr: number; icon: string }
export interface DecisionSummary { id: number; route: string; probability: number; reason_user_en: string; reason_user_ur: string; rule_version_id?: number }
export interface Receipt {
  case_id: number; reference: string; pin: string; status: string; color: "green" | "yellow" | "blue" | "red";
  status_en: string; status_ur: string; scheme_en: string; scheme_ur: string; amount_pkr: number;
  reason_en: string | null; reason_ur: string | null; audio_key: string | null; qr: string; submitted_at: string; notice: string;
}
export interface Consent { id: number; citizen_user_id: number; scope: string; active: boolean; granted_via: string; granted_at: string; revoked_at: string | null }
