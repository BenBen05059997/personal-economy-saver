import { z } from "zod";

/** How long one outgoing email or push request may take. */
export const NOTIFY_TIMEOUT_MS = 10_000;

type EmailSettings = { apiKey: string; from: string };
type PushSettings = { publicKey: string; privateKey: string; subject: string };

/** `problem` names the setting for the operator (health, logs); `words` is what the person sees. */
type Setting<T> = { value: T; problem: null; words: null } | { value: null; problem: string; words: string };

function readSetting<T>(names: readonly string[], parse: (values: string[]) => T, words: string): Setting<T> {
  const values = names.map(name => process.env[name]?.trim() ?? "");
  const missing = values.findIndex(value => value === "");
  return missing === -1 ? { value: parse(values), problem: null, words: null } : { value: null, problem: names[missing] + " is not set.", words };
}

const publicKey = /^B[A-Za-z0-9_-]{86}$/;
const privateKey = /^[A-Za-z0-9_-]{43}$/;

const EMAIL_WORDS = "Email reminders aren’t set up on this server.";
const PUSH_WORDS = "Push reminders aren’t set up on this server.";

export function reminderSettings() {
  const email = readSetting<EmailSettings>(["RESEND_API_KEY", "REMINDER_FROM"], ([apiKey, from]) => ({ apiKey, from }), EMAIL_WORDS);
  let push = readSetting<PushSettings>(["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT"],
    ([publicKey, privateKey, subject]) => ({ publicKey, privateKey, subject }), PUSH_WORDS);
  if (push.value) {
    const { publicKey: pub, privateKey: key, subject } = push.value;
    if (!publicKey.test(pub)) push = { value: null, problem: "WEB_PUSH_PUBLIC_KEY must be a base64url P-256 public key.", words: PUSH_WORDS };
    else if (!privateKey.test(key)) push = { value: null, problem: "WEB_PUSH_PRIVATE_KEY must be a base64url P-256 private key.", words: PUSH_WORDS };
    else if (!(subject.startsWith("mailto:") && z.string().email().safeParse(subject.slice(7)).success)
      && !(URL.canParse(subject) && new URL(subject).protocol === "https:")) {
      push = { value: null, problem: "WEB_PUSH_SUBJECT must be a mailto or HTTPS URL.", words: PUSH_WORDS };
    }
  }
  return { email, push };
}
