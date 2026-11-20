"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import ApplyWizard from "@/components/ApplyWizard";
import RequireRole from "@/components/RequireRole";
import { api, ApiError, type Scheme } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { clearDraft } from "@/lib/offlineDb";

interface Family { citizen_user_id: number; full_name: string; cnic_last4: string | null; consent: Record<string, boolean>; cases: number }
interface Unlocked { citizen_user_id: number; full_name: string; cnic_last4: string | null; consent: Record<string, boolean>; can_act: boolean }

const AUTO_LOCK_MS = 120_000;

function HelperMode() {
  const { lang, L } = useLang();
  const [families, setFamilies] = useState<Family[]>([]);
  const [drawer, setDrawer] = useState(true);
  const [query, setQuery] = useState("");
  const [pinFor, setPinFor] = useState<Family | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState<Unlocked | null>(null);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const activeRef = useRef<Unlocked | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const loadFamilies = useCallback(() => api<Family[]>("/helper/families").then(setFamilies).catch(() => undefined), []);
  useEffect(() => {
    void loadFamilies();
    api<Scheme[]>("/schemes").then(setSchemes).catch(() => undefined);
  }, [loadFamilies]);

  const lock = useCallback(async (reason: string) => {
    const prev = activeRef.current;
    if (prev) {
      await clearDraft(`application:${prev.citizen_user_id}`).catch(() => undefined);
      await api("/helper/lock", { body: { citizen_user_id: prev.citizen_user_id, reason } }).catch(() => undefined);
    }
    setActive(null);
    setScheme(null);
    setDrawer(true);
  }, []);

  // Auto-lock after 2 minutes of inactivity (shared phone)
  useEffect(() => {
    const bump = () => setLastActivity(Date.now());
    ["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, bump));
    const iv = window.setInterval(() => {
      if (activeRef.current && Date.now() - lastActivity > AUTO_LOCK_MS) void lock("inactivity");
    }, 5000);
    return () => {
      ["pointerdown", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(iv);
    };
  }, [lastActivity, lock]);

  async function unlock(e: React.FormEvent) {
    e.preventDefault();
    if (!pinFor) return;
    setErr(null);
    try {
      const prev = activeRef.current;
      if (prev) await clearDraft(`application:${prev.citizen_user_id}`).catch(() => undefined); // clear local form state on switch
      const u = await api<Unlocked>(`/helper/families/${pinFor.citizen_user_id}/unlock`, {
        body: { pin, from_citizen_user_id: prev?.citizen_user_id ?? null },
      });
      setActive(u);
      setScheme(null);
      setDrawer(false);
      setPinFor(null);
      setPin("");
    } catch (ex) {
      setErr(ex instanceof ApiError && ex.status === 429 ? L("Too many tries. Wait a minute.", "بہت زیادہ کوششیں۔ ایک منٹ رکیں۔") : L("Wrong PIN", "غلط پن"));
    }
  }

  async function grantHelperAccess() {
    if (!active) return;
    const familyPin = window.prompt(L("Family: enter YOUR PIN to allow the helper", "خاندان: مددگار کو اجازت دینے کے لیے اپنا پن درج کریں")) || "";
    try {
      await api("/consents", { body: { scope: "helper_access", citizen_user_id: active.citizen_user_id, family_pin: familyPin } });
      await api("/consents", { body: { scope: "identity", citizen_user_id: active.citizen_user_id, family_pin: familyPin } });
      setActive({ ...active, can_act: true, consent: { ...active.consent, helper_access: true, identity: true } });
      void loadFamilies();
    } catch {
      setErr(L("PIN check failed", "پن درست نہیں"));
    }
  }

  const shown = families.filter((f) => `${f.full_name} ${f.cnic_last4}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      {/* Persistent active-family banner */}
      <div className={`sticky top-12 z-30 -mx-4 mb-4 flex items-center gap-3 px-4 py-3 text-white ${active ? (active.can_act ? "bg-ok" : "bg-warn") : "bg-gray-700"}`} role="status">
        <span className="text-3xl" aria-hidden>👤</span>
        <div className="flex-1">
          <div className="text-xl font-bold">{active ? active.full_name : L("No family open", "کوئی خاندان کھلا نہیں")}</div>
          {active && (
            <div className="text-sm" dir="ltr">CNIC ••••{active.cnic_last4} · {active.can_act ? "✔ consent" : "✖ no consent"}</div>
          )}
        </div>
        <button onClick={() => setDrawer(!drawer)} className="rounded-xl bg-white px-4 py-2 font-bold text-black">⇄ {L("Switch", "بدلیں")}</button>
        {active && <button onClick={() => void lock("manual")} className="rounded-xl bg-black px-3 py-2 font-bold">🔒</button>}
      </div>

      {drawer && (
        <div className="mb-6 rounded-2xl border-4 border-black p-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("Search family…", "خاندان تلاش کریں…")} className="w-full rounded-xl border-2 border-gray-500 p-3 text-lg" />
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {shown.map((f) => (
              <li key={f.citizen_user_id}>
                <button onClick={() => { setPinFor(f); setErr(null); }} className="flex w-full items-center gap-3 rounded-xl border-2 border-gray-400 p-3 text-start">
                  <span className="flex-1 text-lg font-bold">{f.full_name}</span>
                  <span className="font-mono" dir="ltr">••••{f.cnic_last4}</span>
                  <span className={`rounded-full px-2 py-0.5 text-sm font-bold text-white ${f.consent.helper_access ? "bg-ok" : "bg-gray-500"}`}>
                    {f.consent.helper_access ? "✔" : "✖"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">{families.length} / 40 {L("families", "خاندان")}</p>
        </div>
      )}

      {pinFor && (
        <form onSubmit={unlock} className="mb-6 rounded-2xl border-4 border-human bg-blue-50 p-4">
          <p className="text-xl font-bold">{L("Family PIN for", "خاندان کا پن")}: {pinFor.full_name}</p>
          <input autoFocus dir="ltr" inputMode="numeric" type="password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} className="mt-3 w-full rounded-xl border-4 border-black p-4 text-center font-mono text-3xl tracking-widest" />
          {err && <p className="mt-2 font-bold text-danger" role="alert">{err}</p>}
          <button className="mt-3 w-full rounded-xl bg-human py-4 text-2xl font-bold text-white">{L("Open", "کھولیں")}</button>
        </form>
      )}

      {active && !active.can_act && (
        <div className="rounded-2xl border-4 border-warn bg-orange-50 p-4">
          <p className="text-xl font-bold">{L("This family has not allowed helper access.", "اس خاندان نے مددگار کو اجازت نہیں دی۔")}</p>
          <button onClick={() => void grantHelperAccess()} className="mt-3 w-full rounded-xl bg-warn py-4 text-xl font-bold text-white">
            🤝 {L("Family gives permission (their PIN)", "خاندان اجازت دے (اپنا پن)")}
          </button>
          {err && <p className="mt-2 font-bold text-danger">{err}</p>}
        </div>
      )}

      {active?.can_act && !scheme && (
        <div className="grid gap-3">
          {schemes.map((s) => (
            <button key={s.id} onClick={() => setScheme(s)} className="rounded-2xl border-4 border-black bg-white p-5 text-start text-2xl font-bold">
              {lang === "ur" ? s.name_ur : s.name_en}
            </button>
          ))}
        </div>
      )}
      {active?.can_act && scheme && (
        <ApplyWizard key={`${active.citizen_user_id}-${scheme.id}`} scheme={scheme} citizenUserId={active.citizen_user_id} onCancel={() => setScheme(null)} />
      )}
    </>
  );
}

export default function HelperPage() {
  const { L } = useLang();
  return (
    <>
      <AppHeader title={L("Helper mode", "مددگار موڈ")} />
      <div className="mx-auto max-w-xl px-4 pb-6">
        <RequireRole roles={["community_helper"]}>{() => <HelperMode />}</RequireRole>
      </div>
    </>
  );
}
