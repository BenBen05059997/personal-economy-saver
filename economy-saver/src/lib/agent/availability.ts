/** The sentence for a missing Ask setting: the setting's name inside words a person can read (never a value). */
export const askUnavailable = (name: string) => `Ask isn’t available on this server yet (${name}).`;

/**
 * The first ANTHROPIC_ setting Ask needs that this server lacks, or null. The model is always needed (lib/agent/run.ts); the app's
 * own key and daily allowance only when the household has no key of its own (db/ai-key.ts). Names only, never values.
 */
export function missingAskSetting(householdHasOwnKey: boolean): string | null {
  if (!process.env.ANTHROPIC_TEXT_MODEL?.trim()) return "ANTHROPIC_TEXT_MODEL";
  if (householdHasOwnKey) return null;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return "ANTHROPIC_API_KEY";
  if (!process.env.ANTHROPIC_DAILY_READ_LIMIT?.trim()) return "ANTHROPIC_DAILY_READ_LIMIT";
  return null;
}
