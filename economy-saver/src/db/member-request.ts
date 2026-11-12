// A member's share asked for by PayPal (D45): the owner's Approve makes a payment link for what the member owes the owner, as for a
// client (D12), and the verified webhook that marks it paid records the transfers as settled (D15). Nothing pays a member.
// The request is an invoice with a payer member in place of a client, so Approve, the pay page, the webhook and the Try it
// test-card payment are the client invoice's own. It is in USD, as every payment link is; owed_minor keeps what was owed in the
// household's currency. The forecast never sees it (the engine reads client invoices only).
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { InputError } from "./input-error";
import { convertMinor } from "./money";
import { invoices, members } from "./schema";
import { owedNow } from "./settle";
import { canHavePayLink } from "@/lib/paypal/pay-link";
import { dayLabel, minorMoney } from "@/lib/money/format";

const OPEN = ["draft", "sent"] as const;

/** The owner member (the one PayPal pays) and the open requests (draft or sent), for Home to show beside each transfer line. */
export async function memberRequestsView(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  const [owner, open] = await Promise.all([
    ownerId(db, hid),
    db.select({ id: invoices.id, payerMemberId: invoices.payerMemberId, owedMinor: invoices.owedMinor, status: invoices.status })
      .from(invoices).where(and(eq(invoices.householdId, hid), isNotNull(invoices.payerMemberId), inArray(invoices.status, [...OPEN]))),
  ]);
  return { ownerId: owner, open };
}

type OwnedRequest = { id: string; payerMemberId: string | null; owedMinor: number | null; status: string; paypalCaptureId: string | null };

/**
 * Whether this request still asks for what the member owes the owner now. A request that does not is closed (its link ends), so
 * a link that no longer matches what is owed cannot be paid. Run in the caller's household transaction.
 */
export async function requestIsCurrent(tx: Db, hid: string, invoice: OwnedRequest, close = true): Promise<boolean> {
  const { transfers } = await owedNow(tx, hid);
  const owner = await ownerId(tx, hid);
  const transfer = transfers.find(t => t.fromId === invoice.payerMemberId && t.toId === owner);
  if (transfer && transfer.amountMinor === invoice.owedMinor) return true;
  if (close && invoice.paypalCaptureId === null && (OPEN as readonly string[]).includes(invoice.status)) {
    await tx.update(invoices).set({ status: "closed" }).where(and(eq(invoices.householdId, hid), eq(invoices.id, invoice.id)));
  }
  return false;
}

async function ownerId(tx: Db, hid: string): Promise<string> {
  const [owner] = await tx.select({ id: members.id }).from(members).where(and(eq(members.householdId, hid), eq(members.role, "owner")));
  if (!owner) throw new Error("Household has no owner member");
  return owner.id;
}

/**
 * Drafts the request for what `fromMemberId` owes the owner now, worked out here from the stored rows (the browser sends no amount).
 * One open request per member: asking again for the same amount returns it, and a different amount closes the old one first.
 * Returns the invoice id, to review and Approve. Only the owner is paid, so a member who is owed money, or the owner, has none.
 */
export async function requestFromMember(db: Db, householdId: string, fromMemberId: string): Promise<string> {
  const hid = requireHousehold(householdId);
  const saved = await withHousehold(db, hid, async tx => {
    const { home, today, fxPerUsd, transfers } = await owedNow(tx, hid);
    const owner = await ownerId(tx, hid);
    const transfer = transfers.find(t => t.fromId === fromMemberId && t.toId === owner);
    if (!transfer) throw new InputError("Nobody owes you anything to ask for");
    const open = await tx.select().from(invoices)
      .where(and(eq(invoices.householdId, hid), eq(invoices.payerMemberId, fromMemberId), inArray(invoices.status, [...OPEN]))).for("update");
    const current = open.find(i => i.owedMinor === transfer.amountMinor);
    if (current) return current.id;
    for (const old of open) {
      // A payment PayPal is already taking cannot be withdrawn; its webhook settles it.
      if (old.paypalCaptureId !== null) throw new InputError(`${transfer.fromName}'s payment is being confirmed`);
      await tx.update(invoices).set({ status: "closed" }).where(and(eq(invoices.householdId, hid), eq(invoices.id, old.id)));
    }
    const amountMinor = convertMinor(transfer.amountMinor, home, "USD", fxPerUsd);
    if (!canHavePayLink({ currency: "USD", amountMinor })) throw new InputError("That amount is too small for a payment link");
    const [row] = await tx.insert(invoices).values({
      householdId: hid, payerMemberId: fromMemberId, owedMinor: transfer.amountMinor, status: "draft", currency: "USD", amountMinor,
      item: `Shared costs through ${dayLabel(today)}`, madeBy: "form",
    }).returning({ id: invoices.id });
    await recordEvent(tx, hid, { madeBy: "form", kind: "invoice_drafted", title: `Payment request drafted for ${transfer.fromName}`,
      body: `${transfer.fromName} owes ${transfer.toName} ${minorMoney(transfer.amountMinor, home)}`, ref: { type: "invoice", id: row.id } });
    return row.id;
  });
  return saved;
}
