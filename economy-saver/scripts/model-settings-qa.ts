// Optional Next dev preload for the Stage 34 browser checks. No app module imports it.
import { fakeModel, type FakeMode } from "./ai-fake";

const PREFIX = "sk-ant-fictional-stage34-";
const modes = new Map<string, FakeMode>([
  ["good", "good"], ["refused", "down"], ["missing", "missingmodel"], ["credit", "credit"],
  ["unreachable", "unreachable"], ["noimages", "noimages"],
]);

export function withModelSettingsFixture(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const key = [headers.get("x-api-key"), headers.get("authorization")?.replace(/^Bearer /i, "")]
      .find(value => value?.startsWith(PREFIX));
    if (!key) return fetch(input, init);

    const mode = modes.get(key.slice(PREFIX.length));
    const request = new Request(input, init);
    const { origin, pathname } = new URL(request.url);
    if (!mode || origin !== "https://api.anthropic.com") throw new Error("Unexpected fictional model settings request.");

    if (request.method === "GET" && pathname === "/v1/models") {
      if (mode === "down") return new Response(null, { status: 401 });
      if (mode === "credit") return new Response(null, { status: 402 });
      if (mode === "unreachable") throw new Error("Fictional network error.");
      return Response.json({ data: [{ id: "fictional-questions" }, { id: "fictional-documents" }], has_more: false });
    }
    if (request.method === "POST" && pathname === "/v1/messages") return fakeModel(mode).fetch(request);
    throw new Error("Unexpected fictional model settings request.");
  };
}

if (process.env.PES_MODEL_SETTINGS_QA === "1") globalThis.fetch = withModelSettingsFixture(globalThis.fetch);
