import { APICallError, InvalidResponseDataError, type JSONSchema7 } from "ai";
import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { providerFailureKind } from "./provider-failure";
import { ModelError, type ModelRequest } from "./types";

const MAX_RESPONSE_BYTES = 1024 * 1024;

function sdkOptions(request: ModelRequest): Omit<LanguageModelV4CallOptions, "abortSignal"> {
  const prompt: LanguageModelV4Prompt = [{ role: "system", content: request.system }];
  for (const [index, turn] of request.turns.entries()) {
    if (turn.role === "user") {
      prompt.push({ role: "user", content: turn.parts.map(part => part.type === "text" ? part : {
        type: "file", mediaType: part.type === "pdf" ? "application/pdf" : part.mime,
        data: { type: "data", data: part.base64 },
      }) });
    } else if (turn.role === "tools") {
      prompt.push({ role: "tool", content: turn.results.map(result => ({
        type: "tool-result", toolCallId: result.id, toolName: result.name,
        output: request.connection.protocol === "anthropic" && result.isError
          ? { type: "error-text", value: result.content }
          : { type: "text", value: result.isError ? "Error: " + result.content : result.content },
      })) });
    } else {
      // The SDK serializes the rest of the prompt. The adapters replace this slot with the
      // exact provider message, including extensions such as signed thinking blocks.
      prompt.push({ role: "assistant", content: [{ type: "text", text: String(index) }] });
    }
  }
  return {
    prompt,
    maxOutputTokens: request.maxTokens,
    tools: request.tools?.map(tool => ({
      type: "function", name: tool.name, description: tool.description, inputSchema: tool.schema as JSONSchema7,
      // Anthropic allows at most 20 strict tools; only the one tool a reply must call is strict. Ask checks every input in code.
      ...(request.connection.protocol === "anthropic" && tool.name === request.forceTool && { strict: true }),
    })),
    // Current Anthropic models reject a forced tool_choice (400), so Anthropic always gets auto; its body
    // transform adds the instruction to call the tool. OpenAI-compatible endpoints keep the forced choice.
    toolChoice: request.tools && request.connection.protocol === "anthropic" ? { type: "auto" }
      : request.tools && request.forceTool ? { type: "tool", toolName: request.forceTool } : undefined,
  };
}

function bounded(response: Response): Response {
  if (!response.body) return response;
  let size = 0;
  const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ModelError("The AI service sent too large a reply.");
      controller.enqueue(chunk);
    },
  }));
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** A redirect answer under redirect: "manual": the 3xx itself (Node, Workers) or an opaque redirect (browsers). */
export const isRedirect = (response: Response) => response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);

export function sdkFetch(request: ModelRequest, transform?: (body: string) => string): typeof globalThis.fetch {
  return async (input, init) => {
    const body = transform && typeof init?.body === "string" ? transform(init.body) : init?.body;
    // Workers have no redirect: "error"; "manual" hands back the 3xx itself, which is refused here so the key is never re-sent.
    const response = await (request.fetch ?? globalThis.fetch)(input, { ...init, body, redirect: "manual" });
    if (isRedirect(response)) throw ModelError.redirected();
    return request.connection.protocol === "openai" ? bounded(response) : response;
  };
}

export async function generate(model: LanguageModelV4, request: ModelRequest) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    return await model.doGenerate({ ...sdkOptions(request), abortSignal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw ModelError.timedOut();
    if (error instanceof ModelError) throw error;
    if (APICallError.isInstance(error)) {
      if (error.cause instanceof ModelError) throw error.cause;
      if (error.statusCode && (error.statusCode < 200 || error.statusCode >= 300)) {
        let body: unknown = error.data;
        if (body === undefined && error.responseBody) {
          try { body = JSON.parse(error.responseBody); } catch { /* Only known categories cross this boundary. */ }
        }
        throw new ModelError("The AI service refused the request.", error.statusCode, false, providerFailureKind(error.statusCode, body));
      }
      if (error.statusCode) throw new ModelError("The AI service sent a reply the app could not read.");
    }
    if (InvalidResponseDataError.isInstance(error)) throw new ModelError("The AI service sent a reply the app could not read.");
    throw ModelError.unreachable();
  } finally {
    clearTimeout(timer);
  }
}
