import { z } from "zod";
import { checkBaseUrl, localAllowed } from "./endpoint";
import { providerById } from "./providers";
import { providerFailureKind } from "./provider-failure";
import { TESTED } from "./tested";
import { isRedirect } from "./sdk";
import { ModelError } from "./types";

const LIST_BUDGET_MS = 10_000;

type ListedModel = { id: string; tools?: boolean; images?: boolean };
export type ModelChoice = ListedModel & { tested: boolean };
export type ModelListConnection = { provider: string; baseUrl: string; key: string | null };

const modelSchema = z.object({
  id: z.string().min(1),
  capabilities: z.object({ function_calling: z.boolean().optional(), vision: z.boolean().optional() }).nullish(),
  supported_parameters: z.array(z.string()).nullish(),
  architecture: z.object({ input_modalities: z.array(z.string()).nullish() }).nullish(),
});
const listSchema = z.object({ data: z.array(modelSchema), has_more: z.boolean().optional(), last_id: z.string().nullish() });
const unreadable = () => new ModelError("The AI service sent a model list the app could not read.");

export function markListedModels(provider: string, models: ListedModel[], tested: typeof TESTED = TESTED): ModelChoice[] {
  const known = new Set(tested.filter(item => item.provider === provider).map(item => item.model));
  return models.map(model => ({ ...model, tested: known.has(model.id) })).sort((a, b) => Number(b.tested) - Number(a.tested));
}

/** Reads provider-reported metadata. A missing capability stays unknown. */
export async function listModels(connection: ModelListConnection, opts: { fetch?: typeof globalThis.fetch; appUrl?: URL } = {}): Promise<ListedModel[]> {
  const provider = providerById(connection.provider);
  if (!provider) throw new ModelError("Choose a provider.");
  const raw = process.env.APP_URL?.trim();
  const appUrl = opts.appUrl ?? (raw ? new URL(raw) : undefined);
  const base = checkBaseUrl(provider.baseUrl ?? connection.baseUrl, { allowLocal: appUrl ? localAllowed(appUrl) : false });
  const anthropic = provider.protocol === "anthropic";
  const endpoint = new URL(base + (anthropic ? "/v1/models" : "/models"));
  const headers = new Headers({ Accept: "application/json" });
  if (anthropic) {
    headers.set("anthropic-version", "2023-06-01");
    if (connection.key) headers.set("x-api-key", connection.key);
    endpoint.searchParams.set("limit", "1000");
  } else if (connection.key) {
    headers.set("Authorization", `Bearer ${connection.key}`);
  }
  const signal = AbortSignal.timeout(LIST_BUDGET_MS);
  const models = new Map<string, ListedModel>();
  const cursors = new Set<string>();
  try {
    while (true) {
      const response = await (opts.fetch ?? globalThis.fetch)(endpoint.href, { method: "GET", headers, redirect: "manual", cache: "no-store", signal });
      if (isRedirect(response)) throw ModelError.redirected();
      const json: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ModelError("The AI service refused the request.", response.status, false, providerFailureKind(response.status, json));
      // Mistral documents model cards both as a data envelope and as a bare array.
      const parsed = listSchema.safeParse(Array.isArray(json) && provider.id === "mistral" ? { data: json } : json);
      if (!parsed.success) throw unreadable();
      for (const row of parsed.data.data) {
        if (connection.key && row.id.includes(connection.key)) throw unreadable();
        const tools = row.capabilities?.function_calling ?? row.supported_parameters?.includes("tools");
        const images = row.capabilities?.vision ?? row.architecture?.input_modalities?.includes("image");
        models.set(row.id, { id: row.id, ...(tools !== undefined && { tools }), ...(images !== undefined && { images }) });
      }
      if (!anthropic || !parsed.data.has_more) return [...models.values()];
      const cursor = parsed.data.last_id;
      if (!cursor || cursors.has(cursor) || (connection.key && cursor.includes(connection.key))) throw unreadable();
      cursors.add(cursor);
      endpoint.searchParams.set("after_id", cursor);
    }
  } catch (error) {
    if (error instanceof ModelError) throw error;
    throw signal.aborted ? ModelError.timedOut() : ModelError.unreachable();
  }
}
