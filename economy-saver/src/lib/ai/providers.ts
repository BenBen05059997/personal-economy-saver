import type { Protocol } from "./types";

/**
 * The listed providers (D56). Base URLs are from each provider's own docs; no model names are hardcoded anywhere.
 * `tokenParam` is the Chat Completions field that caps the reply: OpenAI deprecates max_tokens (o-series reject it) and
 * Groq lists it as deprecated; Mistral, Ollama and the rest document max_tokens only.
 */
type Provider = { id: string; label: string; protocol: Protocol; baseUrl: string | null; tokenParam?: "max_tokens" | "max_completion_tokens" };

export const PROVIDERS: readonly Provider[] = [
  { id: "anthropic", label: "Anthropic", protocol: "anthropic", baseUrl: "https://api.anthropic.com" },
  { id: "openai", label: "OpenAI", protocol: "openai", baseUrl: "https://api.openai.com/v1", tokenParam: "max_completion_tokens" },
  { id: "gemini", label: "Google Gemini", protocol: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { id: "openrouter", label: "OpenRouter", protocol: "openai", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", protocol: "openai", baseUrl: "https://api.groq.com/openai/v1", tokenParam: "max_completion_tokens" },
  { id: "mistral", label: "Mistral", protocol: "openai", baseUrl: "https://api.mistral.ai/v1" },
  { id: "custom", label: "Other (OpenAI-compatible address)", protocol: "openai", baseUrl: null },
];

/** The cap field for an address: the listed provider's, else max_tokens (what self-hosted servers document). */
export const tokenParamFor = (baseUrl: string) =>
  PROVIDERS.find(p => p.baseUrl === baseUrl)?.tokenParam ?? "max_tokens";

export const providerById = (id: string | null | undefined) => PROVIDERS.find(p => p.id === id);
