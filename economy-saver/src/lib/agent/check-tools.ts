// The to_check read tool (D61): everything waiting for the user's OK, each bill, charge or reading with the checks the app ran on it.
// The checks are `checksFor` in src/lib/money/checks.ts, the same words To check shows. Information only: the agent quotes them and never decides one.
import { z } from "zod";
import { readerInbox } from "@/db/reader-inbox";
import { checksFor, pendingProposals, readingProposal, type Check, type Proposal } from "@/lib/money/checks";
import { minorPerUnit } from "@/lib/money/format";
import type { Tool, ToolContext } from "./tools";

const checkOut = (checks: Check[]) => checks.map(({ kind, words, choices }) => ({ kind, words, choices: choices.map(choice => choice.label) }));

export const checkTools: Tool[] = [
  {
    name: "to_check",
    description: "Everything waiting for the user's OK in To check: readings from uploaded or forwarded documents, drafts saved by Ask or MCP (bills, card charges, bank balances, pots), and documents still being read. Each bill, charge or reading carries the checks the app ran (missing amount or date, already saved, due date passed, amount far from the usual, repeat not known), each with the app's words and the choices it offers. Quote the words as they are and offer the choices; never decide a check and never say anything is saved: the user confirms in To check or in Ask. Amounts are integer minor units of the currency given (whole yen for JPY, cents for USD). Information only.",
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
] as unknown as Tool[];
