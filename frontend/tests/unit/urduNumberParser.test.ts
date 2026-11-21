/** Unit tests for the on-device spoken-number parser. Run: npm run test:unit (Node's built-in test runner). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCnic, normalizeDigits, parseSpokenAmount, parseSpokenAmountDetailed, parseSpokenCnic } from "../../lib/urduNumberParser.ts";

// ------------------------------------------------------------------ CNIC: digit-by-digit
for (const [input, expected] of [
  ["چار دو پانچ صفر ایک", "42501"],
  ["chaar do paanch sifar aik", "42501"],
  ["four two five zero one", "42501"],
  ["4 2 5 0 1", "42501"],
  ["۴ ۲ ۵ ۰ ۱", "42501"],
  ["٤٢٥٠١", "42501"],
] as const) {
  test(`CNIC digit-by-digit: ${input}`, () => assert.equal(parseSpokenCnic(input), expected));
}

// ------------------------------------------------------------------ CNIC: grouped / compound
for (const [input, expected] of [
  ["پینتالیس ہزار چار سو ایک", "45401"],
  ["paintalis hazar chaar sau aik", "45401"],
  ["forty-five thousand four hundred one", "45401"],
  ["forty five thousand four hundred one", "45401"],
  ["45,401", "45401"],
  ["بیالیس پانچ سو ایک", "42501"],
  ["forty two five hundred one", "42501"],
] as const) {
  test(`CNIC grouped: ${input}`, () => assert.equal(parseSpokenCnic(input), expected));
}

test("CNIC mixed styles concatenate and format at 13 digits", () => {
  // 42101 | 1234567 | 1 spoken as: grouped 42101, dash, digits 1 2 3, grouped 4567, digit 1
  assert.equal(parseSpokenCnic("بیالیس ہزار ایک سو ایک ڈیش ایک دو تین چار ہزار پانچ سو سڑسٹھ ڈیش ایک"), "42101-1234567-1");
  assert.equal(parseSpokenCnic("42101-1234567-1"), "42101-1234567-1");
  assert.equal(parseSpokenCnic("mera shanakhti card number hai 4 2 1 0 1 1 2 3 4 5 6 7 1"), "42101-1234567-1");
});

test("CNIC keeps spoken zeros and caps at 13 digits", () => {
  assert.equal(parseSpokenCnic("صفر صفر ایک"), "001");
  assert.equal(parseSpokenCnic("1 2 3 4 5 6 7 8 9 0 1 2 3 4 5"), "12345-6789012-3");
});

test("formatCnic formats progressively", () => {
  assert.equal(formatCnic("42101"), "42101");
  assert.equal(formatCnic("421011234"), "42101-1234");
  assert.equal(formatCnic("4210112345671"), "42101-1234567-1");
});

// ------------------------------------------------------------------ amounts: required cases
for (const [input, expected] of [
  ["ڈیڑھ ہزار", 1500],
  ["ڈھائی لاکھ", 250000],
  ["ساڑھے تین ہزار", 3500],
  ["سوا دو لاکھ", 225000],
  ["پونے دو لاکھ", 175000],
  ["دو بلین", 2_000_000_000],
  ["دو ارب", 2_000_000_000],
] as const) {
  test(`amount required: ${input} = ${expected}`, () => assert.equal(parseSpokenAmount(input), expected));
}

// ------------------------------------------------------------------ amounts: full fraction table
for (const [input, expected] of [
  ["ڈیڑھ سو", 150], ["ڈیڑھ لاکھ", 150000], ["ڈیڑھ کروڑ", 15_000_000], ["ڈیڑھ", 1.5],
  ["ڈھائی سو", 250], ["ڈھائی ہزار", 2500], ["ڈھائی کروڑ", 25_000_000],
  ["ساڑھے چار لاکھ", 450000], ["ساڑھے بارہ ہزار", 12500],
  ["سوا لاکھ", 125000], ["سوا دو ہزار", 2250], ["سوا سو", 125],
  ["پونے لاکھ", 75000], ["پونے تین ہزار", 2750],
  ["dedh hazar", 1500], ["derh lakh", 150000], ["dhai lakh", 250000], ["sadhe teen hazar", 3500],
  ["sarhe barah hazar", 12500], ["sawa lakh", 125000], ["paune do lakh", 175000],
] as const) {
  test(`amount fraction: ${input} = ${expected}`, () => assert.equal(parseSpokenAmount(input), expected));
}

// ------------------------------------------------------------------ amounts: scales, digits, words
for (const [input, expected] of [
  ["پندرہ ہزار", 15000], ["meri aamdani pandrah hazar hai", 15000], ["fifteen thousand", 15000],
  ["ek lakh pachees hazar", 125000], ["das hazar aur paanch sau", 10500], ["teen sau", 300],
  ["1,500", 1500], ["۱۵۰۰۰", 15000], ["2.5 لاکھ", 250000], ["15 hazar rupay", 15000],
  ["دو ملین", 2_000_000], ["two million", 2_000_000], ["ek crore", 10_000_000], ["teen karor", 30_000_000],
  ["twenty five thousand", 25000], ["چالیس", 40], ["two billion", 2_000_000_000],
] as const) {
  test(`amount: ${input} = ${expected}`, () => assert.equal(parseSpokenAmount(input), expected));
}

test("amount: no number words -> null", () => {
  assert.equal(parseSpokenAmount("meri aamdani hai"), null);
  assert.equal(parseSpokenAmount(""), null);
});

test("amount: ambiguity is reported so the UI asks again", () => {
  assert.equal(parseSpokenAmountDetailed("do teen hazar").ambiguous, true);
  assert.equal(parseSpokenAmountDetailed("shayad bees hazar").ambiguous, true);
  assert.equal(parseSpokenAmountDetailed("تقریباً بیس ہزار").ambiguous, true);
  assert.equal(parseSpokenAmountDetailed("bees hazar").ambiguous, false);
  assert.equal(parseSpokenAmountDetailed("twenty five thousand").ambiguous, false);
});

test("normalizeDigits maps Urdu and Eastern Arabic digits", () => {
  assert.equal(normalizeDigits("۰۱۲۳۴۵۶۷۸۹ ٠١٢٣٤٥٦٧٨٩"), "0123456789 0123456789");
});
