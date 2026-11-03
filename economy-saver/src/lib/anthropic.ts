import Anthropic from "@anthropic-ai/sdk";

/**
 * The one way the app calls Claude. The key comes from aiKey() (the household's own or the owner's capped default),
 * never from the environment; the host is fixed; no retries, because every attempt must reserve its own allowance.
 */
export function anthropicClient(apiKey: string, timeout: number, fetch?: typeof globalThis.fetch) {
  return new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", fetch, maxRetries: 0, timeout, logLevel: "off" });
}
