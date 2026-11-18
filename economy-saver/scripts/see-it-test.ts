// The "See it" buttons under an Ask answer: links first, deduplicated by address, at most three, memory notes left as quiet text.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/see-it-test.ts
import assert from "node:assert/strict";
import { chooseReply } from "@/lib/agent/reply";
import { nextSteps, seeItButtons, SEE_IT_MAX } from "@/lib/agent/see-it";
import { MODEL_RULES, ASK_RULES } from "@/lib/agent/rules";
import { MAX_BULK_ITEMS, MAX_KEEP_OFFERS, MAX_SHOWN } from "@/lib/agent/limits";

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
const shownView = chooseReply({ clarify: null, outOfScope: null, text: "Groceries lead.", toolSources: [], called: true, facts: [], person: [], today: "2026-11-14", readings: [],
  recipe: { version: 1, title: "Where does the month go?", blocks: [{ type: "view", view: "month_by_category", args: {} }] } as never });
assert.deepEqual(shownView?.sources, [{ label: "Spending", href: "/spending" }]);
assert.deepEqual(seeItButtons([], shownView!.sources, APP).buttons, [{ href: "/spending", label: "See it in Spending ›" }]);

// A reply that shows what foreign money cost has no page of its own: no "See it in" button (D77).
const shownForeign = chooseReply({ clarify: null, outOfScope: null, text: "Fees were high.", toolSources: [], called: true, facts: [], person: [], today: "2026-11-14", readings: [],
  recipe: { version: 1, title: "What foreign money cost", blocks: [{ type: "view", view: "fx_cost", args: {} }] } as never });
assert.deepEqual(shownForeign?.sources, []);
assert.deepEqual(seeItButtons([], shownForeign!.sources, APP).buttons, []);

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
const base = { clarify: null, outOfScope: null, toolSources: [], called: true, today: "2026-11-14", recipe: null };
const fact = { value: 18780, unit: "money" as const, currency: "JPY" as const, by: "engine" as const };
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

// The rules. Ask's alone: the do-not-restate rule and the explicit-request memory rule; the shared rules say neither.
assert.ok(ASK_RULES.includes("Do not repeat it. Say why") && ASK_RULES.includes("Never offer an action"));
assert.ok(!MODEL_RULES.includes("Do not repeat") && !MODEL_RULES.includes("Never offer an action"), "MCP never gets the Ask-only rule");
assert.ok(MODEL_RULES.includes("answer from the show result's facts and sentence"), "the shared rule does not say to build the answer on the sentence the picture already shows");
assert.ok(MODEL_RULES.includes("Call remember only when the person asks you to remember something.") && !MODEL_RULES.includes("lasting fact"), "remember is for an explicit request, as the tool enforces");
assert.ok(ASK_RULES.includes("call remember only on an explicit request") && ASK_RULES.includes("Otherwise use offer_keep for a lasting fact"));
assert.match(MODEL_RULES, /about to be saved and one detail is missing or matches several[^.]*ask which one/);
assert.match(MODEL_RULES, /household_snapshot is background context/);
// The three saving-win findings (D81): their button is the finding's own, offered when the picture's facts are about the same win, purchase or medal.
const keep = { action: "keep_win" as const, refId: "2026-10:cat:food", facts: [{ about: { type: "choice", id: "2026-10:cat:food" } }] };
const paidFrom = { action: "match" as const, refId: "bill:b-1|2026-11-10", facts: [{ about: { type: "bill", id: "b-1@2026-11-10" } }, { about: { type: "pot", id: "p-1" } }] };
const medal = { action: "wins" as const, refId: null, facts: [{ about: { type: "medal", id: "choices:0" } }] };
assert.deepEqual(nextSteps({ facts: [{ name: "found_win", value: 6000, about: { type: "choice", id: "2026-10:cat:food" } }], suggestions: [keep, paidFrom, medal], options: null }),
  [{ label: "Review the saving", href: "/saving?win=2026-10%3Acat%3Afood#wins" }], "a picture of a found win offers reviewing that saving, and not the other two");
assert.deepEqual(nextSteps({ facts: [{ name: "bill_amount", value: 15_000, about: { type: "bill", id: "b-1" } }], suggestions: [keep, paidFrom, medal], options: null }),
  [{ label: "Review the purchase", href: "/saving?paid=bill%3Ab-1%7C2026-11-10#paid-from" }], "a picture of the purchase offers asking which pot paid for it");
assert.deepEqual(nextSteps({ facts: [{ name: "medal_earned_on", value: "2026-11-12", about: { type: "medal", id: "choices:0" } }], suggestions: [keep, paidFrom, medal], options: null }),
  [{ label: "See your wins", href: "/saving#wins" }], "a medal picture offers the wins page, which needs no reference");
assert.deepEqual(nextSteps({ facts: [pace], suggestions: [keep, paidFrom, medal], options: null }), [], "a picture about something else offers none of them");
assert.match(MODEL_RULES, /add_bills or log_charges/);
assert.ok(!/\btoday\b|\d{4}-\d{2}-\d{2}|JPY|home currency/i.test(MODEL_RULES), "the shared rules name neither the date nor the household's currency: the MCP server cannot know them");
// The limits the rules name are the limits the code enforces.
assert.ok(ASK_RULES.includes(`call show (up to ${MAX_SHOWN} per answer)`) && ASK_RULES.includes(`Offer at most ${MAX_KEEP_OFFERS} things`) && MODEL_RULES.includes(`up to ${MAX_BULK_ITEMS} in one call`));
console.log("see-it: ok");
