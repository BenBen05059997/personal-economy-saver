/** The sentence for a missing Ask setting: the setting's name inside words a person can read (never a value). */
export const askUnavailable = (name: string) => `Ask isn’t available on this server yet (${name}).`;

/**
 * The first AI_ setting Ask needs that this server lacks, or null. A household with its own connection and a model for
 * questions needs none (db/ai-key.ts); otherwise the server default's model, connection and daily allowance. Names only,
 * never values.
 */
export function missingAskSetting(hasOwnConnection: boolean): string | null {
  if (hasOwnConnection) return null;
  if (!process.env.AI_TEXT_MODEL?.trim()) return "AI_TEXT_MODEL";
  const protocol = process.env.AI_PROTOCOL?.trim();
  if (!protocol) return "AI_PROTOCOL";
  if (protocol === "openai" && !process.env.AI_BASE_URL?.trim()) return "AI_BASE_URL";
  if (!process.env.AI_API_KEY?.trim()) return "AI_API_KEY";
  if (!process.env.AI_DAILY_LIMIT?.trim()) return "AI_DAILY_LIMIT";
  return null;
}

/** The host the server default sends questions and documents to, or null when the server has no AI model set up. */
export function serverDefaultHost(): string | null {
  const protocol = process.env.AI_PROTOCOL?.trim();
  if (protocol === "anthropic") return "api.anthropic.com";
  const base = process.env.AI_BASE_URL?.trim();
  if (protocol !== "openai" || !base || !URL.canParse(base)) return null;
  return new URL(base).host;
}
