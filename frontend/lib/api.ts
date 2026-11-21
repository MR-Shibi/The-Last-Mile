/** Thin API client. Security is enforced server-side; the UI only mirrors it. */
import { useMemo } from "react";
import { useStorageValue, writeSessionValue, writeStorage } from "@/lib/stores";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

export const FLASH_KEY = "lm.flash";

/** Clean logout: drop the tokens/role, every sessionStorage key and the local form drafts, then leave a one-shot
 * "Logged out successfully" flash. Queued offline items stay (owner-tagged) and sync when that person logs in again. */
export async function logout(): Promise<void> {
  setSession(null);
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
  try {
    const { clearDraftsWithPrefix } = await import("@/lib/offlineDb");
    await clearDraftsWithPrefix("application:");
  } catch {
    /* IndexedDB unavailable */
  }
  writeSessionValue(FLASH_KEY, "logged_out");
}

/** Full-page navigation on every account change. With `cacheComponents`, Next keeps recently visited routes alive in
 * hidden <Activity> trees; a hard load guarantees no page state of the previous account (queues, forms, families)
 * survives a logout or a new login. */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}

export async function logoutAndGoHome(): Promise<void> {
  await logout();
  hardNavigate("/");
}

/** Who is logged in, for the header badge. */
export const ROLE_LABEL: Record<Role, [string, string]> = {
  citizen: ["Citizen", "شہری"],
  community_helper: ["Community Helper", "کمیونٹی مددگار"],
  department_officer: ["Department Officer", "محکمہ افسر"],
  platform_admin: ["Platform Admin", "ایڈمن"],
  auditor: ["Auditor", "آڈیٹر"],
};

/** Each role's own console, for the header "My Portal" button and the Home quick-return banner. */
export const PORTAL: Record<Role, { href: string; en: string; ur: string }> = {
  citizen: { href: "/citizen", en: "My Application", ur: "میری درخواست" },
  community_helper: { href: "/helper", en: "Helper Dashboard", ur: "مددگار ڈیش بورڈ" },
  department_officer: { href: "/officer", en: "Officer Console", ur: "افسر ڈیش بورڈ" },
  platform_admin: { href: "/admin", en: "Admin Portal", ur: "ایڈمن پورٹل" },
  auditor: { href: "/auditor", en: "Auditor Log", ur: "آڈیٹر لاگ" },
};

export const isStaff = (r: Role) => r === "platform_admin" || r === "department_officer" || r === "auditor";

/** Which roles may open which area (UX mirror of the server's RBAC). */
const AREA_ROLES: [string, Role[]][] = [
  ["/citizen", ["citizen"]],
  ["/helper", ["community_helper"]],
  ["/officer", ["department_officer"]],
  ["/admin", ["platform_admin"]],
  ["/auditor", ["auditor"]],
];

export function pathAllowed(path: string, role: Role): boolean {
  const hit = AREA_ROLES.find(([p]) => path === p || path.startsWith(`${p}/`));
  return !hit || hit[1].includes(role);
}

/** Where to go right after a successful login: a valid `next` for this role, else Home for citizens/helpers
 * (where the account badge + decision pop-up appear), else the staff workspace. */
export function afterLoginPath(role: Role, next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") && pathAllowed(next, role)) return next;
  return role === "citizen" || role === "community_helper" ? "/" : HOME_FOR_ROLE[role];
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
