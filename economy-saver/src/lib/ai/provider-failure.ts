import { ModelError } from "./types";

export type ProviderFailureKind = "key" | "model" | "credit" | "reach";

/** Retain only known categories from provider error metadata. Never keep a provider message. */
export function providerFailureKind(status?: number, body?: unknown): ProviderFailureKind {
  if (status === 401 || status === 403) return "key";
  if (status === 402 || status === 429) return "credit";
  if (status === 404) return "model";
  const { error } = (body ?? {}) as { error?: { code?: unknown; type?: unknown; status?: unknown; details?: unknown; message?: unknown } };
  const codes = [error?.code, error?.type, error?.status, ...(Array.isArray(error?.details) ? error.details.map(detail => detail?.reason) : [])];
  const message = typeof error?.message === "string" ? error.message : "";
  if (codes.some(code => ["invalid_api_key", "API_KEY_INVALID", "authentication_error"].includes(code as string))
      || /api key (?:not valid|expired)|invalid api key/i.test(message)) return "key";
  if (codes.some(code => ["insufficient_quota", "billing_hard_limit_reached", "rate_limit_exceeded", "RESOURCE_EXHAUSTED"].includes(code as string))
      || /credit balance is too low|insufficient credit|out of credit/i.test(message)) return "credit";
  if (codes.some(code => ["model_not_found", "model_decommissioned", "NOT_FOUND"].includes(code as string))
      || /model (?:does not exist|not found)|unknown model/i.test(message)) return "model";
  return "reach";
}

export function providerFailureOf(error: unknown): ProviderFailureKind {
  return error instanceof ModelError ? error.providerFailure ?? providerFailureKind(error.status) : "reach";
}

export function providerFailureWords(kind: ProviderFailureKind, label: string, model?: string): string {
  if (kind === "key") return `The key was refused by ${label}.`;
  if (kind === "credit") return `${label} says the key is over its limit or out of credit.`;
  if (kind === "model" && model) return `${label} has no model called ${model}.`;
  return `Couldn’t reach ${label}.`;
}

/** A failed model call in a person's words (Ask, the reader and voice fill share them). `timeoutWords` is the surface's own sentence for a call that ran out of time. */
export function modelFailureWords(error: ModelError, timeoutWords: string): string {
  if (error.timeout) return timeoutWords;
  if (error.status === 401 || error.status === 403) return "The AI key was not accepted. Check it in Settings.";
  if (error.status === 429) return "The AI service is busy. Try again in a minute.";
  if (error.status !== undefined) return `The AI service returned HTTP ${error.status}. Try again.`;
  return "Couldn't reach the AI service. Try again.";
}
