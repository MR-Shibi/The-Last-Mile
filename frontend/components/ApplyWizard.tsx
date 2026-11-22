"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Receipt, type Scheme } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { formatBytes, shrinkForUpload } from "@/lib/image";
import { formatCnic, normalizeDigits, parseSpokenAmount, parseSpokenCnic } from "@/lib/urduNumberParser";
import { enqueue, newClientEventId, saveDraft } from "@/lib/offlineDb";
import ConsentPanel from "@/components/ConsentPanel";
import Icon from "@/components/Icon";
import Parchi from "@/components/Parchi";
import ResilientImage from "@/components/ResilientImage";
import SpeakButton, { speak } from "@/components/SpeakButton";
import VoiceInput from "@/components/VoiceInput";
import NumericKeypad from "@/components/NumericKeypad";
import { notifyOutboxChanged } from "@/components/AppHeader";

type TextKey = "full_name" | "father_name" | "cnic" | "age" | "monthly_income" | "dependents";
type ChoiceKey = "province" | "is_widow" | "receives_other_grant";
type Prompt = { en: string; ur: string; hint_en?: string; hint_ur?: string };
type Q = Prompt & { key: TextKey; kind: "text" | "number" | "cnic" };

const Q_TEXT: Record<TextKey, Q> = {
  full_name: { key: "full_name", en: "What is your full name?", ur: "آپ کا پورا نام کیا ہے؟", kind: "text", hint_en: "As written on your CNIC", hint_ur: "جیسا شناختی کارڈ پر لکھا ہے" },
  father_name: { key: "father_name", en: "What is your father's (or husband's) name?", ur: "آپ کے والد (یا شوہر) کا نام کیا ہے؟", kind: "text" },
  cnic: { key: "cnic", en: "What is your CNIC number? (13 digits)", ur: "آپ کا شناختی کارڈ نمبر کیا ہے؟ (13 ہندسے)", kind: "cnic", hint_en: "Example: 42501-1234567-1 — type it, say it digit by digit, or use the keypad", hint_ur: "مثال: 42501-1234567-1 — لکھیں، ایک ایک ہندسہ بولیں، یا کی پیڈ استعمال کریں" },
  age: { key: "age", en: "How old are you?", ur: "آپ کی عمر کتنی ہے؟", kind: "number" },
  monthly_income: { key: "monthly_income", en: "What is your household's monthly income in rupees?", ur: "آپ کے گھر کی ماہانہ آمدنی کتنے روپے ہے؟", kind: "number", hint_en: "Numbers or words both work, e.g. \"dedh lakh\" or \"sadhe teen hazar\"", hint_ur: "ہندسے یا الفاظ دونوں چلیں گے، جیسے ڈیڑھ لاکھ یا ساڑھے تین ہزار" },
  dependents: { key: "dependents", en: "How many children or dependents live with you?", ur: "آپ کے ساتھ کتنے بچے یا زیرِ کفالت افراد رہتے ہیں؟", kind: "number" },
};
const Q_CHOICE: Record<ChoiceKey, Prompt> = {
  province: { en: "Which province do you live in?", ur: "آپ کس صوبے میں رہتی ہیں؟" },
  is_widow: { en: "Are you a widow?", ur: "کیا آپ بیوہ ہیں؟" },
  receives_other_grant: { en: "Do you already get another cash grant?", ur: "کیا آپ کو پہلے سے کوئی اور نقد امداد ملتی ہے؟" },
};
const PROVINCES = [["Sindh", "سندھ"], ["Punjab", "پنجاب"], ["KP", "خیبر پختونخوا"], ["Balochistan", "بلوچستان"]] as const;

const STEPS = [
  { en: "Consent & Full Name", ur: "اجازت اور پورا نام", short_en: "Consent & name", short_ur: "اجازت و نام",
    say_en: "Step 1 of 4. Choose who may see your information, then tell us your name and a few details.", say_ur: "مرحلہ 1، کل 4۔ بتائیں کون آپ کی معلومات دیکھ سکتا ہے، پھر اپنا نام اور چند تفصیلات بتائیں۔" },
  { en: "CNIC & Monthly Income", ur: "شناختی کارڈ اور ماہانہ آمدنی", short_en: "CNIC & income", short_ur: "کارڈ و آمدنی",
    say_en: "Step 2 of 4. Enter your CNIC number and your household's monthly income.", say_ur: "مرحلہ 2، کل 4۔ اپنا شناختی کارڈ نمبر اور گھر کی ماہانہ آمدنی بتائیں۔" },
  { en: "Document Photo", ur: "کاغذ کی تصویر", short_en: "Photo", short_ur: "تصویر",
    say_en: "Step 3 of 4. Take a clear photo of your CNIC in good light.", say_ur: "مرحلہ 3، کل 4۔ اچھی روشنی میں اپنے شناختی کارڈ کی صاف تصویر لیں۔" },
  { en: "Review & Submit", ur: "جائزہ اور جمع", short_en: "Review", short_ur: "جائزہ",
    say_en: "Step 4 of 4. Check your answers, then press Submit application.", say_ur: "مرحلہ 4، کل 4۔ اپنے جوابات دیکھیں، پھر درخواست جمع کریں دبائیں۔" },
] as const;

interface VisionResult { flags: string[]; ok_to_submit: boolean; retake_tips: { flag: string; en: string; ur: string }[] }

/** Typed digits ("15000", "1,500", "۱۵۰۰۰") or words ("ڈیڑھ لاکھ", "pandrah hazar") -> number. */
function toNumber(raw: string): number | string {
  const n = Number(normalizeDigits(raw).replace(/,/g, ""));
  return Number.isFinite(n) && raw.trim() !== "" ? n : (parseSpokenAmount(raw) ?? raw);
}

/** 4-step guided application (citizen, or helper on a family's behalf) with clickable step tabs and a
 * Show-All mode. One stateful component: answers, consent, photo and the idempotency key survive moving
 * between steps; every change is also kept on the phone (IndexedDB) for weak networks. */
export default function ApplyWizard({ scheme, citizenUserId, onCancel }: { scheme: Scheme; citizenUserId?: number; onCancel: () => void }) {
  const { lang, L } = useLang();
  const isHelper = citizenUserId !== undefined;
  const [step, setStep] = useState(0); // 0..3
  const [showAll, setShowAll] = useState(false);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [fields, setFields] = useState<Record<TextKey, string>>({ full_name: "", father_name: "", cnic: "", age: "", monthly_income: "", dependents: "" });
  const [choices, setChoices] = useState<{ province?: string; is_widow?: boolean; receives_other_grant?: boolean }>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [vision, setVision] = useState<VisionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [shrink, setShrink] = useState<{ resized: boolean; from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [helperLink, setHelperLink] = useState<{ pin: string; name: string | null } | null>(null);
  const eventId = useRef(newClientEventId());
  const consentsSaved = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const setField = (k: TextKey, v: string) => setFields((f) => ({ ...f, [k]: v }));

  function buildData(): Record<string, string | number | boolean> {
    const d: Record<string, string | number | boolean> = {};
    for (const q of Object.values(Q_TEXT)) {
      const raw = fields[q.key].trim();
      if (!raw) continue;
      d[q.key] = q.kind === "number" ? toNumber(raw) : q.kind === "cnic" ? parseSpokenCnic(raw) || raw : raw;
    }
    if (choices.province) d.province = choices.province;
    if (choices.is_widow !== undefined) d.is_widow = choices.is_widow;
    if (choices.receives_other_grant !== undefined) d.receives_other_grant = choices.receives_other_grant;
    return d;
  }

  // Offline-safe draft: every change is kept on the phone (IndexedDB).
  useEffect(() => {
    const t = window.setTimeout(() => {
      void saveDraft(`application:${citizenUserId ?? "self"}`, buildData()).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildData only reads fields/choices
  }, [fields, choices, citizenUserId]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const cnicDigits = (parseSpokenCnic(fields.cnic) || "").replace(/\D/g, "");
  const isNum = (k: TextKey) => !!fields[k].trim() && typeof toNumber(fields[k]) === "number";
  const missing: { step: number; q: Prompt }[] = [];
  const need = (ok: boolean, s: number, q: Prompt) => { if (!ok) missing.push({ step: s, q }); };
  need(!!fields.full_name.trim(), 0, Q_TEXT.full_name);
  need(!!fields.father_name.trim(), 0, Q_TEXT.father_name);
  need(isNum("age"), 0, Q_TEXT.age);
  need(!!choices.province, 0, Q_CHOICE.province);
  need(choices.is_widow !== undefined, 0, Q_CHOICE.is_widow);
  need(cnicDigits.length === 13, 1, Q_TEXT.cnic);
  need(isNum("monthly_income"), 1, Q_TEXT.monthly_income);
  need(isNum("dependents"), 1, Q_TEXT.dependents);
  need(choices.receives_other_grant !== undefined, 1, Q_CHOICE.receives_other_grant);

  function go(s: number) {
    if (showAll) {
      document.getElementById(`apply-step-${s}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setStep(s);
    topRef.current?.scrollIntoView({ block: "start" });
  }

  async function saveConsents() {
    if (isHelper || consentsSaved.current) return;
    const chosen = Object.entries(consent).filter(([, on]) => on).map(([s]) => s);
    for (const scope of chosen) {
      if (navigator.onLine) {
        try {
          const r = await api<{ helper_pin?: string; helper_name?: string | null }>("/consents", { body: { scope } });
          // First "my helper may help me" consent links a community helper and returns a one-time family PIN
          if (r.helper_pin) setHelperLink({ pin: r.helper_pin, name: r.helper_name ?? null });
        } catch {
          await enqueue("consent_grant", { scope });
        }
      } else await enqueue("consent_grant", { scope });
    }
    consentsSaved.current = true;
    notifyOutboxChanged();
  }

  async function checkPhoto(original: File) {
    setVision(null);
    setChecking(true);
    try {
      // Shrink on the phone first (<=1024px JPEG): fast on 2G and light on the free-tier server.
      const s = await shrinkForUpload(original);
      setPhoto(s.file);
      setPreview(URL.createObjectURL(s.file));
      setShrink({ resized: s.resized, from: formatBytes(s.originalBytes), to: formatBytes(s.finalBytes) });
      if (!navigator.onLine) return;
      const form = new FormData();
      form.append("file", s.file);
      const params = new URLSearchParams();
      if (cnicDigits) params.set("cnic", parseSpokenCnic(fields.cnic));
      if (isHelper) params.set("citizen_user_id", String(citizenUserId)); // whose photo it is (shared phone)
      const qs = params.size ? `?${params.toString()}` : "";
      const v = await api<VisionResult>(`/vision/check${qs}`, { form });
      setVision(v);
      if (!v.ok_to_submit) void speak({ audioKey: "retake_photo", lang });
    } catch {
      /* the server re-checks on submit anyway */
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    setTriedSubmit(true);
    if (missing.length) return;
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { scheme_id: scheme.id, data: buildData() };
    if (isHelper) payload.citizen_user_id = citizenUserId;
    try {
      await saveConsents();
      if (!navigator.onLine) throw new TypeError("offline");
      const c = await api<{ id: number }>("/cases", { body: { ...payload, client_event_id: eventId.current } });
      if (photo) {
        const form = new FormData();
        form.append("file", photo);
        await api(`/cases/${c.id}/documents`, { form });
      }
      setReceipt(await api<Receipt>(`/cases/${c.id}/receipt`));
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        // Weak/dropped network: keep everything locally with the same idempotency key.
        await enqueue("case_submit", payload, citizenUserId, eventId.current);
        if (photo) {
          const dataUrl = await new Promise<string>((res) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.readAsDataURL(photo);
          });
          await saveDraft(`photo:${eventId.current}`, { dataUrl });
        }
        notifyOutboxChanged();
        setQueued(eventId.current);
      }
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------------ finished: Parchi, or saved offline
  if (receipt || queued) {
    return (
      <section>
        {receipt ? (
          <>
            <Parchi r={receipt} />
            {helperLink && (
              <div data-testid="helper-link-pin" className="panel-safe mt-4 rounded-2xl p-4" role="status">
                <h3 className="text-xl font-bold">{L("Your community helper is linked", "آپ کی کمیونٹی مددگار شامل ہو گئی")}</h3>
                <p className="mt-1 text-lg">
                  {L(`${helperLink.name || "Your helper"} can now see this application. To let them open it, tell them this family PIN in person:`,
                    `${helperLink.name || "آپ کی مددگار"} اب یہ درخواست دیکھ سکتی ہیں۔ انہیں کھولنے کے لیے یہ خاندانی پن خود بتائیں:`)}
                </p>
                <p className="mt-2 text-center font-mono text-4xl font-bold tracking-[0.4em]" dir="ltr">{helperLink.pin}</p>
                <p className="mt-2 text-base">{L("Shown only once — write it down. You can take helper access back any time under “Who has my data?”.", "یہ صرف ایک بار دکھایا جائے گا — لکھ لیں۔ مددگار کی اجازت کسی بھی وقت “میرا ڈیٹا کس کے پاس ہے؟” میں واپس لے سکتے ہیں۔")}</p>
              </div>
            )}
          </>
        ) : (
          <div className="panel-review rounded-2xl p-6 text-center" role="status">
            <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-card text-review-ink"><Icon name="wifiOff" size={30} /></span>
            <h2 className="mt-2 text-2xl font-bold">{L("Saved on this phone", "اس فون میں محفوظ ہو گئی")}</h2>
            <p className="mt-2 text-lg">{L("No internet right now. Your application will be sent automatically when the connection returns — it will never be sent twice.", "ابھی انٹرنیٹ نہیں ہے۔ کنکشن واپس آتے ہی درخواست خود بخود بھیج دی جائے گی — دو بار نہیں جائے گی۔")}</p>
            <p className="mt-3 font-mono text-base" dir="ltr">{queued}</p>
          </div>
        )}
        <button type="button" onClick={onCancel} className="btn btn-secondary mt-5 w-full">{L("Done", "ختم")}</button>
      </section>
    );
  }

  // ------------------------------------------------------------------ building blocks (plain render helpers)
  const stepHeader = (i: number) => (
    <div className="mb-4 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold text-slate">{L(`Step ${i + 1} of 4`, `مرحلہ ${i + 1} از 4`)}</p>
        <h2 className="text-2xl font-bold text-brand">{lang === "ur" ? STEPS[i].ur : STEPS[i].en}</h2>
      </div>
      <SpeakButton text={STEPS[i].say_ur} textEn={STEPS[i].say_en} size="lg" label={L(`Listen: step ${i + 1}`, `سنیں: مرحلہ ${i + 1}`)} />
    </div>
  );

  const fieldLabel = (q: Prompt, htmlFor?: string) => (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-xl font-bold">{lang === "ur" ? q.ur : q.en}</label>
        ) : (
          <p className="text-xl font-bold">{lang === "ur" ? q.ur : q.en}</p>
        )}
        {q.hint_en && <p className="text-lg text-slate">{lang === "ur" ? q.hint_ur : q.hint_en}</p>}
      </div>
      <SpeakButton text={[q.ur, q.hint_ur].filter(Boolean).join("۔ ")} textEn={[q.en, q.hint_en].filter(Boolean).join(". ")} />
    </div>
  );

  const textField = (k: TextKey) => {
    const q = Q_TEXT[k];
    const id = `apply-${k}`;
    const words = q.kind === "number" && !!fields[k].trim() && !/^[\d,.\s]+$/.test(normalizeDigits(fields[k]));
    const parsed = words ? toNumber(fields[k]) : null;
    return (
      <div className="card p-4" key={k}>
        {fieldLabel(q, id)}
        <input
          id={id}
          data-testid={`field-${k}`}
          value={fields[k]}
          onChange={(e) => setField(k, q.kind === "cnic" ? formatCnic(normalizeDigits(e.target.value)) : e.target.value)}
          inputMode={q.kind === "cnic" ? "numeric" : "text"}
          autoComplete="off"
          dir={q.kind === "text" ? undefined : "ltr"}
          placeholder={q.kind === "cnic" ? "42501-1234567-1" : ""}
          className="field mt-3 text-2xl"
        />
        {typeof parsed === "number" && (
          <p className="mt-2 text-lg font-bold text-brand">= <span dir="ltr" className="inline-block">{k === "monthly_income" ? `Rs ${parsed.toLocaleString()}` : parsed}</span></p>
        )}
        {q.kind === "cnic" && (
          <NumericKeypad
            onDigit={(d) => setField(k, formatCnic(fields[k].replace(/\D/g, "") + d))}
            onBackspace={() => setField(k, formatCnic(fields[k].replace(/\D/g, "").slice(0, -1)))}
            onClear={() => setField(k, "")}
          />
        )}
        <VoiceInput field={k} onConfirm={(v) => setField(k, q.kind === "cnic" ? formatCnic(v.replace(/\D/g, "")) : v)} />
      </div>
    );
  };

  const choiceButtons = (k: ChoiceKey, options: readonly (readonly [string | boolean, string, string])[], cols = 2) => (
    <div className="card p-4" key={k}>
      {fieldLabel(Q_CHOICE[k])}
      <div className={`mt-3 grid gap-3 ${cols === 2 ? "grid-cols-2" : ""}`} role="radiogroup" aria-label={Q_CHOICE[k].en}>
        {options.map(([v, en, ur]) => {
          const on = choices[k] === v;
          const slug = typeof v === "boolean" ? (v ? "yes" : "no") : v;
          return (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`choice-${k}-${slug}`}
              onClick={() => setChoices((c) => ({ ...c, [k]: v }))}
              className={`btn text-xl ${on ? "btn-primary" : "btn-secondary"}`}
            >
              {typeof v === "boolean" && <Icon name={v ? "check" : "x"} size={22} />} {lang === "ur" ? ur : en}
            </button>
          );
        })}
      </div>
    </div>
  );
  const YES_NO = [[true, "Yes", "ہاں"], [false, "No", "نہیں"]] as const;
  const PROVINCE_OPTS = PROVINCES.map(([en, ur]) => [en, en, ur] as const);

  const nav = (i: number) =>
    showAll ? null : (
      <div className="mt-5 grid grid-cols-2 gap-3">
        {i > 0 ? (
          <button type="button" onClick={() => go(i - 1)} className="btn btn-secondary">
            <Icon name="back" size={22} className="rtl:rotate-180" /> {L("Previous", "پچھلا")}
          </button>
        ) : <span />}
        {i < 3 && (
          <button type="button" onClick={() => go(i + 1)} className="btn btn-primary">
            {L("Next", "آگے")} <Icon name="forward" size={22} className="rtl:rotate-180" />
          </button>
        )}
      </div>
    );

  const step1 = (
    <section id="apply-step-0" key="s0" className="scroll-mt-36">
      {stepHeader(0)}
      {isHelper ? (
        <p className="panel-safe mb-4 rounded-2xl p-4 text-lg">
          <Icon name="users" size={22} className="me-2 inline align-middle" />
          {L("The family allowed you to help them with their PIN. You are filling this form on their behalf.", "خاندان نے اپنے پن سے آپ کو مدد کی اجازت دی ہے۔ آپ یہ فارم ان کی طرف سے بھر رہے ہیں۔")}
        </p>
      ) : (
        <div className="card mb-4 p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-xl font-bold">{L("Who can see your information?", "آپ کی معلومات کون دیکھ سکتا ہے؟")}</h3>
              <p className="text-lg text-slate">
                {L("We only ask for what is needed to check if you are eligible. Everything is OFF until you turn it on, and you can turn it off any time.",
                  "ہم صرف وہی معلومات مانگتے ہیں جو اہلیت جانچنے کے لیے ضروری ہیں۔ جب تک آپ آن نہ کریں سب بند ہے، اور آپ کسی بھی وقت بند کر سکتی ہیں۔")}
              </p>
            </div>
            <SpeakButton audioKey="consent_ask" size="lg" />
          </div>
          <div className="mt-3"><ConsentPanel value={consent} onChange={(s, on) => setConsent({ ...consent, [s]: on })} /></div>
        </div>
      )}
      <div className="space-y-4">
        {textField("full_name")}
        {textField("father_name")}
        {textField("age")}
        {choiceButtons("province", PROVINCE_OPTS)}
        {choiceButtons("is_widow", YES_NO)}
      </div>
      {nav(0)}
    </section>
  );

  const step2 = (
    <section id="apply-step-1" key="s1" className="scroll-mt-36">
      {stepHeader(1)}
      <div className="space-y-4">
        {textField("cnic")}
        {textField("monthly_income")}
        {textField("dependents")}
        {choiceButtons("receives_other_grant", YES_NO)}
      </div>
      {nav(1)}
    </section>
  );

  const step3 = (
    <section id="apply-step-2" key="s2" className="scroll-mt-36">
      {stepHeader(2)}
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-xl font-bold">{L("Take a photo of your CNIC", "اپنے شناختی کارڈ کی تصویر لیں")}</h3>
          <SpeakButton text="شناختی کارڈ کو سادہ سطح پر رکھیں اور روشنی میں تصویر لیں" textEn="Place the card on a plain surface and take the photo in good light" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center text-lg font-bold">
          <div className="panel-safe rounded-xl p-2">
            <div className="mx-auto mb-1 h-14 w-20 rounded-md border-2 border-brand bg-card" aria-hidden />
            <Icon name="check" size={18} className="inline" /> {L("Flat, sharp, bright", "سیدھی، صاف، روشن")}
          </div>
          <div className="panel-danger rounded-xl p-2">
            <div className="mx-auto mb-1 h-14 w-20 rounded-md bg-[#c9cfcb] blur-[2px]" aria-hidden />
            <Icon name="x" size={18} className="inline" /> {L("Blurry or glare", "دھندلی یا چمک")}
          </div>
        </div>
        <label className="mt-4 flex min-h-[72px] w-full cursor-pointer items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand bg-tint px-4 py-4 text-xl font-bold text-brand focus-within:ring-4 focus-within:ring-gold">
          <Icon name="camera" size={28} /> {photo ? L("Retake photo", "دوبارہ تصویر لیں") : L("Open camera or choose photo", "کیمرہ کھولیں یا تصویر چنیں")}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && void checkPhoto(e.target.files[0])} />
        </label>
        {preview && <ResilientImage src={preview} alt={L("Your CNIC photo", "آپ کے شناختی کارڈ کی تصویر")} className="mt-4" />}
        {shrink && (
          <p data-testid="shrink-info" className="mt-3 text-lg text-slate">
            <Icon name="layers" size={18} className="me-1 inline align-middle" />
            {shrink.resized ? (
              <>{L("Compressed on your phone to save data", "ڈیٹا بچانے کے لیے فون پر ہی چھوٹی کی گئی")}: <span dir="ltr" className="inline-block font-bold">{shrink.from} → {shrink.to}</span></>
            ) : (
              <>{L("Already small — sent as it is", "پہلے ہی چھوٹی ہے — ویسے ہی بھیجی گئی")}: <span dir="ltr" className="inline-block font-bold">{shrink.to}</span></>
            )}
          </p>
        )}
        {checking && (
          <p className="panel-neutral mt-3 animate-pulse rounded-xl p-3 text-lg font-bold" role="status">
            {L("Checking your photo…", "آپ کی تصویر جانچی جا رہی ہے…")}
          </p>
        )}
        {vision && !vision.ok_to_submit && (
          <div className="panel-review mt-4 rounded-2xl p-4" role="alert">
            <p className="text-xl font-bold">{L("Please retake the photo", "براہ کرم دوبارہ تصویر لیں")}</p>
            {vision.retake_tips.map((t) => <p key={t.flag} className="mt-1 text-lg">• {lang === "ur" ? t.ur : t.en}</p>)}
            {!vision.retake_tips.length && <p className="mt-1" dir="ltr">{vision.flags.join(", ")}</p>}
          </div>
        )}
        {vision?.ok_to_submit && (
          <p className="panel-safe mt-4 rounded-xl p-3 text-xl font-bold"><Icon name="checkCircle" size={22} className="me-1 inline align-middle" /> {L("Photo looks clear", "تصویر صاف ہے")}</p>
        )}
        <p className="mt-3 text-lg text-slate">{L("No photo right now? You can still submit — an officer may ask for it later.", "ابھی تصویر نہیں؟ آپ پھر بھی جمع کر سکتی ہیں — افسر بعد میں مانگ سکتا ہے۔")}</p>
      </div>
      {nav(2)}
    </section>
  );

  const data = buildData();
  const row = (q: Prompt, value: React.ReactNode, s: number, k: string) => (
    <div key={k} className="flex items-start gap-3 border-t border-line py-3 first:border-t-0">
      <dt className="min-w-0 flex-1 text-lg text-slate">{lang === "ur" ? q.ur : q.en}</dt>
      <dd className="text-lg font-bold">{value === undefined || value === "" ? <span className="text-danger-ink">{L("Missing", "باقی")}</span> : value}</dd>
      <button type="button" onClick={() => go(s)} className="min-h-[44px] rounded-lg px-2 text-base font-bold text-brand underline">{L("Edit", "بدلیں")}</button>
    </div>
  );
  const yn = (v: boolean | undefined) => (v === undefined ? undefined : v ? L("Yes", "ہاں") : L("No", "نہیں"));
  const step4 = (
    <section id="apply-step-3" key="s3" className="scroll-mt-36">
      {stepHeader(3)}
      <div className="card p-4">
        <h3 className="text-xl font-bold">{L("Please check your answers", "براہ کرم اپنے جوابات دیکھ لیں")}</h3>
        <dl className="mt-2">
          {row(Q_TEXT.full_name, data.full_name as string, 0, "n")}
          {row(Q_TEXT.father_name, data.father_name as string, 0, "f")}
          {row(Q_TEXT.age, data.age !== undefined ? <span dir="ltr">{String(data.age)}</span> : undefined, 0, "a")}
          {row(Q_CHOICE.province, choices.province ? (lang === "ur" ? PROVINCES.find((p) => p[0] === choices.province)?.[1] : choices.province) : undefined, 0, "p")}
          {row(Q_CHOICE.is_widow, yn(choices.is_widow), 0, "w")}
          {row(Q_TEXT.cnic, cnicDigits.length ? <span dir="ltr" className="font-mono">{formatCnic(cnicDigits)}</span> : undefined, 1, "c")}
          {row(Q_TEXT.monthly_income, typeof data.monthly_income === "number" ? <span dir="ltr">Rs {data.monthly_income.toLocaleString()}</span> : (data.monthly_income as string), 1, "i")}
          {row(Q_TEXT.dependents, data.dependents !== undefined ? <span dir="ltr">{String(data.dependents)}</span> : undefined, 1, "d")}
          {row(Q_CHOICE.receives_other_grant, yn(choices.receives_other_grant), 1, "g")}
          {row({ en: "CNIC photo", ur: "شناختی کارڈ کی تصویر" }, photo ? (vision?.ok_to_submit ? L("Clear", "صاف") : L("Added", "شامل")) : L("Not added (optional)", "شامل نہیں (اختیاری)"), 2, "ph")}
          {!isHelper && row({ en: "Permissions given", ur: "دی گئی اجازتیں" }, <span dir="ltr">{Object.values(consent).filter(Boolean).length} / 4</span>, 0, "cs")}
        </dl>
      </div>
      <div className="panel-safe mt-4 rounded-2xl p-4">
        <h3 className="text-lg font-bold">{L("What happens next?", "آگے کیا ہوگا؟")}</h3>
        <p className="text-lg">
          {L("You get a QR Parchi with an Application ID and PIN right away. The system checks your details; anything unclear goes to a human officer — the AI never rejects anyone.",
            "آپ کو فوراً درخواست آئی ڈی اور پن والی QR پرچی ملے گی۔ نظام آپ کی معلومات جانچے گا؛ کوئی بات واضح نہ ہو تو افسر خود دیکھے گا — اے آئی کبھی کسی کو مسترد نہیں کرتا۔")}
        </p>
      </div>
      {triedSubmit && missing.length > 0 && (
        <div className="panel-review mt-4 rounded-2xl p-4" role="alert">
          <p className="text-lg font-bold">{L("Please answer these first:", "پہلے یہ جواب دیں:")}</p>
          <ul className="mt-1 space-y-1">
            {missing.map((m) => (
              <li key={m.q.en}>
                <button type="button" onClick={() => go(m.step)} className="min-h-[44px] text-start text-lg underline">• {lang === "ur" ? m.q.ur : m.q.en}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="panel-danger mt-3 rounded-xl p-3 text-lg font-bold" role="alert">{error}</p>}
      <button type="button" disabled={busy || checking} onClick={() => void submit()} className="btn btn-primary mt-5 w-full text-xl">
        {busy ? "…" : L("Submit application", "درخواست جمع کریں")}
      </button>
      {nav(3)}
    </section>
  );

  const sections = [step1, step2, step3, step4];

  return (
    <div ref={topRef} className="scroll-mt-36">
      <div className="mb-3 flex items-center gap-2">
        <button type="button" onClick={onCancel} className="btn btn-secondary min-h-[48px] px-3 text-base">
          <Icon name="x" size={20} /> {L("Cancel", "منسوخ")}
        </button>
        <span className="min-w-0 flex-1 truncate text-lg font-bold text-brand">{lang === "ur" ? scheme.name_ur : scheme.name_en}</span>
      </div>

      {/* Clickable step tabs (never blocked) + Show-All toggle */}
      <nav aria-label={L("Application steps", "درخواست کے مراحل")} className="mb-3 grid grid-cols-4 gap-1.5">
        {STEPS.map((s, i) => {
          const current = !showAll && step === i;
          return (
            <button
              key={s.en}
              type="button"
              data-testid={`step-tab-${i + 1}`}
              aria-current={current ? "step" : undefined}
              onClick={() => go(i)}
              className={`flex min-h-[56px] flex-col items-center justify-center rounded-xl border-2 px-1 text-center font-bold ${current ? "border-brand bg-brand text-white" : "border-line bg-card text-brand hover:bg-tint"}`}
            >
              <span dir="ltr" className="inline-block text-lg leading-none">{i + 1}</span>
              <span className="text-[15px] leading-tight sm:text-base">{lang === "ur" ? s.short_ur : s.short_en}</span>
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        data-testid="show-all-toggle"
        aria-pressed={showAll}
        onClick={() => setShowAll((v) => !v)}
        className={`mb-5 inline-flex min-h-[48px] items-center gap-2 rounded-xl border-2 px-3 text-base font-bold ${showAll ? "border-brand bg-tint text-brand" : "border-line bg-card text-slate"}`}
      >
        <Icon name="layers" size={20} /> {showAll ? L("Show one step at a time", "ایک وقت میں ایک مرحلہ") : L("Show All Fields", "تمام خانے ایک ساتھ دیکھیں")}
      </button>

      {showAll ? <div className="space-y-10">{sections}</div> : sections[step]}
    </div>
  );
}
