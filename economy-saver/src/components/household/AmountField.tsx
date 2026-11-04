"use client";

import type { ComponentProps } from "react";
import { AmountInput } from "@/components/ui/CheckedInput";

const SIGNS: Record<string, string> = { JPY: "¥", USD: "$", EUR: "€", GBP: "£" };

/** An amount input with the currency sign inside the field, so the label does not have to say which currency. */
export function AmountField({ currency, ...props }: ComponentProps<typeof AmountInput>) {
  return <span className="amount-field"><span className="amount-sign" aria-hidden="true">{SIGNS[currency] ?? currency}</span><AmountInput currency={currency} {...props} /></span>;
}
