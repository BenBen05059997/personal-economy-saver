import { businessBpFromForm } from "@/lib/money/categories";
import { extractSchema } from "./extract";
import { ReaderError } from "./settings";

export function readingForm(form: FormData) {
  const amount = String(form.get("amount") ?? "").trim();
  const currency = form.get("currency");
  const valid = currency === "USD" ? /^\d{1,14}(\.\d{1,2})?$/ : /^\d{1,15}$/;
  if (!valid.test(amount)) throw new ReaderError("Enter a positive amount in the selected currency.");
  const [whole, fraction = ""] = amount.split(".");
  const amountMinor = currency === "USD" ? Number(whole) * 100 + Number(fraction.padEnd(2, "0")) : Number(whole);
  const businessBp = businessBpFromForm(form.get("businessShare"), form.get("businessPercent"));
  if (businessBp === null) throw new ReaderError("Enter the business share as a percentage from 0 to 100.");
  const result = extractSchema.safeParse({ kind: form.get("target"), name: form.get("name"), date: form.get("date"),
    amountMinor, currency, category: form.get("category") || null, businessBp, cardId: form.get("cardId") || null });
  if (!result.success) throw new ReaderError(result.error.issues.some(issue => issue.path[0] === "category") ? "Choose a category from the list." : "Check the reading fields and enter a valid date and amount.");
  return result.data;
}
