// The buttons that end an Ask answer (D60): where the person can see what the answer used or did. The words are ours, never the model's.
import { findingAction } from "@/lib/money/suggestion-types";
export type SeeIt = { href: string; label: string };
export const SEE_IT_MAX = 3;

/** An in-app page link; a "#note" anchor on the Ask page and a source with no address are not. */
const isPage = (href: string | undefined): href is string => Boolean(href) && !href!.startsWith("#");

/** An address as an in-app path: relative ones stay, an absolute one on `origin` loses its origin, any other origin is null. */
function inApp(href: string, origin: string): string | null {
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return origin !== "" && url.origin === origin ? url.pathname + url.search + url.hash : null;
  } catch { return null; }
}

/**
 * One row of buttons: the turn's own links when it has any (they say where something was kept), else "See it in <source> ›" for each
 * source that has a page; an absolute address on the app's own `origin` is made a path, one on another origin is dropped. One button per address, at most SEE_IT_MAX. `quiet` is what is left over, shown as plain text.
 */
export function seeItButtons<T extends { href?: string; label: string }>(links: readonly SeeIt[], sources: readonly T[], origin: string): { buttons: SeeIt[]; quiet: T[] } {
  const buttons: SeeIt[] = [];
  const add = (button: SeeIt) => { if (buttons.length < SEE_IT_MAX && !buttons.some(known => known.href === button.href)) buttons.push(button); };
  for (const link of links) { const href = inApp(link.href, origin); if (href !== null) add({ ...link, href }); }
  const pages = sources.map(source => ({ source, href: source.href === undefined ? undefined : inApp(source.href, origin) ?? undefined }));
  // A turn that did something links to what it did; the pages it only looked at stay quiet, so a saved charge never offers "See it in Clients".
  if (buttons.length > 0) return { buttons, quiet: pages.map(({ source }) => source) };
  for (const { source, href } of pages) if (isPage(href)) add({ href, label: `See it in ${source.label} ›` });
  return { buttons, quiet: pages.filter(({ href }) => !isPage(href)).map(({ source }) => source) };
}

// What next (D80): after a picture, code offers the one thing the picture's own facts point to. The model never writes an action (D40, D12).
type StepAbout = { type: string; id: string };
type StepFact = { name: string; value: number | string; case?: string; about?: StepAbout | null };
type StepSuggestion = { action: Parameters<typeof findingAction>[0]["action"]; refId: string | null; facts?: readonly { about?: StepAbout | null }[] };
type StepOption = { id: string; cost: number; href?: string; action?: string };

const SEE_OPTIONS: SeeIt = { href: "/options", label: "See your options ›" };
/** The funding rows that get paid sooner (invoice it, copy the link again; D7, D12): the only ones with a page of their own to go to. */
const GETTING_PAID = new Set(["invoice", "remind"]);
const REF_TYPE: Record<StepSuggestion["action"], string | null> = { remind: "invoice", statement: "card", bill: "bill", check_bill: "bill", pot: "pot", regular: null, runway: null };

/**
 * The buttons a picture offers, in D80's order: first each open finding about the same client, card, bill or pot as one of its facts (its
 * button is the finding's own, from `findingAction`); then, when a fact says short (late or as usual), the funding rows cheapest first, getting
 * paid led by the invoice and the link again, the rest behind one "See your options" button. Nothing otherwise: the caller's "See it in"
 * buttons (D67) then stand as they are. At most SEE_IT_MAX.
 * `clientOfInvoice` turns an invoice id into its client's id, so an overdue invoice and a client's pace are the same subject.
 */
export function nextSteps(input: {
  facts: readonly StepFact[];
  suggestions: readonly StepSuggestion[];
  options: { rows: readonly StepOption[] } | null;
  clientOfInvoice?: (invoiceId: string) => string | undefined;
}): SeeIt[] {
  const { facts, suggestions, options, clientOfInvoice = () => undefined } = input;
  const subject = (about: StepAbout) => {
    const id = about.id.split("@")[0];
    if (about.type === "invoice") { const client = clientOfInvoice(id); if (client) return `client:${client}`; }
    return `${about.type}:${id}`;
  };
  const named = new Set(facts.flatMap(item => item.about ? [subject(item.about)] : []));
  const buttons: SeeIt[] = [];
  const add = (button: SeeIt) => { if (buttons.length < SEE_IT_MAX && !buttons.some(known => known.href === button.href)) buttons.push(button); };
  for (const row of suggestions) {
    const type = REF_TYPE[row.action];
    const subjects = [...(type && row.refId ? [subject({ type, id: row.refId })] : []), ...(row.facts ?? []).flatMap(item => item.about ? [subject(item.about)] : [])];
    if (subjects.some(key => named.has(key))) add(findingAction(row));
  }
  const short = facts.some(item => item.name === "short" && typeof item.value === "number" && item.value > 0 && (item.case === "late" || item.case === "as_usual"));
  if (short && options && options.rows.length) {
    const byCost = [...options.rows].sort((a, b) => a.cost - b.cost);
    for (const row of byCost) if (GETTING_PAID.has(row.id) && row.href && row.action) add({ href: row.href, label: row.action });
    if (byCost.some(row => !(GETTING_PAID.has(row.id) && row.href))) add(SEE_OPTIONS);
  }
  return buttons;
}
