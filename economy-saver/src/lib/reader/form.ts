import { readAmount } from "@/lib/money/amount";
import { businessBpFromForm } from "@/lib/money/categories";
import { extractSchema } from "./extract";
import { ReaderError } from "./settings";

/** D55: the review card says a bill's amount or date is not known yet (`amountUnknown=on`, `dueUnknown=on`); `reviewReading` takes this as its `unknown`. */
export function readingUnknown(form: FormData) {
  return { amount: form.get("amountUnknown") === "on", date: form.get("dueUnknown") === "on" };
}

/** The card's "Whose" choice (two or more people only): "shared", a member id, or for a charge "shared" / "own". Absent from the form: not asked, so not set. */
function readingWhose(form: FormData, isBill: boolean) {
  const chosen = form.get("whose");
  if (typeof chosen !== "string" || chosen === "") return undefined;
  if (!isBill) return { shared: chosen === "shared", memberId: null, paidByMemberId: null };
  if (chosen === "shared") return { shared: true, memberId: null, paidByMemberId: String(form.get("paidByMemberId") ?? "") || null };
  return { shared: false, memberId: chosen, paidByMemberId: null };
}

export function readingForm(form: FormData) {
  const unknown = readingUnknown(form);
  const amount = String(form.get("amount") ?? "").trim();
  const chosen = form.get("currency");
  const currency = chosen === "USD" || chosen === "JPY" ? chosen : null;
  if (currency === null && !(unknown.amount && !chosen)) throw new ReaderError("Enter a positive amount in the selected currency.");
  let amountMinor: number | null = null;
  if (!unknown.amount) {
    if (currency === null) throw new ReaderError("Enter a positive amount in the selected currency.");
    // The same reading as every amount input (separators, full-width digits, the ¥100,000,000 / $1,000,000 limit).
    const read = readAmount(amount, currency, false);
    if ("problem" in read) throw new ReaderError(read.problem);
    if (read.minor <= 0) throw new ReaderError("The amount must be more than zero");
    amountMinor = read.minor;
  }
  const businessBp = businessBpFromForm(form.get("businessShare"), form.get("businessPercent"));
  if (businessBp === null) throw new ReaderError("Enter the business share as a percentage from 0 to 100.");
  // D48: a bill's repeat, its new amount from a date and its cancel-by date; ignored for a card charge.
  const isBill = form.get("target") === "bill";
  const nextText = String(form.get("nextAmount") ?? "").trim();
  let nextAmountMinor: number | null = null;
  if (isBill && nextText) {
    if (currency === null) throw new ReaderError("Enter a positive amount in the selected currency.");
    const next = readAmount(nextText, currency, false);
    if ("problem" in next) throw new ReaderError(next.problem);
    if (next.minor <= 0) throw new ReaderError("The new amount must be more than zero");
    nextAmountMinor = next.minor;
  }
  const result = extractSchema.safeParse({ kind: form.get("target"), name: form.get("name"), date: unknown.date ? null : form.get("date"),
    amountMinor, currency, category: form.get("category") || null, businessBp, cardId: form.get("cardId") || null,
    repeat: isBill ? form.get("repeat") || null : null, nextAmountMinor, nextAmountFrom: isBill ? form.get("nextAmountFrom") || null : null, cancelBy: isBill ? form.get("cancelBy") || null : null,
    repeatUntil: isBill && form.get("repeat") ? form.get("repeatUntil") || null : null,
    periodStart: isBill ? form.get("periodStart") || null : null, periodEnd: isBill ? form.get("periodEnd") || null : null,
    whose: readingWhose(form, isBill) });
  if (!result.success) throw new ReaderError(result.error.issues.some(issue => issue.path[0] === "category") ? "Choose a category from the list." : "Check the reading fields and enter a valid date and amount.");
  return result.data;
}
