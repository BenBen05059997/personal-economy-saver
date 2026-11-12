// The "See it" buttons under an Ask answer: links first, deduplicated by address, at most three, memory notes left as quiet text.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/see-it-test.ts
import assert from "node:assert/strict";
import { seeItButtons, SEE_IT_MAX } from "@/lib/agent/see-it";

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

const memory = { label: "Rent goes up", href: "#ask-memory-1" };
const unlinked = { label: "Memory on this device" };
const quiet = seeItButtons([], [memory, unlinked, clients], APP);
assert.deepEqual(quiet.buttons.map(button => button.href), ["/clients"]);
assert.deepEqual(quiet.quiet, [memory, unlinked]);

const absolute = seeItButtons([{ href: `${APP}/bills?x=1#bill-1`, label: "Bills" }, { href: "https://evil.example/clients", label: "Elsewhere" }], [clients], APP);
assert.deepEqual(absolute.buttons.map(button => button.href), ["/bills?x=1#bill-1"], "an own-origin link becomes a path; another origin is dropped");
assert.deepEqual(seeItButtons([{ href: `${APP}/clients`, label: "Open Clients" }], [clients], APP).buttons.map(button => button.href), ["/clients"], "the absolute link and the relative source dedupe");
assert.deepEqual(seeItButtons([{ href: `${APP}/clients`, label: "x" }], [], "").buttons, [], "no known origin: absolute links are dropped");
console.log("see-it: ok");
