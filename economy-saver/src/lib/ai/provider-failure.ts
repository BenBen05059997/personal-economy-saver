import { ModelError } from "./types";

export type ProviderFailureKind = "key" | "model" | "credit" | "reach";

/** Retain only known categories from provider error metadata. Never keep a provider message. */
export function providerFailureKind(status?: number, body?: unknown): ProviderFailureKind {
  if (status === 401 || status === 403) return "key";
  if (status === 402 || status === 429) return "credit";
  if (status === 404) return "model";
  const { error } = (body ?? {}) as { error?: { code?: unknown; type?: unknown; details?: unknown } };
  const codes = [error?.code, error?.type, ...(Array.isArray(error?.details) ? error.details.map(detail => detail?.reason) : [])];
  if (codes.some(code => ["invalid_api_key", "API_KEY_INVALID", "authentication_error"].includes(code as string))) return "key";
  if (codes.some(code => ["insufficient_quota", "billing_hard_limit_reached", "rate_limit_exceeded"].includes(code as string))) return "credit";
  if (codes.some(code => ["model_not_found", "model_decommissioned"].includes(code as string))) return "model";
  return "reach";
}

export function providerFailureWords(error: unknown, label: string, model?: string): string {
  const kind = error instanceof ModelError ? error.providerFailure ?? providerFailureKind(error.status) : "reach";
  if (kind === "key") return `The key was refused by ${label}.`;
  if (kind === "credit") return `${label} says the key is over its limit or out of credit.`;
  if (kind === "model" && model) return `${label} has no model called ${model}.`;
  return `Couldn’t reach ${label}.`;
}
