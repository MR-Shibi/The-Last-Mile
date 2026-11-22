/**
 * Real-browser E2E suite (headless Chromium) for The Last Mile PWA.
 * PROTOTYPE — Simulated DPI & Synthetic Data Only.
 *
 * Every test is wrapped by a watcher that fails on: uncaught page errors, console.error output, and any
 * API response >= 400 that the test did not explicitly expect.
 */
import { test, expect, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const API = process.env.E2E_API_URL || "http://127.0.0.1:8000";
const PW = "Demo@1234";
const FIX = path.join(__dirname, "fixtures");
const applicant = JSON.parse(fs.readFileSync(path.join(FIX, "applicant.json"), "utf-8")) as {
  full_name: string; father_name_variant: string; cnic: string; age: number;
};
const familyPin = (n: number) => String(1000 + n * 7).padStart(4, "0").slice(-4);

// ------------------------------------------------------------------ helpers
type Allow = (url: string, status: number) => boolean;

function watch(page: Page, allow: Allow = () => false) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Network failures are judged by the response listener below (with per-test allowances).
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console.error: ${m.text()}`);
  });
  page.on("response", (r) => {
    const url = r.url();
    if (url.startsWith(API) && r.status() >= 400 && !allow(url, r.status())) problems.push(`HTTP ${r.status()} ${r.request().method()} ${url}`);
  });
  return {
    problems,
    assertClean: () => expect(problems, problems.join("\n")).toEqual([]),
  };
}

async function english(page: Page) {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("lm.lang")) window.localStorage.setItem("lm.lang", "en");
  });
}

async function uiLogin(page: Page, username: string, next = "") {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByPlaceholder("username").fill(username);
  await page.getByPlaceholder("password").fill(PW);
  await page.getByRole("button", { name: /^(Login|لاگ ان)$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await dismissDecisions(page);
}

/** Citizens see a pop-up for each officer decision they have not acknowledged yet; acknowledge them all. */
async function dismissDecisions(page: Page) {
  const ok = page.getByTestId("decision-ok");
  for (let i = 0; i < 10; i++) {
    try {
      await ok.waitFor({ state: "visible", timeout: i === 0 ? 2500 : 1200 });
    } catch {
      return;
    }
    await ok.click();
  }
}

async function apiToken(request: APIRequestContext, username: string): Promise<string> {
  const r = await request.post(`${API}/auth/login`, { data: { username, password: PW } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).access_token as string;
}

async function apiJson<T>(request: APIRequestContext, method: "GET" | "POST" | "DELETE", url: string, token: string, data?: unknown): Promise<T> {
  const r = await request.fetch(`${API}${url}`, { method, data, headers: { Authorization: `Bearer ${token}` } });
  expect(r.status(), `${method} ${url}`).toBeLessThan(400);
  return (await r.json()) as T;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, tol = 1) {
  return a.x + tol < b.x + b.width && b.x + tol < a.x + a.width && a.y + tol < b.y + b.height && b.y + tol < a.y + a.height;
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b, "element must be visible with a layout box").not.toBeNull();
  return b!;
}

async function assertCardsDoNotOverlap(page: Page) {
  const cards = page.getByTestId("home-card");
  await expect(cards).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const card = cards.nth(i);
    const link = await box(card.locator("a"));
    const title = await box(card.getByTestId("card-title"));
    const sub = await box(card.getByTestId("card-subtitle"));
    const spk = await box(card.getByTestId("speak-button"));
    expect(overlaps(title, sub), `card ${i}: title overlaps subtitle`).toBe(false);
    expect(overlaps(title, spk), `card ${i}: title overlaps speaker`).toBe(false);
    expect(overlaps(sub, spk), `card ${i}: subtitle overlaps speaker`).toBe(false);
    for (const [name, b] of [["title", title], ["subtitle", sub]] as const) {
      expect(b.y >= link.y - 1 && b.y + b.height <= link.y + link.height + 1, `card ${i}: ${name} overflows card vertically`).toBe(true);
      expect(b.x >= link.x - 1 && b.x + b.width <= link.x + link.width + 1, `card ${i}: ${name} overflows card horizontally`).toBe(true);
    }
  }
}

async function nextQ(page: Page) {
  await page.getByRole("button", { name: /Next/ }).click();
}

/** 4-step form: Step 1 (consent + name/details) -> Step 2 (CNIC via keypad + income) -> Step 3 photo.
 * `showAll` exercises the "Show All Fields" mode (every step on one page, no step navigation). */
async function fillApplication(
  page: Page,
  a: { full_name: string; father: string; cnic: string; age: number; income: number | string },
  opts: { grant?: boolean; showAll?: boolean } = {},
) {
  const { grant = true, showAll = false } = opts;
  if (showAll) {
    await page.getByTestId("show-all-toggle").click();
    await expect(page.getByTestId("show-all-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /Next/ })).toHaveCount(0); // no step blocking
  } else {
    await expect(page.getByTestId("step-tab-1")).toHaveAttribute("aria-current", "step");
  }
  if (grant) {
    await expect(page.getByRole("heading", { name: "Who can see your information?" })).toBeVisible();
    for (const label of ["Officer may see my name and CNIC", "Officer may see my income", "Officer may see my CNIC photo"]) {
      const sw = page.getByRole("switch", { name: label });
      await expect(sw).toHaveAttribute("aria-checked", "false"); // OFF by default
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true");
    }
  }
  await page.getByTestId("field-full_name").fill(a.full_name);
  await page.getByTestId("field-father_name").fill(a.father);
  await page.getByTestId("field-age").fill(String(a.age));
  await page.getByTestId("choice-province-Sindh").click();
  await page.getByTestId("choice-is_widow-yes").click();
  if (!showAll) {
    await nextQ(page);
    await expect(page.getByTestId("step-tab-2")).toHaveAttribute("aria-current", "step");
  }
  // CNIC via the large on-screen keypad (noisy-room backup): digits auto-format as XXXXX-XXXXXXX-X
  const cnicInput = page.getByTestId("field-cnic");
  await page.getByTestId("keypad-clear").click();
  const cnicDigits = a.cnic.replace(/\D/g, "");
  for (const d of cnicDigits.slice(0, 12)) await page.getByTestId(`keypad-${d}`).click();
  await page.getByTestId("keypad-9").click();    // a slip of the finger...
  await page.getByTestId("keypad-back").click(); // ...corrected with backspace
  await page.getByTestId(`keypad-${cnicDigits[12]}`).click();
  await expect(cnicInput).toHaveValue(a.cnic);
  await page.getByTestId("field-monthly_income").fill(String(a.income));
  await page.getByTestId("field-dependents").fill("2");
  await page.getByTestId("choice-receives_other_grant-no").click();
  if (!showAll) await nextQ(page);
  await expect(page.getByRole("heading", { name: "Take a photo of your CNIC" })).toBeVisible();
}

/** Step 3 -> Step 4 (review) and submit. */
async function reviewAndSubmit(page: Page, cnic: string) {
  await nextQ(page);
  await expect(page.getByRole("heading", { name: "Review & Submit" })).toBeVisible();
  await expect(page.getByText(cnic, { exact: true })).toBeVisible(); // read-only summary before submitting
  await page.getByRole("button", { name: "Submit application" }).click();
}

async function openScheme(page: Page, name = "Widow Relief Grant") {
  await page.getByTestId("scheme-open").filter({ hasText: name }).click();
}

// ------------------------------------------------------------------ Test 1
test("1 — zero console/network errors and Urdu RTL layout without overlaps", async ({ page }) => {
  const w = watch(page);
  await english(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await assertCardsDoNotOverlap(page);

  await page.getByRole("button", { name: "اردو" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
  await expect(page.getByTestId("card-title").first()).toHaveText("امداد کے لیے درخواست دیں");
  await assertCardsDoNotOverlap(page);

  // Urdu headings/body really get the taller Nastaliq leading
  const lh = await page.getByTestId("card-title").first().evaluate((el) => {
    const s = getComputedStyle(el);
    return parseFloat(s.lineHeight) / parseFloat(s.fontSize);
  });
  expect(lh).toBeGreaterThanOrEqual(2.1);

  // Mobile width too (phone users are the target)
  await page.setViewportSize({ width: 390, height: 844 });
  await assertCardsDoNotOverlap(page);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl"); // choice persists
  w.assertClean();
});

// ------------------------------------------------------------------ Test 2
test("2 — speaker buttons play audio without navigating", async ({ page }) => {
  const w = watch(page, (url, s) => url.includes("/voice/tts") && s === 503); // TTS may be offline -> browser speech fallback
  const audioHits: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/audio/") || r.url().includes("/voice/tts")) audioHits.push(r.url());
  });
  await english(page);
  await page.goto("/");
  const start = page.url();

  await page.getByTestId("speak-button").first().click(); // header: pre-cached welcome prompt
  const cards = page.getByTestId("home-card");
  for (let i = 0; i < 4; i++) {
    await cards.nth(i).getByTestId("speak-button").click();
    await page.waitForTimeout(250);
    expect(page.url(), `card ${i} speaker must not navigate`).toBe(start);
  }
  await expect.poll(() => audioHits.length).toBeGreaterThan(0);
  expect(audioHits.some((u) => u.includes("/audio/en/welcome.mp3"))).toBe(true);

  // Scheme cards (inside the citizen app)
  await uiLogin(page, "sindh.citizen", "/citizen");
  await expect(page.getByTestId("scheme-card").first()).toBeVisible();
  const citizenUrl = page.url();
  const before = audioHits.length;
  for (const card of await page.getByTestId("scheme-card").all()) {
    await card.getByTestId("speak-button").click();
    await page.waitForTimeout(250);
    expect(page.url()).toBe(citizenUrl);
    await expect(page.getByTestId("scheme-card").first()).toBeVisible(); // wizard did not open
  }
  await expect.poll(() => audioHits.length).toBeGreaterThan(before);
  w.assertClean();
});

// ------------------------------------------------------------------ Test 3
test("3 — citizen application with Muhammed spelling variant, CNIC upload and QR Parchi", async ({ page, request }) => {
  const w = watch(page);
  await english(page);
  await uiLogin(page, "sindh.citizen", "/citizen");
  await openScheme(page);
  await fillApplication(page, { full_name: applicant.full_name, father: applicant.father_name_variant, cnic: applicant.cnic, age: applicant.age, income: 15000 });

  // Blurry photo -> live retake prompt, then a clean photo
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "cnic_blurry.png"));
  await expect(page.getByText("Please retake the photo")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "cnic_clean.png"));
  await expect(page.getByText("Photo looks clear")).toBeVisible();
  await reviewAndSubmit(page, applicant.cnic);

  const parchi = page.getByTestId("parchi");
  await expect(parchi).toBeVisible();
  await expect(page.getByTestId("parchi-pin")).toHaveText(/^\d{6}$/);
  await expect(page.getByTestId("parchi-badge")).toHaveAttribute("data-color", "green"); // spelling variant tolerated
  await expect(parchi.locator('svg[aria-label="Parchi QR"]')).toBeVisible();
  await expect(parchi.getByText(/LM-\d{2}-\d{6}/)).toBeVisible();
  const pb = await box(parchi);
  expect(pb.width).toBeGreaterThan(250);

  // Officer rejects it (with a written reason) -> on Home the citizen sees her account badge + the exact decision
  const ref = (await parchi.getByText(/LM-\d{2}-\d{6}/).first().textContent())!.match(/LM-\d{2}-(\d{6})/)!;
  const caseId = Number(ref[1]);
  const off = await apiToken(request, "sindh.officer");
  await apiJson(request, "POST", `/cases/${caseId}/officer-action`, off, { action: "reject", reason: "Income proof missing" });
  await page.goto("/");
  await expect(page.getByTestId("account-badge")).toContainText("Logged in:");
  const decision = page.getByTestId("decision-modal");
  await expect(decision).toBeVisible();
  await expect(decision).toHaveAttribute("data-status", "OFFICER_REJECTED");
  await expect(page.getByTestId("decision-text")).toHaveText(`Your application (${ref[0]}) was NOT approved. Reason: Income proof missing.`);
  await page.getByTestId("decision-ok").click();
  await dismissDecisions(page); // older decisions from earlier runs, if any
  await expect(decision).toBeHidden();

  // Citizen session: Helper mode is locked on Home, and /helper explains instead of opening a second login
  await expect(page.getByTestId("helper-locked-note")).toBeVisible();
  await page.goto("/helper");
  await expect(page.getByTestId("role-blocked")).toBeVisible();
  await expect(page.getByPlaceholder("username")).toHaveCount(0);

  // Clean logout: confirmation banner, badge gone, Helper card active again
  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("logout-toast")).toBeVisible();
  await expect(page.getByTestId("account-badge")).toHaveCount(0);
  await expect(page.getByTestId("helper-locked-note")).toHaveCount(0);
  w.assertClean();
});

// ------------------------------------------------------------------ Test 4
test("4 — offline outbox queues the application and syncs once without duplicates", async ({ page, context, request }) => {
  const w = watch(page);
  const user = "sindh.family06";
  const name = `Offline Widow ${Date.now()}`;
  await english(page);
  await uiLogin(page, user, "/citizen");
  await openScheme(page);
  await fillApplication(page, { full_name: name, father: "Muhammed Ali", cnic: "42101-1111111-1", age: 40, income: "nau hazar" }, { showAll: true });
  await expect(page.getByText("= Rs 9,000")).toBeVisible(); // colloquial words parsed on-device

  await context.setOffline(true);
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByRole("heading", { name: "Saved on this phone" })).toBeVisible();
  const eventId = (await page.locator("p.font-mono").innerText()).trim();
  expect(eventId.length).toBeGreaterThan(8);
  // 3 consent grants + 1 application, all queued with idempotency keys (consent is recorded at submit time)
  await expect(page.getByTestId("outbox-badge")).toContainText("4");
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();

  await context.setOffline(false); // 'online' event -> automatic /sync
  await expect(page.getByTestId("outbox-badge")).toBeHidden({ timeout: 30_000 });

  const token = await apiToken(request, user);
  const mine = await apiJson<{ data?: { full_name?: string } }[]>(request, "GET", "/cases", token);
  expect(mine.filter((c) => c.data?.full_name === name)).toHaveLength(1);
  // A late replay of the same outbox item (dropped ACK) is recognised as a duplicate
  const replay = await apiJson<{ duplicates: number; results: { status: string }[] }>(request, "POST", "/sync", token, {
    events: [{ client_event_id: eventId, kind: "case_submit", payload: { scheme_id: 1, data: { full_name: name } } }],
  });
  expect(replay.results[0].status).toBe("duplicate");
  const again = await apiJson<{ data?: { full_name?: string } }[]>(request, "GET", "/cases", token);
  expect(again.filter((c) => c.data?.full_name === name)).toHaveLength(1);
  w.assertClean();
});

// ------------------------------------------------------------------ Test 5
test("5 — helper mode switches families with PINs, updates banner and clears inputs", async ({ page, request }) => {
  const w = watch(page);
  const ids: number[] = [];
  const names: string[] = [];
  for (const u of ["sindh.family01", "sindh.family02"]) {
    const me = await apiJson<{ id: number; full_name: string }>(request, "GET", "/auth/me", await apiToken(request, u));
    ids.push(me.id);
    names.push(me.full_name);
  }
  let currentPin = familyPin(1);
  page.on("dialog", (d) => void d.accept(d.message().includes("PIN") ? currentPin : undefined));

  // A citizen gives "my community helper may help me" and applies -> it surfaces in Helper Mode
  const ct = await apiToken(request, "sindh.citizen");
  const linked = await apiJson<{ helper_pin?: string }>(request, "POST", "/consents", ct, { scope: "helper_access" });
  const schemes = await apiJson<{ id: number; code: string }[]>(request, "GET", "/schemes", ct);
  const fresh = await apiJson<{ id: number; tenant_id: number }>(request, "POST", "/cases", ct, {
    scheme_id: schemes.find((x) => x.code === "widow-relief")!.id, data: { full_name: "Helper Linked Applicant", monthly_income: 9000 },
  });
  const freshRef = `LM-${String(fresh.tenant_id).padStart(2, "0")}-${String(fresh.id).padStart(6, "0")}`;

  await english(page);
  await uiLogin(page, "sindh.helper", "/helper");
  const banner = page.getByTestId("family-banner");
  await expect(banner).toContainText("No family open");

  const newBanner = page.getByTestId("helper-new-banner");
  await expect(newBanner).toContainText(`New Citizen Application Linked:`);
  await expect(newBanner).toContainText(freshRef);
  await page.getByTestId("helper-lookup").fill(freshRef);
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByTestId("helper-lookup-result")).toContainText(`Found:`);
  await expect(page.getByTestId("helper-lookup-result")).toContainText(freshRef);
  if (linked.helper_pin) { // first link in this database: the one-time PIN opens the record
    await page.locator("#family-pin").fill(linked.helper_pin);
    await page.getByRole("button", { name: "Open" }).click();
    await expect(banner).toContainText("consent");
    await expect(banner).not.toContainText("no consent");
    await page.getByRole("button", { name: /Switch/ }).click(); // back to the family list
  }
  await page.getByTestId("helper-new-dismiss").click();
  await expect(newBanner).toBeHidden();

  async function openFamily(i: number) {
    currentPin = familyPin(i + 1);
    await page.getByTestId(`family-${ids[i]}`).click();
    await page.locator('input[type="password"]').fill(currentPin);
    await page.getByRole("button", { name: "Open" }).click();
    await expect(banner).toContainText(names[i]);
    const grant = page.getByRole("button", { name: /Family gives permission/ });
    if (await grant.isVisible().catch(() => false)) await grant.click();
    await expect(banner).toContainText("consent");
    await expect(banner).not.toContainText("no consent");
    await page.getByRole("button", { name: "Widow Relief Grant" }).click();
    await expect(page.getByTestId("field-full_name")).toBeVisible();
  }

  await openFamily(0);
  await page.getByTestId("field-full_name").fill("Typed for family one");
  await page.getByRole("button", { name: /Switch/ }).click();
  await openFamily(1);
  await expect(banner).not.toContainText(names[0]);
  await expect(page.getByTestId("field-full_name")).toHaveValue(""); // previous family's input is gone
  w.assertClean();
});

// ------------------------------------------------------------------ Test 6
test("6 — Scam Shield flags the sample scam SMS with a policy citation", async ({ page }) => {
  const w = watch(page);
  await english(page);
  await page.goto("/scam");
  await page.getByRole("button", { name: /Sample Scam SMS/ }).click();
  const verdict = page.getByTestId("scam-verdict");
  await expect(verdict).toHaveAttribute("data-verdict", "SCAM");
  await expect(verdict).toContainText("do not send any fee or money");
  await expect(verdict).toHaveAttribute("data-color", "red");
  await expect(page.getByText("No Fee Is Ever Charged").first()).toBeVisible();

  await page.getByRole("button", { name: /Sample Official SMS/ }).click();
  await expect(verdict).toHaveAttribute("data-verdict", "OFFICIAL_STYLE_NOTICE");
  await expect(verdict).toContainText("8171");

  // Casual text is never presented as a government message
  await page.locator("textarea").fill("بھائی کل دکان پر آ جانا");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(verdict).toHaveAttribute("data-verdict", "NOT_A_GOV_MESSAGE");
  await expect(page.getByText(/100%/)).toHaveCount(0);

  // A clean Prime Minister Scheme payout notice (no fee/PIN/number/link) is never a SCAM
  await page.locator("textarea").fill("السلام علیکم اپ کے نمبر ڈیش پر 2000 روپے پرائم منسٹر سکیم سے ریسیو ہو گئے ہیں، اپ اس کو ریسیو کرنے کے لیے کسی بھی نزدیک کمیونیکیشن سٹور سے ریسیو کر سکتے ہیں یا ان لائن پیمنٹ فارم یا ان لائن پلیٹ فارم پر جا کر اپ ان لائن پیمنٹ بھی ریسیو کر سکتے ہیں");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(verdict).toHaveAttribute("data-verdict", "UNCERTAIN_HUMAN_REVIEW");

  // Urdu-script advance-fee lure is a SCAM, not "not sure"
  await page.locator("textarea").fill("آپ کو 10 ہزار روپے ملے ہیں آپ ان 10 ہزار روپے میں سے ہمیں 200 روپے بھیج دیں تاکہ ہم آپ کو یہ 10 ہزار بھیج سکیں");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(verdict).toHaveAttribute("data-verdict", "SCAM");
  await expect(page.getByText("No Fee Is Ever Charged").first()).toBeVisible();

  await page.locator("textarea").fill("Mubarak ho! 25000 BISP relief ke liye abhi 500 fee bhejen");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(verdict).toHaveAttribute("data-verdict", "SCAM");
  w.assertClean();
});

// ------------------------------------------------------------------ Test 7
async function newEnglishPage(browser: Browser) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await english(p);
  return { ctx, p };
}

test("7 — officer queue, consent take-back, admin Digital Twin + faults, auditor chain + eval", async ({ page, browser, request }) => {
  const w = watch(page, (url, s) => s === 403 && url.includes("/officer/cases/")); // expected after consent take-back
  // A citizen case the officer is allowed to see (consent granted via API)
  const ct = await apiToken(request, "sindh.family03");
  const schemes = await apiJson<{ id: number; code: string }[]>(request, "GET", "/schemes", ct);
  const widow = schemes.find((s) => s.code === "widow-relief")!;
  const c = await apiJson<{ id: number }>(request, "POST", "/cases", ct, { scheme_id: widow.id, data: { full_name: "Consent Takeback", monthly_income: 9000 } });
  await apiJson(request, "POST", "/consents", ct, { scope: "identity" });

  // Officer sees the queue and the case review
  await english(page);
  await uiLogin(page, "sindh.officer", "/officer");
  await expect(page.getByRole("heading", { name: /Queue/ })).toBeVisible();

  // No one-way trap: Home shows a quick-return banner, /login sends staff straight back, the header has My Portal
  await page.goto("/");
  await expect(page.getByTestId("staff-return-banner")).toContainText("You are currently signed in as Department Officer.");
  await page.getByTestId("staff-return-button").click();
  await expect(page).toHaveURL(/\/officer$/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/officer$/);
  await page.goto("/scam");
  await page.getByTestId("portal-button").click();
  await expect(page).toHaveURL(/\/officer$/);
  await expect(page.getByRole("heading", { name: /Queue/ })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`#${c.id}\\b`) }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Case #${c.id}`) })).toBeVisible();
  await expect(page.getByText("Input vs OCR vs Registry")).toBeVisible();

  // Approve -> a clear confirmation pop-up, and the queue card's badge updates at once
  await page.getByRole("button", { name: "Approve" }).click();
  const confirm = page.getByTestId("officer-decision-modal");
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId("officer-decision-text")).toHaveText(`Application LM-01-${String(c.id).padStart(6, "0")} has been APPROVED by you.`);
  await page.getByTestId("officer-decision-ok").click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(`#${c.id}\\b`) })).toContainText("OFFICER_APPROVED");

  // Citizen takes consent back in her own browser
  const citizen = await newEnglishPage(browser);
  const wc = watch(citizen.p);
  await uiLogin(citizen.p, "sindh.family03", "/citizen/privacy");
  const sw = citizen.p.getByRole("switch", { name: "Officer may see my name and CNIC" });
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(citizen.p.getByText(/Access withdrawn/)).toBeVisible();
  wc.assertClean();
  await citizen.ctx.close();

  // Officer reloads the same case -> blocked
  await page.getByRole("button", { name: new RegExp(`#${c.id}\\b`) }).click();
  await expect(page.getByText(/Consent withdrawn or missing — data hidden \(403\)/)).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(`Case #${c.id}`) })).toBeHidden();
  w.assertClean();

  // Admin: rule editor, Digital Twin, fault toggle
  const admin = await newEnglishPage(browser);
  const wa = watch(admin.p);
  await uiLogin(admin.p, "sindh.admin", "/admin");
  await expect(admin.p.locator("textarea").first()).toHaveValue(/"hard"/);
  await admin.p.getByRole("button", { name: /Run Digital Twin/ }).click();
  const modal = admin.p.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: /Digital Twin/ })).toBeVisible();
  await expect(modal).toContainText(/cases replayed/);
  await modal.getByRole("button", { name: "Close" }).click();
  const fault = admin.p.getByRole("switch", { name: /NADRA Timeout/ });
  await expect(fault).toHaveAttribute("aria-checked", "false");
  await fault.click();
  await expect(fault).toHaveAttribute("aria-checked", "true");
  await fault.click(); // leave the system healthy
  await expect(fault).toHaveAttribute("aria-checked", "false");
  wa.assertClean();
  await admin.ctx.close();

  // Auditor: hash chain + evaluation dashboard
  const aud = await newEnglishPage(browser);
  const wd = watch(aud.p);
  await uiLogin(aud.p, "sindh.auditor", "/auditor");
  await aud.p.getByRole("button", { name: /Verify Hash Chain Integrity/ }).click();
  await expect(aud.p.getByRole("status").filter({ hasText: /VALID|TAMPERING/ })).toContainText(/VALID — \d+ entries verified/);
  await aud.p.goto("/eval");
  await expect(aud.p.getByRole("heading", { name: "Cost-threshold optimization" })).toBeVisible();
  await expect(aud.p.locator(".recharts-wrapper > svg.recharts-surface")).toHaveCount(2); // the 2 chart canvases (legend icons are svgs too)
  await expect(aud.p.locator(".recharts-legend-item")).toHaveCount(3);
  await expect(aud.p.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await expect(aud.p.getByRole("heading", { name: "Per-family pass rate" })).toBeVisible();
  await expect(aud.p.getByText("13_ai_failures")).toBeVisible();
  wd.assertClean();
  await aud.ctx.close();
});

// ------------------------------------------------------------------ Test 8
test("8 — a 4000px phone photo is shrunk on-device (<=1024px JPEG) and real OCR clears it", async ({ page }) => {
  const w = watch(page);
  // Record every File the page uploads (Playwright cannot read multipart file bodies from Chromium).
  await page.addInitScript(() => {
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) {
        for (const v of init.body.values()) if (v instanceof File) (window as unknown as { __uploads: File[] }).__uploads = [...((window as unknown as { __uploads?: File[] }).__uploads || []), v];
      }
      return orig(input, init);
    };
  });
  await english(page);
  await uiLogin(page, "sindh.citizen", "/citizen");
  await openScheme(page);
  await fillApplication(page, { full_name: applicant.full_name, father: applicant.father_name_variant, cnic: applicant.cnic, age: applicant.age, income: 15000 });

  const original = fs.statSync(path.join(FIX, "cnic_phone.jpg")).size;
  const t0 = Date.now();
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "cnic_phone.jpg"));
  await expect(page.getByTestId("shrink-info")).toContainText("→");
  const up = await page.waitForFunction(async () => {
    const files = (window as unknown as { __uploads?: File[] }).__uploads || [];
    const f = files[files.length - 1];
    if (!f) return null;
    const bmp = await createImageBitmap(f);
    return { type: f.type, size: f.size, width: bmp.width, height: bmp.height };
  });
  const info = (await up.jsonValue())!;
  expect(info.type).toBe("image/jpeg");
  expect(info.size, "upload must be much smaller than the 1.2 MB original").toBeLessThan(original / 3);
  expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(1024);

  // Real OCR (re-encoding drops any fixture text) must succeed on the server
  await expect(page.getByText("Photo looks clear")).toBeVisible({ timeout: 180_000 });
  const checkMs = Date.now() - t0;
  const t1 = Date.now();
  await reviewAndSubmit(page, applicant.cnic);
  await expect(page.getByTestId("parchi")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("parchi-badge")).toHaveAttribute("data-color", "green");
  console.log(`[timing] uploaded ${Math.round(info.size / 1000)} KB (${info.width}x${info.height}) from ${Math.round(original / 1000)} KB; photo check ${checkMs} ms; submit ${Date.now() - t1} ms`);
  w.assertClean();
});
