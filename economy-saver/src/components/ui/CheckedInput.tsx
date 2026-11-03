"use client";

import type { ComponentProps } from "react";

/** An input that says what it accepts, in place of the browser's "Please match the requested format". An empty required field keeps the browser's own message. */
export function CheckedInput({ message, ...props }: ComponentProps<"input"> & { message: string }) {
  return <input {...props}
    onInvalid={event => { event.currentTarget.setCustomValidity(event.currentTarget.validity.valueMissing ? "" : message); props.onInvalid?.(event); }}
    onInput={event => { event.currentTarget.setCustomValidity(""); props.onInput?.(event); }} />;
}

/** A money amount in the household's currency: whole yen, or dollars with up to two decimals. `signed` also accepts a minus sign (a bank balance can be overdrawn). */
export function AmountInput({ currency, signed = false, ...props }: Omit<ComponentProps<"input">, "pattern" | "inputMode"> & { currency: string; signed?: boolean }) {
  const jpy = currency === "JPY";
  const sign = signed ? "-?" : "";
  return <CheckedInput {...props} maxLength={props.maxLength ?? 16} inputMode={jpy ? "numeric" : "decimal"}
    pattern={sign + (jpy ? "[0-9]+" : "[0-9]+(\\.[0-9]{1,2})?")}
    message={jpy ? (signed ? "Enter a whole number of yen, like 5000 or -5000" : "Enter a whole number of yen, like 5000")
      : signed ? "Enter an amount in dollars, like 400, 400.50 or -400" : "Enter an amount in dollars, like 400 or 400.50"} />;
}

/** A percentage from 0 to 100 with up to two decimals. */
export function PercentInput(props: Omit<ComponentProps<"input">, "pattern" | "inputMode">) {
  return <CheckedInput {...props} inputMode="decimal" pattern="[0-9]{1,3}(\.[0-9]{1,2})?" message="Enter a percentage, like 25 or 12.5" />;
}
