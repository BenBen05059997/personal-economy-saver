import { z } from "zod";

type EmailSettings = { apiKey: string; from: string };
type PushSettings = { publicKey: string; privateKey: string; subject: string };

type Setting<T> = { value: T; problem: null } | { value: null; problem: string };

function readSetting<T>(names: readonly string[], parse: (values: string[]) => T): Setting<T> {
  const values = names.map(name => process.env[name]?.trim() ?? "");
  const missing = values.findIndex(value => value === "");
  return missing === -1 ? { value: parse(values), problem: null } : { value: null, problem: names[missing] + " is not set." };
}

const publicKey = /^B[A-Za-z0-9_-]{86}$/;
const privateKey = /^[A-Za-z0-9_-]{43}$/;

export function reminderSettings() {
  const email = readSetting<EmailSettings>(["RESEND_API_KEY", "REMINDER_FROM"], ([apiKey, from]) => ({ apiKey, from }));
  let push = readSetting<PushSettings>(["WEB_PUSH_PUBLIC_KEY", "WEB_PUSH_PRIVATE_KEY", "WEB_PUSH_SUBJECT"],
    ([publicKey, privateKey, subject]) => ({ publicKey, privateKey, subject }));
  if (push.value) {
    const { publicKey: pub, privateKey: key, subject } = push.value;
    if (!publicKey.test(pub)) push = { value: null, problem: "WEB_PUSH_PUBLIC_KEY must be a base64url P-256 public key." };
    else if (!privateKey.test(key)) push = { value: null, problem: "WEB_PUSH_PRIVATE_KEY must be a base64url P-256 private key." };
    else if (!(subject.startsWith("mailto:") && z.string().email().safeParse(subject.slice(7)).success)
      && !(URL.canParse(subject) && new URL(subject).protocol === "https:")) {
      push = { value: null, problem: "WEB_PUSH_SUBJECT must be a mailto or HTTPS URL." };
    }
  }
  return { email, push };
}
