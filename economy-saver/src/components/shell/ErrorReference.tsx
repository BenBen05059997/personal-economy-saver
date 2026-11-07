"use client";
import { useSyncExternalStore } from "react";
import { RAY_COOKIE } from "@/lib/ray";

const rayNow = () => document.cookie.split("; ").find(part => part.startsWith(RAY_COOKIE + "="))?.slice(RAY_COOKIE.length + 1) ?? null;
const never = () => () => {};

/** "Reference: …" for a person to quote: the Cloudflare ray of the request when known, else the error's digest, else nothing. */
export function ErrorReference({ digest }: { digest?: string }) {
  const ray = useSyncExternalStore(never, rayNow, () => null);
  const reference = ray ?? digest;
  return reference ? <p className="ui-hint">Reference: {reference}</p> : null;
}
