"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ApplyWizard from "@/components/ApplyWizard";
import Icon from "@/components/Icon";
import RequireRole from "@/components/RequireRole";
import SpeakButton from "@/components/SpeakButton";
import { PageShell, StatusPill } from "@/components/ui";
import { api, ApiError, type Scheme } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { clearDraft } from "@/lib/offlineDb";
import { BUCKET_LABEL, STATUS_BUCKET, type Bucket } from "@/lib/status";

interface Family { citizen_user_id: number; full_name: string; cnic_last4: string | null; consent: Record<string, boolean>; cases: number }
interface Unlocked { citizen_user_id: number; full_name: string; cnic_last4: string | null; consent: Record<string, boolean>; can_act: boolean }
interface CaseRow { id: number; status: string; citizen_user_id?: number; locked?: boolean }

const AUTO_LOCK_MS = 120_000;
type Filter = "all" | Bucket | "none" | "locked";

function HelperMode() {
  const { lang, L } = useLang();
  const [families, setFamilies] = useState<Family[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [drawer, setDrawer] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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

  const loadFamilies = useCallback(() => {
    api<Family[]>("/helper/families").then(setFamilies).catch(() => undefined);
    api<CaseRow[]>("/cases").then(setCases).catch(() => undefined); // real statuses (helper-scoped server-side)
  }, []);
  useEffect(() => {
    loadFamilies();
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
      loadFamilies();
    } catch {
      setErr(L("PIN check failed", "پن درست نہیں"));
    }
  }

  // Latest real status per family (cases arrive newest first; locked rows have no citizen id).
  const latest = new Map<number, string>();
  for (const c of cases) if (c.citizen_user_id !== undefined && !latest.has(c.citizen_user_id)) latest.set(c.citizen_user_id, c.status);
  const familyFilter = (f: Family): Filter => {
    if (!f.consent.helper_access) return "locked";
    const st = latest.get(f.citizen_user_id);
    return st ? STATUS_BUCKET[st] || "review" : "none";
  };
  const counts = { pending: 0, review: 0, approved: 0, not_approved: 0 } as Record<Bucket, number>;
  for (const c of cases) {
    const b = STATUS_BUCKET[c.status];
    if (b) counts[b] += 1;
  }

  const shown = families.filter(
    (f) => `${f.full_name} ${f.cnic_last4}`.toLowerCase().includes(query.toLowerCase()) && (filter === "all" || familyFilter(f) === filter),
  );

  const FILTERS: { k: Filter; en: string; ur: string }[] = [
    { k: "all", en: "All", ur: "سب" },
    { k: "pending", en: BUCKET_LABEL.pending.en, ur: BUCKET_LABEL.pending.ur },
    { k: "review", en: BUCKET_LABEL.review.en, ur: BUCKET_LABEL.review.ur },
    { k: "approved", en: "Approved", ur: "منظور" },
    { k: "not_approved", en: "Not approved", ur: "منظور نہیں" },
    { k: "none", en: "No application yet", ur: "ابھی درخواست نہیں" },
    { k: "locked", en: "Needs permission", ur: "اجازت درکار" },
  ];
  const tile = (label: string, value: number, tone: string, icon: "users" | "clipboard" | "help" | "checkCircle") => (
    <div className="card p-3">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`} aria-hidden><Icon name={icon} size={20} /></span>
        <span className="text-2xl font-bold tabular-nums" dir="ltr">{value}</span>
      </div>
      <div className="mt-1 text-base leading-tight text-slate">{label}</div>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold text-brand">{L("Help Multiple Families", "متعدد خاندانوں کی مدد")}</h1>
          <p className="text-lg text-slate">{L("Open a family with their PIN, then apply or check on their behalf.", "خاندان کو ان کے پن سے کھولیں، پھر ان کی طرف سے درخواست دیں یا حال دیکھیں۔")}</p>
        </div>
        <SpeakButton text="خاندان کو ان کے پن سے کھولیں، پھر ان کی طرف سے درخواست دیں۔" textEn="Open a family with their PIN, then apply on their behalf." size="lg" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {tile(L("Total families assisted", "کل خاندان"), families.length, "bg-tint text-brand", "users")}
        {tile(L("Pending", "زیرِ التوا"), counts.pending, "bg-review-bg text-review-ink", "clipboard")}
        {tile(L("Under review", "زیرِ جائزہ"), counts.review, "bg-review-bg text-review-ink", "help")}
        {tile(L("Approved / Completed", "منظور / مکمل"), counts.approved, "bg-tint text-brand", "checkCircle")}
      </div>

      {/* Persistent active-family banner */}
      <div
        data-testid="family-banner"
        className={`sticky top-[100px] z-30 mb-4 flex items-center gap-3 rounded-2xl border-2 px-4 py-3 shadow-sm ${active ? (active.can_act ? "border-brand bg-brand text-white" : "panel-review") : "border-line bg-card text-ink"}`}
        role="status"
      >
        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${active ? "bg-gold text-ink" : "bg-tint text-brand"}`} aria-hidden><Icon name="users" size={22} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xl font-bold">{active ? active.full_name : L("No family open", "کوئی خاندان کھلا نہیں")}</div>
          {active && (
            <div className="text-base" dir="ltr">CNIC ••••{active.cnic_last4} · {active.can_act ? "✔ consent" : "✖ no consent"}</div>
          )}
        </div>
        <button type="button" onClick={() => setDrawer(!drawer)} className="btn btn-gold min-h-[48px] px-3 text-base">
          <Icon name="sync" size={20} /> {L("Switch", "بدلیں")}
        </button>
        {active && (
          <button type="button" onClick={() => void lock("manual")} aria-label={L("Lock", "تالا")} className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-xl bg-ink text-white">
            <Icon name="lock" size={20} />
          </button>
        )}
      </div>

      {drawer && (
        <div className="card mb-6 p-3">
          <div className="relative">
            <Icon name="search" size={20} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L("Search family by name or CNIC last 4…", "نام یا شناختی کارڈ کے آخری 4 ہندسوں سے تلاش…")} className="field ps-10 text-lg" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={L("Filter by status", "حالت کے لحاظ سے")}>
            {FILTERS.map((f) => (
              <button key={f.k} type="button" aria-pressed={filter === f.k} onClick={() => setFilter(f.k)}
                className={`min-h-[44px] rounded-full border-2 px-3 text-base font-bold ${filter === f.k ? "border-brand bg-brand text-white" : "border-line bg-card text-brand hover:bg-tint"}`}>
                {lang === "ur" ? f.ur : f.en}
              </button>
            ))}
          </div>
          <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
            {shown.map((f) => {
              const st = familyFilter(f);
              return (
                <li key={f.citizen_user_id}>
                  <button
                    type="button"
                    data-testid={`family-${f.citizen_user_id}`}
                    onClick={() => { setPinFor(f); setErr(null); }}
                    className={`flex min-h-[64px] w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 p-3 text-start hover:bg-tint ${pinFor?.citizen_user_id === f.citizen_user_id ? "border-brand bg-tint" : "border-line bg-card"}`}
                  >
                    <span className="min-w-0 flex-1 text-lg font-bold">{f.full_name}</span>
                    <span className="font-mono text-base text-slate" dir="ltr">••••{f.cnic_last4}</span>
                    {st === "locked" ? (
                      <StatusPill tone="neutral">{L("Needs permission", "اجازت درکار")}</StatusPill>
                    ) : st === "none" ? (
                      <StatusPill tone="neutral" icon={false}>{L("No application yet", "ابھی درخواست نہیں")}</StatusPill>
                    ) : (
                      <StatusPill tone={BUCKET_LABEL[st as Bucket].tone}>{lang === "ur" ? BUCKET_LABEL[st as Bucket].ur : BUCKET_LABEL[st as Bucket].en}</StatusPill>
                    )}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="p-3 text-lg text-slate">{L("No families match.", "کوئی خاندان نہیں ملا۔")}</li>}
          </ul>
          <p className="mt-2 text-base text-slate"><span dir="ltr" className="inline-block">{families.length} / 40</span> {L("families", "خاندان")}</p>
        </div>
      )}

      {pinFor && (
        <form onSubmit={unlock} className="panel-review mb-6 rounded-2xl p-4">
          <label htmlFor="family-pin" className="block text-xl font-bold">{L("Family PIN for", "خاندان کا پن")}: {pinFor.full_name}</label>
          <p className="text-lg">{L("Ask the family to type their PIN themselves.", "خاندان سے کہیں کہ پن خود لکھیں۔")}</p>
          <input id="family-pin" autoFocus dir="ltr" inputMode="numeric" type="password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} className="field mt-3 text-center font-mono text-3xl tracking-widest" />
          {err && <p className="mt-2 text-lg font-bold text-danger-ink" role="alert">{err}</p>}
          <button type="submit" className="btn btn-primary mt-3 w-full text-xl"><Icon name="lock" size={22} /> {L("Open", "کھولیں")}</button>
        </form>
      )}

      {active && !active.can_act && (
        <div className="panel-review rounded-2xl p-4">
          <p className="text-xl font-bold">{L("This family has not allowed helper access.", "اس خاندان نے مددگار کو اجازت نہیں دی۔")}</p>
          <button type="button" onClick={() => void grantHelperAccess()} className="btn btn-primary mt-3 w-full">
            <Icon name="hand" size={22} /> {L("Family gives permission (their PIN)", "خاندان اجازت دے (اپنا پن)")}
          </button>
          {err && <p className="mt-2 text-lg font-bold text-danger-ink">{err}</p>}
        </div>
      )}

      {active?.can_act && !scheme && (
        <div>
          <h2 className="mb-2 text-xl font-bold text-brand">{L("Next action: choose a programme to apply for", "اگلا قدم: درخواست کے لیے پروگرام چنیں")}</h2>
          <div className="grid gap-3">
            {schemes.map((s) => (
              <button key={s.id} type="button" onClick={() => setScheme(s)} className="card flex min-h-[64px] items-center gap-3 p-4 text-start text-xl font-bold text-brand hover:bg-tint">
                <Icon name="form" size={24} /> {lang === "ur" ? s.name_ur : s.name_en}
              </button>
            ))}
          </div>
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
    <PageShell title={L("Helper mode", "مددگار موڈ")}>
      <RequireRole roles={["community_helper"]}>{() => <HelperMode />}</RequireRole>
    </PageShell>
  );
}
