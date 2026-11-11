import { logSettingProblem } from "@/lib/operator-log";
const ASK_NOT_SET_UP = "Ask isn’t set up on this server yet.";

/** The sentence for a missing Ask setting, in words a person can read; the setting's name goes to the operator log (never a value). */
export function askUnavailable(name: string): string {
  logSettingProblem("ask_not_set_up", `${name} is not set`);
  return ASK_NOT_SET_UP;
}

/** On a server with no AI model of its own (the deployed setup), each household adds its own key: these words say so. */
export const NEEDS_KEY_OWNER = "Add your own AI key in Settings to use Ask.";
export const NEEDS_KEY_MEMBER = "Ask the household’s owner to add an AI key in Settings.";
export const NEEDS_KEY = "This needs an AI key in Settings → Your AI model.";
export const OWN_KEY_HINT = "Use a key with a spending limit, and remove it here when you’re done.";

/** True when no AI_ setting is set at all: the server has no default model, so a household's own key is the only one. */
export const serverHasNoModel = () =>
  !["AI_PROTOCOL", "AI_BASE_URL", "AI_API_KEY", "AI_TEXT_MODEL", "AI_DOCUMENT_MODEL"].some(name => process.env[name]?.trim());

/** Ask's words for a missing model: the household's own-key words on a server with none, else the operator's sentence. */
export function askMissingWords(name: string, owner: boolean): string {
  return serverHasNoModel() ? (owner ? NEEDS_KEY_OWNER : NEEDS_KEY_MEMBER) : askUnavailable(name);
}

/**
 * The first AI_ setting Ask needs that this server lacks, or null. A household with its own connection and a model for
 * questions needs none (db/ai-key.ts); otherwise the server default's model and connection. Names only,
 * never values.
 */
export function missingAskSetting(hasOwnConnection: boolean): string | null {
  if (hasOwnConnection) return null;
  if (!process.env.AI_TEXT_MODEL?.trim()) return "AI_TEXT_MODEL";
  const protocol = process.env.AI_PROTOCOL?.trim();
  if (!protocol) return "AI_PROTOCOL";
  if (protocol === "openai" && !process.env.AI_BASE_URL?.trim()) return "AI_BASE_URL";
  if (!process.env.AI_API_KEY?.trim()) return "AI_API_KEY";
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
