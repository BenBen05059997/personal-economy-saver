// The "See it" buttons under an Ask answer: links first, deduplicated by address, at most three, memory notes left as quiet text.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/see-it-test.ts
import assert from "node:assert/strict";
import { chooseReply } from "@/lib/agent/reply";
import { nextSteps, seeItButtons, SEE_IT_MAX } from "@/lib/agent/see-it";
import { MODEL_RULES, ASK_RULES } from "@/lib/agent/rules";

const APP = "http://127.0.0.1:3123";
const clients = { label: "Clients", href: "/clients" };
const due = { label: "Coming up", href: "/#coming-up" };

const plain = seeItButtons([], [clients, due], APP);
assert.deepEqual(plain.buttons, [{ href: "/clients", label: "See it in Clients ›" }, { href: "/#coming-up", label: "See it in Coming up ›" }]);
assert.deepEqual(plain.quiet, []);

const withLink = seeItButtons([{ href: "/bills#bill-1", label: "See it in Bills ›" }, { href: "/clients", label: "Open Clients" }], [clients, due], APP);
assert.deepEqual(withLink.buttons.map(button => button.href), ["/bills#bill-1", "/clients"], "a turn with its own links shows only them");
assert.deepEqual(withLink.quiet, [clients, due], "the pages it only looked at stay quiet");

const many = seeItButtons([], [clients, due, { label: "Saving", href: "/saving" }, { label: "Memory", href: "/memory" }], APP);
assert.equal(many.buttons.length, SEE_IT_MAX);

// A turn that showed a view whose page is Spending offers "See it in Spending ›" (the source comes from chooseReply).
const shownView = chooseReply({ clarify: null, outOfScope: null, text: "Groceries lead.", tools: ["show"], called: true, facts: [], person: [], today: "2026-11-14", readings: [],
  recipe: { version: 1, title: "Where does the month go?", blocks: [{ type: "view", view: "month_by_category", args: {} }] } as never });
assert.deepEqual(shownView?.sources, [{ label: "Spending", href: "/spending" }]);
assert.deepEqual(seeItButtons([], shownView!.sources, APP).buttons, [{ href: "/spending", label: "See it in Spending ›" }]);

const memory = { label: "Rent goes up", href: "#ask-memory-1" };
const unlinked = { label: "Memory on this device" };
const quiet = seeItButtons([], [memory, unlinked, clients], APP);
assert.deepEqual(quiet.buttons.map(button => button.href), ["/clients"]);
assert.deepEqual(quiet.quiet, [memory, unlinked]);

const absolute = seeItButtons([{ href: `${APP}/bills?x=1#bill-1`, label: "Bills" }, { href: "https://evil.example/clients", label: "Elsewhere" }], [clients], APP);
assert.deepEqual(absolute.buttons.map(button => button.href), ["/bills?x=1#bill-1"], "an own-origin link becomes a path; another origin is dropped");
assert.deepEqual(seeItButtons([{ href: `${APP}/clients`, label: "Open Clients" }], [clients], APP).buttons.map(button => button.href), ["/clients"], "the absolute link and the relative source dedupe");
assert.deepEqual(seeItButtons([{ href: `${APP}/clients`, label: "x" }], [], "").buttons, [], "no known origin: absolute links are dropped");
// A failed check with a picture: code's sentence, the recipe kept, no model words. Without a picture it stays refused.
const base = { clarify: null, outOfScope: null, tools: ["show"], called: true, today: "2026-11-14", recipe: null };
const fact = { value: 18780, unit: "money", currency: "JPY", by: "engine" };
const invented = chooseReply({ ...base, text: "You are ¥99,999 short.", facts: [fact], person: [], readings: [{ sentence: "You're ¥18,780 short." }] });
assert.deepEqual([invented?.kind, invented?.text, invented?.wording], ["answer", "You're ¥18,780 short.", "code"]);
assert.equal(chooseReply({ ...base, text: "You are ¥99,999 short.", facts: [fact], person: [], readings: [] }), null, "no picture, no stand-in");
assert.equal(chooseReply({ ...base, text: "That is ¥40,000, fine.", facts: [fact], person: ["Can I spend ¥40,000?"], readings: [{ sentence: "x" }] })?.wording, "model", "the person's own amount may be quoted back");
assert.equal(chooseReply({ ...base, text: "You are ¥18,780 short.", facts: [fact], person: [], readings: [{ sentence: "x" }] })?.wording, "model", "a confirmed amount passes");

// What next (D80): an open finding about the same subject, then a short's funding rows, then nothing (the caller's "See it in" stands).
const nudge = { action: "remind" as const, refId: "inv-1", facts: [{ about: { type: "invoice", id: "inv-1" } }] };
const otherNudge = { action: "remind" as const, refId: "inv-9", facts: [] };
const rows = [
  { id: "bank", cost: 5, },
  { id: "remind", cost: 0, href: "/invoices/inv-1", action: "Copy link again" },
  { id: "invoice", cost: 0, href: "/invoices/inv-2", action: "Review invoice" },
];
const pace = { name: "client_pace_usual", value: 20, case: "none", about: { type: "client", id: "c-1" } };
const short = { name: "short", value: 18780, case: "late" };
const owner = (id: string) => id.startsWith("inv-") ? "c-1" : undefined;
const both = nextSteps({ facts: [pace, short], suggestions: [otherNudge, nudge], options: { rows }, clientOfInvoice: id => id === "inv-1" ? "c-1" : undefined });
assert.deepEqual(both.map(step => step.label), ["Copy link again", "Review invoice", "See your options ›"], "the open nudge first (the same button as its funding row, once), then the short's getting-paid row, then the rest behind one button");
assert.deepEqual(nextSteps({ facts: [short], suggestions: [nudge], options: { rows } }).map(step => step.label), ["Copy link again", "Review invoice", "See your options ›"], "a short with no matching finding: funding rows, getting paid first");
assert.deepEqual(nextSteps({ facts: [pace], suggestions: [nudge], options: { rows }, clientOfInvoice: owner }).map(step => step.label), ["Copy link again"], "no short: only the finding about the same client");
assert.deepEqual(nextSteps({ facts: [pace], suggestions: [nudge], options: { rows } }), [], "a finding about another subject, and no short: nothing");
assert.deepEqual(nextSteps({ facts: [{ name: "short", value: 0, case: "late" }], suggestions: [], options: { rows } }), [], "a picture with none of these offers nothing");
assert.ok(nextSteps({ facts: [short], suggestions: [], options: { rows } }).every(step => !/loan|credit|advance/i.test(step.label)), "no product is named");

// The rules: the do-not-restate rule is Ask's alone.
assert.ok(ASK_RULES.includes("Do not repeat it. Say why") && ASK_RULES.includes("Never offer an action"));
assert.ok(!MODEL_RULES.includes("Do not repeat") && !MODEL_RULES.includes("Never offer an action"), "MCP never gets the Ask-only rule");
assert.ok(MODEL_RULES.includes("sentence is the answer's base") && !MODEL_RULES.includes("usualDaysToPay"));
console.log("see-it: ok");
