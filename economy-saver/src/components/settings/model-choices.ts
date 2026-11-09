import type { ModelChoice } from "@/lib/ai/list-models";

type Catalogue = { models: ModelChoice[]; problem: string };
type FetchOptions = { delayMs?: number; fetch?: typeof globalThis.fetch };

export function modelsFor(models: ModelChoice[], purpose: "questions" | "documents", same: boolean): ModelChoice[] {
  return models.filter(model => purpose === "documents" ? model.images !== false : model.tools !== false && (!same || model.images !== false));
}

/** One request after typing settles. Cancelling also ignores a response that was already on its way. */
export function scheduleModelChoices(body: () => URLSearchParams, done: (result: Catalogue) => void, opts: FetchOptions = {}) {
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(async () => {
    const read = async (): Promise<Catalogue> => {
      const response = await (opts.fetch ?? globalThis.fetch)("/api/settings/ai-model/models", {
        method: "POST", body: body(), cache: "no-store", signal,
      });
      if (!response.ok) return { models: [], problem: (await response.text()) || "Couldn’t load models. You can type a model ID." };
      return { models: ((await response.json()) as { models: ModelChoice[] }).models, problem: "" };
    };
    const result = await read().catch(() => ({ models: [], problem: "Couldn’t load models. You can type a model ID." }));
    if (!signal.aborted) done(result);
  }, opts.delayMs ?? 350);
  return () => { clearTimeout(timer); controller.abort(); };
}
