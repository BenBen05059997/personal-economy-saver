import { and, eq, sql } from "drizzle-orm";
import { pgSchema, text, uuid } from "drizzle-orm/pg-core";
import { InputError } from "./input-error";
import { checkBaseUrl, localAllowed } from "@/lib/ai/endpoint";
import { readCheck, type ConnectionCheck } from "@/lib/ai/check";
import { providerById } from "@/lib/ai/providers";
import { providerFailureWords } from "@/lib/ai/provider-failure";
import { isTested } from "@/lib/ai/tested";
import type { ModelListConnection } from "@/lib/ai/list-models";
import type { Connection } from "@/lib/ai/types";
import { recordEvent, requireHousehold, withHousehold, type Db } from "./household";
import { households } from "./schema";

/** Messages contain configuration names and fixed text only; safe for a response. */
export class AiKeyError extends Error {}
const anthropicHost = "https://api.anthropic.com";
// The Vault secret keeps the name it was first saved under, so keys saved earlier keep working.
const secretName = (hid: string) => `household:${hid}:anthropic`;
// Vault is an existing private extension schema, outside the application's migrations.
const vault = pgSchema("vault");
const secrets = vault.table("secrets", { id: uuid("id").notNull(), name: text("name") });
const decrypted = vault.table("decrypted_secrets", { id: uuid("id").notNull(), name: text("name"), key: text("decrypted_secret") });
const STORAGE_DOWN = "AI key storage is unavailable. Check DATABASE_URL and Supabase Vault permissions.";

async function lockedHousehold(db: Db, hid: string) {
  const [household] = await db.select().from(households).where(eq(households.id, hid)).for("update");
  if (!household) throw new AiKeyError("Household no longer exists");
  return household;
}

const settingOf = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new AiKeyError(`${name} is not set`);
  return value;
};

/** The app's own address decides whether a model on this machine may be used (lib/ai/endpoint.ts). */
const allowLocal = () => { const raw = process.env.APP_URL?.trim(); return raw ? localAllowed(new URL(raw)) : false; };

// A saved key is sealed a second time with the Worker-only AI_KEY_SEAL_KEY before it goes into Vault (D33), the way MCP tokens
// are sealed with MCP_TOKEN_KEY: AES-GCM, a fresh 12-byte IV, the household id as associated data (a sealed text copied to
// another household does not open). The stored text is `pes-ai1.` + base64url(iv + ciphertext).
const SEAL_PREFIX = "pes-ai1.";
const sealAad = (hid: string) => new TextEncoder().encode(`personal-economy-saver/ai-key/v1/${hid}`);
async function sealKey() {
  const raw = process.env.AI_KEY_SEAL_KEY;
  if (!raw) throw new AiKeyError("AI_KEY_SEAL_KEY is not set");
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== raw) throw new AiKeyError("AI_KEY_SEAL_KEY must be 32 bytes encoded as unpadded base64url");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** The text to put in Vault for this household's key. */
export async function sealAiKey(hid: string, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: sealAad(hid) }, await sealKey(), new TextEncoder().encode(key));
  return SEAL_PREFIX + Buffer.concat([iv, new Uint8Array(cipher)]).toString("base64url");
}
/** The key inside a sealed Vault text. A value saved before sealing existed is refused, never read as a key. */
export async function unsealAiKey(hid: string, stored: string): Promise<string> {
  const key = await sealKey();
  if (!stored.startsWith(SEAL_PREFIX)) throw new AiKeyError("Your saved AI key predates sealed storage. Save your key again in Settings.");
  const bytes = Buffer.from(stored.slice(SEAL_PREFIX.length), "base64url");
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: sealAad(hid) }, key, bytes.subarray(12));
    return new TextDecoder().decode(plain);
  } catch { throw new AiKeyError("Saved AI key could not be opened. Save your key again in Settings."); }
}

type SavedKey = Pick<typeof households.$inferSelect, "aiKeySecretId" | "aiBaseUrl" | "aiProvider">;

// Vault is private to the owner. Match the scoped metadata so a concurrent host change cannot move a key.
async function vaultKey(tx: Db, hid: string, expected: SavedKey): Promise<string | null> {
  if (!expected.aiKeySecretId || !expected.aiBaseUrl || !expected.aiProvider) return null;
  const [secret] = await tx.select({ key: decrypted.key }).from(decrypted)
    .innerJoin(households, eq(households.aiKeySecretId, decrypted.id))
    .where(and(eq(households.id, hid), eq(decrypted.name, secretName(hid)), eq(decrypted.id, expected.aiKeySecretId),
      eq(households.aiBaseUrl, expected.aiBaseUrl), eq(households.aiProvider, expected.aiProvider)));
  return secret?.key ? unsealAiKey(hid, secret.key) : null;
}

/** Which model the caller will use. */
type ModelNeed = "text" | "document";

const NO_MODEL = (need: ModelNeed) => new AiKeyError(`Your AI model has no model for ${need === "text" ? "questions" : "documents"}. Choose one in Settings.`);

/**
 * The connection for ONE model call (D56). Call immediately before EACH call, including retries. A household with its own
 * model (ai_protocol set) gets it: its saved address (checked again here), its Vault key or none, the model for the need.
 * Any other household gets the server default from the AI_ settings. No call is capped (no daily allowance or app-wide
 * budget). Never log the return value.
 */
export async function aiConnection(db: Db, householdId: string, need: ModelNeed): Promise<Connection> {
  const hid = requireHousehold(householdId);
  try {
    const [household] = await withHousehold(db, hid, async tx => tx.select().from(households).where(eq(households.id, hid)));
    if (!household) throw new AiKeyError("Household no longer exists");
    if (household.aiProtocol && household.aiBaseUrl) {
      const model = need === "text" ? household.aiTextModel : household.aiDocumentModel;
      if (!model) throw NO_MODEL(need);
      let baseUrl: string;
      try { baseUrl = checkBaseUrl(household.aiBaseUrl, { allowLocal: allowLocal() }); }
      catch (error) { if (error instanceof InputError) throw new AiKeyError("Your AI model's address can't be used. Choose it again in Settings."); throw error; }
      const key = household.aiKeySecretId ? await vaultKey(db, hid, household) : null;
      if (household.aiKeySecretId && !key) throw new AiKeyError("Saved AI key is unavailable. Replace it in Settings.");
      if (!key && household.aiProvider !== "custom") throw new AiKeyError("Your AI model has no key. Add one in Settings.");
      return { protocol: household.aiProtocol as Connection["protocol"], baseUrl, key,
        textModel: household.aiTextModel, documentModel: household.aiDocumentModel, own: true } satisfies Connection;
    }
    const wanted = settingOf(need === "text" ? "AI_TEXT_MODEL" : "AI_DOCUMENT_MODEL");
    const models = {
      textModel: need === "text" ? wanted : process.env.AI_TEXT_MODEL?.trim() || null,
      documentModel: need === "document" ? wanted : process.env.AI_DOCUMENT_MODEL?.trim() || null,
    };
    const protocol = settingOf("AI_PROTOCOL");
    if (protocol !== "anthropic" && protocol !== "openai") throw new AiKeyError("AI_PROTOCOL must be anthropic or openai");
    const baseUrl = protocol === "anthropic" ? anthropicHost : settingOf("AI_BASE_URL");
    const key = settingOf("AI_API_KEY");
    return { protocol, baseUrl, key, ...models, own: false } satisfies Connection;
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError(STORAGE_DOWN);
  }
}

type ConnectionInput = {
  provider: string; baseUrl: string; textModel: string; documentModel: string; sameForDocuments: boolean; key: string;
};
type CheckFn = (connection: Connection, opts: { testedText: boolean }) => Promise<ConnectionCheck>;

const MODEL_SHAPE = /^[^\s\u0000-\u001f\u007f]{1,200}$/;
const modelName = (value: string, what: string) => {
  const v = value.trim();
  if (!MODEL_SHAPE.test(v)) throw new AiKeyError(`Enter the model for ${what} (up to 200 characters, no spaces).`);
  return v;
};
const KEY_SHAPE = /^[^\s\u0000-\u001f\u007f]{1,500}$/;
const hintOf = (key: string) => `…${key.slice(-4)}`;

function chosenEndpoint(input: Pick<ConnectionInput, "provider" | "baseUrl" | "key">, signedIn: boolean) {
  const provider = providerById(input.provider);
  if (!provider) throw new AiKeyError("Choose a provider.");
  if (provider.id === "custom" && !signedIn) throw new AiKeyError("A custom address needs an account. Sign in from Settings → Account.");
  let baseUrl: string;
  try { baseUrl = checkBaseUrl(provider.baseUrl ?? input.baseUrl, { allowLocal: allowLocal() }); }
  catch (error) { if (error instanceof InputError) throw new AiKeyError(error.message); throw error; }
  const newKey = input.key.trim();
  if (newKey && !KEY_SHAPE.test(newKey)) throw new AiKeyError("The key must be 1 to 500 characters with no spaces.");
  return { provider, baseUrl, newKey };
}

async function keyForEndpoint(db: Db, hid: string, saved: SavedKey, provider: string, baseUrl: string, newKey: string) {
  const sameHost = saved.aiProvider === provider && saved.aiBaseUrl === baseUrl;
  const key = newKey || (sameHost && saved.aiKeySecretId ? await vaultKey(db, hid, saved) : null);
  if (!key && provider !== "custom") throw new AiKeyError("Enter the key for this provider.");
  return key;
}

/** A one-use connection for the model catalogue. It never reads the app default or changes a saved key. */
export async function modelListConnection(db: Db, householdId: string, input: Pick<ConnectionInput, "provider" | "baseUrl" | "key">): Promise<ModelListConnection> {
  const hid = requireHousehold(householdId);
  try {
    const [saved] = await withHousehold(db, hid, tx => tx.select({
      isDemo: households.isDemo, aiProvider: households.aiProvider, aiBaseUrl: households.aiBaseUrl, aiKeySecretId: households.aiKeySecretId,
    }).from(households).where(eq(households.id, hid)));
    if (!saved) throw new AiKeyError("Household no longer exists");
    const { provider, baseUrl, newKey } = chosenEndpoint(input, !saved.isDemo);
    const key = await keyForEndpoint(db, hid, saved, provider.id, baseUrl, newKey);
    return { provider: provider.id, baseUrl, key };
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError(STORAGE_DOWN);
  }
}

async function writeSecret(tx: Db, household: typeof households.$inferSelect, hid: string, plainKey: string) {
  const key = await sealAiKey(hid, plainKey);
  const name = secretName(hid);
  if (household.aiKeySecretId) {
    // The id pointer alone cannot authorize changing another household's secret.
    const existing = await tx.select({ id: secrets.id }).from(secrets)
      .innerJoin(households, eq(households.aiKeySecretId, secrets.id))
      .where(and(eq(households.id, hid), eq(secrets.name, name)));
    if (!existing.length) throw new AiKeyError("Saved AI key ownership could not be verified");
    await tx.select({ updated: sql`updated` }).from(sql`(select vault.update_secret(${household.aiKeySecretId}::uuid, ${key}, ${name}) as updated) as changed_secret`);
  } else {
    const [secret] = await tx.select({ id: sql<string>`id` }).from(sql`(select vault.create_secret(${key}, ${name}, 'Household AI key') as id) as created_secret`);
    await tx.update(households).set({ aiKeySecretId: secret.id }).where(eq(households.id, hid));
  }
}

/**
 * Saves the household's own model (D56): validates, checks the text model and the document model, and records one event.
 * A missing tool call or failed image read blocks the save. The check runs before the household row is locked.
 * `signedIn` is false for Try it households, which may use the listed providers only.
 */
export async function saveHouseholdConnection(db: Db, householdId: string, input: ConnectionInput, opts: { signedIn: boolean; check: CheckFn }) {
  const hid = requireHousehold(householdId);
  const { provider, baseUrl, newKey } = chosenEndpoint(input, opts.signedIn);
  const textModel = modelName(input.textModel, "questions");
  const documentModel = input.sameForDocuments ? textModel : modelName(input.documentModel, "documents");
  try {
    const [before] = await withHousehold(db, hid, async tx => tx.select().from(households).where(eq(households.id, hid)));
    if (!before) throw new AiKeyError("Household no longer exists");
    // Without a new key, the saved one is kept only for the same provider and address; a key never moves to another host.
    const key = await keyForEndpoint(db, hid, before, provider.id, baseUrl, newKey);
    const connection: Connection = { protocol: provider.protocol, baseUrl, key, textModel, documentModel, own: true };
    if (key && [textModel, documentModel].includes(key)) throw new AiKeyError("Enter a model ID in the model fields and the key in Key.");
    const check = await opts.check(connection, { testedText: isTested(provider.id, textModel) });
    const label = provider.id === "custom" ? "your provider" : provider.label;
    const result = {
      ...check,
      failed: check.failed.map(({ name, why, providerFailure }) => ({
        name, why: providerFailure ? providerFailureWords(providerFailure, label, name === "reads_images" ? documentModel : textModel) : why,
      })),
    };
    const refused = check.failed.find(f => f.name === "uses_tools" || f.name === "reads_images");
    if (refused?.providerFailure) {
      throw new AiKeyError(providerFailureWords(refused.providerFailure, label, refused.name === "reads_images" ? documentModel : textModel));
    }
    if (refused?.name === "uses_tools") {
      throw new AiKeyError(`This model can't be used: it did not call the app's tools, so it can't answer from your numbers. ${refused.why} Choose a model that supports tool calling.`);
    }
    if (refused?.name === "reads_images") {
      throw new AiKeyError(`This document model can't be used: ${refused.why} Choose a model that reads images.`);
    }
    await db.transaction(async tx => {
      const household = await lockedHousehold(tx, hid);
      if (!newKey && (household.aiProvider !== before.aiProvider || household.aiBaseUrl !== before.aiBaseUrl
        || household.aiKeySecretId !== before.aiKeySecretId || (key && await vaultKey(tx, hid, household) !== key))) {
        throw new AiKeyError("The saved key changed during the check. Reload Settings and try again.");
      }
      if (newKey) await writeSecret(tx, household, hid, newKey);
      else if (!key && household.aiKeySecretId) await dropSecret(tx, household, hid);
      await tx.update(households).set({
        aiProvider: provider.id, aiProtocol: provider.protocol, aiBaseUrl: baseUrl, aiTextModel: textModel, aiDocumentModel: documentModel,
        aiCheck: result, aiKeyHint: key ? hintOf(key) : null, ...(!key && { aiKeySecretId: null }),
      }).where(eq(households.id, hid));
      await recordEvent(tx, hid, { madeBy: "form", kind: "ai_model_changed", title: `AI model changed to ${provider.label}, ${textModel}` });
    });
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError(STORAGE_DOWN);
  }
}

async function dropSecret(tx: Db, household: typeof households.$inferSelect, hid: string) {
  if (!household.aiKeySecretId) return;
  const deleted = await tx.delete(secrets).where(and(eq(secrets.id, household.aiKeySecretId), eq(secrets.name, secretName(hid)),
    sql`exists (select 1 from ${households} where ${households.id} = ${hid}::uuid and ${households.aiKeySecretId} = ${secrets.id})`)).returning({ id: secrets.id });
  if (deleted.length !== 1) throw new AiKeyError("Saved AI key ownership could not be verified");
}

/**
 * Removes the household's own model: its key from Vault and every ai_ connection column. Caller must hold the household
 * row lock in its transaction (Reset, upgrade, the sweeper and deletion call this). Safe when nothing is saved.
 */
export async function deleteHouseholdKey(tx: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  try {
    const household = await lockedHousehold(tx, hid);
    await dropSecret(tx, household, hid);
    await tx.update(households).set({ aiKeySecretId: null, aiKeyHint: null, aiProvider: null, aiProtocol: null, aiBaseUrl: null,
      aiTextModel: null, aiDocumentModel: null, aiCheck: null }).where(eq(households.id, hid));
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError("AI key deletion is unavailable. Check Supabase Vault permissions.");
  }
}

/** Settings → "Use this app's default": clears the household's own model and records one event. */
export async function deleteHouseholdConnection(db: Db, householdId: string) {
  const hid = requireHousehold(householdId);
  try {
    await db.transaction(async tx => {
      const household = await lockedHousehold(tx, hid);
      if (!household.aiProtocol && !household.aiKeySecretId) return;
      await deleteHouseholdKey(tx, hid);
      await recordEvent(tx, hid, { madeBy: "form", kind: "ai_model_changed", title: "AI model changed to this app's default" });
    });
  } catch (error) {
    if (error instanceof AiKeyError) throw error;
    throw new AiKeyError(STORAGE_DOWN);
  }
}

type ConnectionView = {
  provider: string; label: string; host: string; baseUrl: string; textModel: string | null; documentModel: string | null;
  sameForDocuments: boolean; hint: string | null; tested: boolean; check: ConnectionCheck | null;
};

/** What Settings shows about the household's own model, or null when it uses the default. Never the key. */
export async function connectionView(db: Db, householdId: string): Promise<ConnectionView | null> {
  const hid = requireHousehold(householdId);
  const [h] = await db.select({ provider: households.aiProvider, baseUrl: households.aiBaseUrl, text: households.aiTextModel,
    doc: households.aiDocumentModel, hint: households.aiKeyHint, check: households.aiCheck }).from(households).where(eq(households.id, hid));
  if (!h?.provider || !h.baseUrl) return null;
  return { provider: h.provider, label: providerById(h.provider)?.label ?? h.provider, host: new URL(h.baseUrl).host, baseUrl: h.baseUrl,
    textModel: h.text, documentModel: h.doc, sameForDocuments: h.text === h.doc, hint: h.hint,
    tested: Boolean(h.text) && isTested(h.provider, h.text!), check: readCheck(h.check) };
}
