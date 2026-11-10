/**
 * Text that looks like an API key (D56): OpenAI-style `sk-` keys (Anthropic, OpenRouter and OpenAI projects included),
 * Groq's `gsk_` and Google's `AIza`, long enough to be a real key and not part of a longer word. Such text is refused
 * wherever it would be sent to a model or kept: an Ask question, a memory or note, a model name.
 */
const KEY_TEXT = /(?:^|[^A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})/;

export const looksLikeApiKey = (text: string) => KEY_TEXT.test(text);

export const KEY_TEXT_WORDS = "That looks like an API key. Paste it in Settings → Your AI model. It was not sent or saved.";
