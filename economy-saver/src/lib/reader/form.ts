import { extractSchema } from "./extract";
import { ReaderError } from "./settings";

export function readingForm(form: FormData) {
  const amount = String(form.get("amount") ?? "").trim();
  const currency = form.get("currency");
  const valid = currency === "USD" ? /^\d{1,14}(\.\d{1,2})?$/ : /^\d{1,15}$/;
  if (!valid.test(amount)) throw new ReaderError("Enter a positive amount in the selected currency.");
  const [whole, fraction = ""] = amount.split(".");
  const amountMinor = currency === "USD" ? Number(whole) * 100 + Number(fraction.padEnd(2, "0")) : Number(whole);
  const result = extractSchema.safeParse({ kind: form.get("target"), name: form.get("name"), date: form.get("date"),
    amountMinor, currency, category: form.get("category") || null, cardId: form.get("cardId") || null });
  if (!result.success) throw new ReaderError("Check the reading fields and enter a valid date and amount.");
  return result.data;
}
