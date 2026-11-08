"use client";

import type { ComponentProps } from "react";
import { amountProblem } from "@/lib/money/amount";

/** An input that says what it accepts, in place of the browser's "Please match the requested format". An empty required field keeps the browser's own message. */
export function CheckedInput({ message, ...props }: ComponentProps<"input"> & { message: string }) {
  return <input {...props}
    onInvalid={event => { event.currentTarget.setCustomValidity(event.currentTarget.validity.valueMissing ? "" : message); props.onInvalid?.(event); }}
    onInput={event => { event.currentTarget.setCustomValidity(""); props.onInput?.(event); }} />;
}

/**
 * A money amount in the household's currency: whole yen, or dollars with up to two decimals. Thousands separators ("1,000")
 * and full-width digits are fine, and anything over ¥100,000,000 or $1,000,000 is refused; the server reads the text by the
 * same function (lib/money/amount.ts). `signed` also accepts a minus sign (a bank balance can be overdrawn).
 */
export function AmountInput({ currency, signed = false, onInput, ...props }: Omit<ComponentProps<"input">, "pattern" | "inputMode"> & { currency: string; signed?: boolean }) {
  return <input {...props} data-voice-currency={currency} data-voice-signed={signed ? "" : undefined} maxLength={props.maxLength ?? 16} inputMode={currency === "JPY" ? "numeric" : "decimal"}
    onInput={event => {
      const field = event.currentTarget;
      // An empty required field keeps the browser's own message.
      field.setCustomValidity(field.value.trim() === "" ? "" : amountProblem(field.value, currency, signed));
      onInput?.(event);
    }} />;
}

/** A percentage from 0 to 100 with up to two decimals. */
export function PercentInput(props: Omit<ComponentProps<"input">, "pattern" | "inputMode">) {
  return <CheckedInput {...props} inputMode="decimal" pattern="[0-9]{1,3}(\.[0-9]{1,2})?" message="Enter a percentage, like 25 or 12.5" />;
}
