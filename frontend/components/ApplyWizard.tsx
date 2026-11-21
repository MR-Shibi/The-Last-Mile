"use client";

import { useRef, useState } from "react";
import { api, ApiError, type Receipt, type Scheme } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { formatBytes, shrinkForUpload } from "@/lib/image";
import { enqueue, newClientEventId, saveDraft } from "@/lib/offlineDb";
import ConsentPanel from "@/components/ConsentPanel";
import Parchi from "@/components/Parchi";
import SpeakButton, { speak } from "@/components/SpeakButton";
import VoiceInput from "@/components/VoiceInput";
import { notifyOutboxChanged } from "@/components/AppHeader";

type Q = { key: string; en: string; ur: string; kind: "text" | "number" | "cnic" | "yesno" | "province"; voice?: boolean };

const QUESTIONS: Q[] = [
  { key: "full_name", en: "What is your full name?", ur: "آپ کا پورا نام کیا ہے؟", kind: "text", voice: true },
  { key: "father_name", en: "What is your father's (or husband's) name?", ur: "آپ کے والد (یا شوہر) کا نام کیا ہے؟", kind: "text", voice: true },
  { key: "cnic", en: "What is your CNIC number? (13 digits)", ur: "آپ کا شناختی کارڈ نمبر کیا ہے؟ (13 ہندسے)", kind: "cnic", voice: true },
  { key: "age", en: "How old are you?", ur: "آپ کی عمر کتنی ہے؟", kind: "number", voice: true },
  { key: "province", en: "Which province do you live in?", ur: "آپ کس صوبے میں رہتی ہیں؟", kind: "province" },
  { key: "is_widow", en: "Are you a widow?", ur: "کیا آپ بیوہ ہیں؟", kind: "yesno" },
  { key: "monthly_income", en: "What is your household's monthly income in rupees?", ur: "آپ کے گھر کی ماہانہ آمدنی کتنے روپے ہے؟", kind: "number", voice: true },
  { key: "dependents", en: "How many children or dependents live with you?", ur: "آپ کے ساتھ کتنے بچے یا زیرِ کفالت افراد رہتے ہیں؟", kind: "number", voice: true },
  { key: "receives_other_grant", en: "Do you already get another cash grant?", ur: "کیا آپ کو پہلے سے کوئی اور نقد امداد ملتی ہے؟", kind: "yesno" },
];

interface VisionResult { flags: string[]; ok_to_submit: boolean; retake_tips: { flag: string; en: string; ur: string }[] }

export default function ApplyWizard({ scheme, citizenUserId, onCancel }: { scheme: Scheme; citizenUserId?: number; onCancel: () => void }) {
  const { lang, L } = useLang();
  const isHelper = citizenUserId !== undefined;
  const [step, setStep] = useState(isHelper ? 1 : 0); // 0 consent, 1..N questions, N+1 photo, N+2 done
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [data, setData] = useState<Record<string, string | number | boolean>>({});
  const [draft, setDraftVal] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [vision, setVision] = useState<VisionResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [shrinkInfo, setShrinkInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const eventId = useRef(newClientEventId());
  const N = QUESTIONS.length;

  async function saveConsents() {
    const chosen = Object.entries(consent).filter(([, on]) => on).map(([s]) => s);
    for (const scope of chosen) {
      if (navigator.onLine) {
        try {
          await api("/consents", { body: { scope } });
        } catch {
          await enqueue("consent_grant", { scope });
        }
      } else await enqueue("consent_grant", { scope });
    }
    notifyOutboxChanged();
    setStep(1);
  }

  function answer(value: string | number | boolean) {
    const q = QUESTIONS[step - 1];
    const next = { ...data, [q.key]: q.kind === "number" ? Number(value) : value };
    setData(next);
    setDraftVal("");
    setStep(step + 1);
    void saveDraft(`application:${citizenUserId ?? "self"}`, next).catch(() => undefined);
  }

  async function checkPhoto(original: File) {
    setVision(null);
    setChecking(true);
    try {
      // Shrink on the phone first (<=1024px JPEG): fast on 2G and light on the free-tier server.
      const s = await shrinkForUpload(original);
      setPhoto(s.file);
      setShrinkInfo(s.resized ? `${formatBytes(s.originalBytes)} → ${formatBytes(s.finalBytes)}` : null);
      if (!navigator.onLine) return;
      const form = new FormData();
      form.append("file", s.file);
      const qs = data.cnic ? `?cnic=${encodeURIComponent(String(data.cnic))}` : "";
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
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { scheme_id: scheme.id, data };
    if (isHelper) payload.citizen_user_id = citizenUserId;
    try {
      if (!navigator.onLine) throw new TypeError("offline");
      const c = await api<{ id: number }>("/cases", { body: { ...payload, client_event_id: eventId.current } });
      if (photo) {
        const form = new FormData();
        form.append("file", photo);
        await api(`/cases/${c.id}/documents`, { form });
      }
      setReceipt(await api<Receipt>(`/cases/${c.id}/receipt`));
      setStep(N + 2);
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
        setStep(N + 2);
      }
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div className="mb-4 flex items-center justify-between">
      <button onClick={onCancel} className="rounded-lg border-2 border-black px-3 py-1">✕ {L("Cancel", "منسوخ")}</button>
      <span className="text-lg font-bold">{lang === "ur" ? scheme.name_ur : scheme.name_en}</span>
      <span className="text-sm" dir="ltr">{Math.min(step, N + 1)}/{N + 1}</span>
    </div>
  );

  if (step === 0) {
    return (
      <section>
        {header}
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">{L("Who can see your information?", "آپ کی معلومات کون دیکھ سکتا ہے؟")}</h2>
          <SpeakButton audioKey="consent_ask" size="lg" />
        </div>
        <p className="my-3 text-lg">{L("Everything is OFF until you turn it on. You can turn it off any time.", "جب تک آپ آن نہ کریں سب بند ہے۔ آپ کسی بھی وقت بند کر سکتی ہیں۔")}</p>
        <ConsentPanel value={consent} onChange={(s, on) => setConsent({ ...consent, [s]: on })} />
        <button onClick={() => void saveConsents()} className="mt-5 w-full rounded-2xl bg-brand py-5 text-2xl font-bold text-white">
          {L("Next", "آگے")} →
        </button>
      </section>
    );
  }

  if (step >= 1 && step <= N) {
    const q = QUESTIONS[step - 1];
    return (
      <section>
        {header}
        <div className="flex items-start gap-3">
          <h2 className="flex-1 text-3xl font-bold leading-relaxed">{lang === "ur" ? q.ur : q.en}</h2>
          <SpeakButton text={q.ur} textEn={q.en} size="lg" />
        </div>
        {q.kind === "yesno" && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            <button onClick={() => answer(true)} className="rounded-2xl bg-ok py-8 text-3xl font-bold text-white">✔ {L("Yes", "ہاں")}</button>
            <button onClick={() => answer(false)} className="rounded-2xl bg-gray-700 py-8 text-3xl font-bold text-white">✖ {L("No", "نہیں")}</button>
          </div>
        )}
        {q.kind === "province" && (
          <div className="mt-6 grid grid-cols-2 gap-4">
            {[["Sindh", "سندھ"], ["Punjab", "پنجاب"], ["KP", "خیبر پختونخوا"], ["Balochistan", "بلوچستان"]].map(([en, ur]) => (
              <button key={en} onClick={() => answer(en)} className="rounded-2xl border-4 border-black bg-white py-6 text-2xl font-bold">{lang === "ur" ? ur : en}</button>
            ))}
          </div>
        )}
        {(q.kind === "text" || q.kind === "number" || q.kind === "cnic") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) answer(draft.trim());
            }}
          >
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraftVal(e.target.value)}
              inputMode={q.kind === "text" ? "text" : "numeric"}
              dir={q.kind === "text" ? undefined : "ltr"}
              placeholder={q.kind === "cnic" ? "42101-1234567-1" : ""}
              className="mt-6 w-full rounded-2xl border-4 border-black p-4 text-2xl"
            />
            <button type="submit" disabled={!draft.trim()} className="mt-4 w-full rounded-2xl bg-brand py-5 text-2xl font-bold text-white disabled:opacity-40">
              {L("Next", "آگے")} →
            </button>
          </form>
        )}
        {q.voice && <VoiceInput key={q.key} field={q.key} onConfirm={(v) => answer(v)} />}
        {step > 1 && <button onClick={() => setStep(step - 1)} className="mt-4 underline">← {L("Back", "پیچھے")}</button>}
      </section>
    );
  }

  if (step === N + 1) {
    return (
      <section>
        {header}
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-bold">{L("Take a photo of your CNIC", "اپنے شناختی کارڈ کی تصویر لیں")}</h2>
          <SpeakButton text="شناختی کارڈ کو سادہ سطح پر رکھیں اور روشنی میں تصویر لیں" textEn="Place the card on a plain surface and take the photo in good light" size="lg" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-center text-sm font-bold">
          <div className="rounded-xl border-4 border-ok p-2"><div className="mx-auto h-16 w-24 rounded bg-green-100 border-2 border-green-700" />✔ {L("Flat, sharp, bright", "سیدھی، صاف، روشن")}</div>
          <div className="rounded-xl border-4 border-danger p-2"><div className="mx-auto h-16 w-24 rounded bg-gray-300 blur-[2px]" />✖ {L("Blurry or glare", "دھندلی یا چمک")}</div>
        </div>
        <label className="mt-5 block w-full cursor-pointer rounded-2xl border-4 border-dashed border-black bg-yellow-50 py-8 text-center text-2xl font-bold">
          📷 {photo ? L("Retake photo", "دوبارہ تصویر لیں") : L("Open camera", "کیمرہ کھولیں")}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.target.files?.[0] && void checkPhoto(e.target.files[0])} />
        </label>
        {vision && !vision.ok_to_submit && (
          <div className="mt-4 rounded-2xl border-4 border-warn bg-orange-50 p-4" role="alert">
            <p className="text-xl font-bold">{L("Please retake the photo", "براہ کرم دوبارہ تصویر لیں")}</p>
            {vision.retake_tips.map((t) => <p key={t.flag} className="mt-1 text-lg">• {lang === "ur" ? t.ur : t.en}</p>)}
            {!vision.retake_tips.length && <p className="mt-1">{vision.flags.join(", ")}</p>}
          </div>
        )}
        {shrinkInfo && (
          <p data-testid="shrink-info" className="mt-3 text-base text-gray-700">
            📉 {L("Photo compressed on your phone", "تصویر فون پر ہی چھوٹی کر دی گئی")}: <span dir="ltr">{shrinkInfo}</span>
          </p>
        )}
        {checking && (
          <p className="mt-3 animate-pulse rounded-xl bg-blue-50 p-3 text-lg font-bold" role="status">
            ⏳ {L("Checking your photo…", "آپ کی تصویر جانچی جا رہی ہے…")}
          </p>
        )}
        {vision?.ok_to_submit && <p className="mt-4 rounded-xl bg-green-100 p-3 text-xl font-bold text-green-900">✔ {L("Photo looks clear", "تصویر صاف ہے")}</p>}
        {error && <p className="mt-3 font-bold text-danger" role="alert">{error}</p>}
        <button disabled={busy || checking} onClick={() => void submit()} className="mt-5 w-full rounded-2xl bg-brand py-5 text-2xl font-bold text-white disabled:opacity-50">
          {busy ? "…" : L("Submit application", "درخواست جمع کریں")}
        </button>
        <button onClick={() => setStep(N)} className="mt-4 underline">← {L("Back", "پیچھے")}</button>
      </section>
    );
  }

  return (
    <section>
      {receipt ? (
        <Parchi r={receipt} />
      ) : (
        <div className="rounded-3xl border-[6px] border-warn bg-yellow-50 p-6 text-center" role="status">
          <p className="text-5xl">📶</p>
          <h2 className="mt-2 text-2xl font-bold">{L("Saved on this phone", "اس فون میں محفوظ ہو گئی")}</h2>
          <p className="mt-2 text-lg">{L("No internet right now. Your application will be sent automatically when the connection returns — it will never be sent twice.", "ابھی انٹرنیٹ نہیں ہے۔ کنکشن واپس آتے ہی درخواست خود بخود بھیج دی جائے گی — دو بار نہیں جائے گی۔")}</p>
          <p className="mt-3 font-mono text-xs" dir="ltr">{queued}</p>
        </div>
      )}
      <button onClick={onCancel} className="mt-5 w-full rounded-2xl border-4 border-black py-4 text-xl font-bold">{L("Done", "ختم")}</button>
    </section>
  );
}
