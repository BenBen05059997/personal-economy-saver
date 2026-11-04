import { readAmount } from "@/lib/money/amount";
import { businessBpFromForm } from "@/lib/money/categories";
import { extractSchema } from "./extract";
import { ReaderError } from "./settings";

export function readingForm(form: FormData) {
  const amount = String(form.get("amount") ?? "").trim();
  const currency = form.get("currency");
  if (currency !== "USD" && currency !== "JPY") throw new ReaderError("Enter a positive amount in the selected currency.");
  // The same reading as every amount input (separators, full-width digits, the ¥100,000,000 / $1,000,000 limit).
  const read = readAmount(amount, currency, false);
  if ("problem" in read) throw new ReaderError(read.problem);
  if (read.minor <= 0) throw new ReaderError("The amount must be more than zero");
  const amountMinor = read.minor;
  const businessBp = businessBpFromForm(form.get("businessShare"), form.get("businessPercent"));
  if (businessBp === null) throw new ReaderError("Enter the business share as a percentage from 0 to 100.");
  // D48: a bill's repeat, its new amount from a date and its cancel-by date; ignored for a card charge.
  const isBill = form.get("target") === "bill";
  const nextText = String(form.get("nextAmount") ?? "").trim();
  let nextAmountMinor: number | null = null;
  if (isBill && nextText) {
    const next = readAmount(nextText, currency, false);
    if ("problem" in next) throw new ReaderError(next.problem);
    if (next.minor <= 0) throw new ReaderError("The new amount must be more than zero");
    nextAmountMinor = next.minor;
  }
  const result = extractSchema.safeParse({ kind: form.get("target"), name: form.get("name"), date: form.get("date"),
    amountMinor, currency, category: form.get("category") || null, businessBp, cardId: form.get("cardId") || null,
    repeat: isBill ? form.get("repeat") || null : null, nextAmountMinor, nextAmountFrom: isBill ? form.get("nextAmountFrom") || null : null, cancelBy: isBill ? form.get("cancelBy") || null : null });
  if (!result.success) throw new ReaderError(result.error.issues.some(issue => issue.path[0] === "category") ? "Choose a category from the list." : "Check the reading fields and enter a valid date and amount.");
  return result.data;
}
