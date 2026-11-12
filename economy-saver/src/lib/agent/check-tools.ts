// The to_check read tool (D61): everything waiting for the user's OK, each bill, charge or reading with the checks the app ran on it.
// The checks are `checksFor` in src/lib/money/checks.ts, the same words To check shows. Information only: the agent quotes them and never decides one.
import { z } from "zod";
import { readerInbox } from "@/db/reader-inbox";
import { setReadingWhose } from "@/db/readings";
import { checksFor, pendingProposals, readingProposal, type Check, type Proposal } from "@/lib/money/checks";
import { minorPerUnit } from "@/lib/money/format";
import type { Tool, ToolContext } from "./tools";

const checkOut = (checks: Check[]) => checks.map(({ kind, words, choices }) => ({ kind, words, choices: choices.map(choice => choice.label) }));

export const checkTools: Tool[] = [
  {
    name: "to_check",
    description: "Pending drafts, document readings and in-flight files. Quote the app’s checks and choices.",
    input: z.object({}), scope: "read",
    run: async (ctx: ToolContext) => {
      const [state, inbox] = await Promise.all([ctx.state(), readerInbox(ctx.db, ctx.householdId)]);
      const unit = minorPerUnit(state.homeCurrency);
      const readingProposals = inbox.readings.map(readingProposal);
      const drafts = pendingProposals(state);
      const fromOf = new Map<string, string>([
        ...state.bills.map(bill => [bill.id, bill.madeBy ?? "form"] as const),
        ...state.charges.map(charge => [charge.id, charge.madeBy ?? "form"] as const),
      ]);
      const item = (p: Proposal, from: string, documentId?: string) => ({
        source: p.source, id: p.id, what: p.kind, name: p.name, amountMinor: p.amountMinor, currency: p.currency, date: p.date, repeat: p.repeat,
        from, ...(documentId && { documentId }),
        checks: checkOut(checksFor(p, state, readingProposals)),
      });
      return JSON.stringify({
        currency: state.homeCurrency,
        items: [
          ...inbox.readings.map((reading, index) => item(readingProposals[index], reading.from, reading.documentId)),
          ...drafts.map(p => item(p, fromOf.get(p.id) ?? "form")),
          ...state.balanceUpdates.map(update => ({ source: "balance", id: update.id, what: "bank_balance", name: null, amountMinor: Math.round(update.amount * unit), currency: state.homeCurrency, date: null, repeat: null, from: update.madeBy ?? "form", checks: [] })),
          ...state.pendingPots.map(pot => ({ source: "pot", id: pot.id, what: "pot", name: pot.name, amountMinor: Math.round(pot.saved * unit), currency: state.homeCurrency, date: null, repeat: null, from: pot.madeBy ?? "form", checks: [] })),
        ],
        reading: inbox.jobs.map(job => ({ documentId: job.id, status: job.status, error: job.error })),
      });
    },
  },
  {
    name: "set_whose",
    description: "Set whose a waiting To check item is, by name. shared: person pays (null: nobody); else person owns it. Charges take no person.",
    input: z.object({ reading: z.string().trim().min(1).max(160), shared: z.boolean(), person: z.string().trim().min(1).max(80).nullable().default(null) }),
    scope: "draft",
    run: async (ctx: ToolContext, input: { reading: string; shared: boolean; person: string | null }) => {
      const { readingId, words } = await setReadingWhose(ctx.db, ctx.householdId, input);
      ctx.addLink?.({ label: "Open in To check", href: new URL(`/to-check#reading-${readingId}`, ctx.appUrl).href });
      return words;
    },
  },
] as unknown as Tool[];
