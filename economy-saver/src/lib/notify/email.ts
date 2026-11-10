import type { ReminderDigest } from "./digest";

type EmailSettings = { apiKey: string; from: string };

export async function sendReminderEmail(
  settings: EmailSettings, to: string, digest: ReminderDigest, fetcher = fetch, idempotencyKey?: string,
): Promise<boolean> {
  const headers: Record<string, string> = { Authorization: "Bearer " + settings.apiKey, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST", headers, redirect: "manual", signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ from: settings.from, to: [to], subject: digest.title, text: digest.body + "\n\n" + digest.url }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
