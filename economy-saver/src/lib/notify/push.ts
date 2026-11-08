import type { ReminderDigest } from "./digest";

type Bytes = Uint8Array<ArrayBuffer>;
export type PushSubscriptionData = { endpoint: string; p256dh: string; auth: string };
type PushSettings = { publicKey: string; privateKey: string; subject: string };
type PushResult = "sent" | "gone" | "failed";

const ENCODER = new TextEncoder();
const RECORD_SIZE = 4096;
const MAX_PAYLOAD = 3993;
const HOUR_MS = 3_600_000;
const ECDH = { name: "ECDH", namedCurve: "P-256" };
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const GOOGLE = "fcm.googleapis.com";
const MOZILLA = "push.services.mozilla.com";

function fromBase64url(value: string): Bytes {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid push key");
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
  if (toBase64url(bytes) !== value) throw new Error("Invalid push key");
  return bytes;
}

function toBase64url(bytes: Bytes): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function concat(...parts: Bytes[]): Bytes {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function publicPoint(value: string): Bytes {
  if (value.length !== 87) throw new Error("Invalid push public key");
  const bytes = fromBase64url(value);
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Invalid push public key");
  return bytes;
}

function authSecret(value: string): Bytes {
  if (value.length !== 22) throw new Error("Invalid push authentication secret");
  const bytes = fromBase64url(value);
  if (bytes.length !== 16) throw new Error("Invalid push authentication secret");
  return bytes;
}

function endpointUrl(endpoint: string): URL | null {
  if (endpoint.length > 4096 || !endpoint.startsWith("https://") || /[\s\\#]/.test(endpoint)) return null;
  try {
    const url = new URL(endpoint);
    const host = url.hostname;
    const supported = host === GOOGLE || host === MOZILLA || host === "updates." + MOZILLA
      || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com");
    return supported && !url.port && !url.username && !url.password && url.pathname !== "/" ? url : null;
  } catch {
    return null;
  }
}

/** The browser chooses its push service. A forged subscription may not choose an arbitrary network destination. */
export function isPushEndpoint(endpoint: string): boolean {
  return endpointUrl(endpoint) !== null;
}

export function isPushSubscription(subscription: PushSubscriptionData): boolean {
  if (!isPushEndpoint(subscription.endpoint)) return false;
  try {
    publicPoint(subscription.p256dh);
    authSecret(subscription.auth);
    return true;
  } catch {
    return false;
  }
}

async function hkdf(key: CryptoKey, salt: Bytes, info: Bytes, bits: number): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits));
}

/** RFC 8291 and RFC 8188 single-record aes128gcm. The key pair and salt can be fixed for the published test vector. */
export async function encryptPush(
  plaintext: Bytes, receiver: Pick<PushSubscriptionData, "p256dh" | "auth">, vector?: { key: CryptoKeyPair; salt: Bytes },
): Promise<Bytes> {
  if (plaintext.length > MAX_PAYLOAD) throw new Error("Push message is too large");
  const userPoint = publicPoint(receiver.p256dh);
  const secret = authSecret(receiver.auth);
  const salt = vector ? vector.salt : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length !== 16) throw new Error("Invalid push salt");
  const server = vector ? vector.key : await crypto.subtle.generateKey(ECDH, false, ["deriveBits"]);
  const [user, rawServer] = await Promise.all([
    crypto.subtle.importKey("raw", userPoint, ECDH, false, []),
    crypto.subtle.exportKey("raw", server.publicKey),
  ]);
  const serverPoint = new Uint8Array(rawServer);
  const shared = await crypto.subtle.deriveBits({ name: ECDH.name, public: user }, server.privateKey, 256);
  const key = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const ikm = await hkdf(key, secret, concat(ENCODER.encode("WebPush: info\0"), userPoint, serverPoint), 256);
  const contentKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const [cek, iv] = await Promise.all([
    hkdf(contentKey, salt, ENCODER.encode("Content-Encoding: aes128gcm\0"), 128),
    hkdf(contentKey, salt, ENCODER.encode("Content-Encoding: nonce\0"), 96),
  ]);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, concat(plaintext, Uint8Array.of(2)));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = serverPoint.length;
  return concat(header, serverPoint, new Uint8Array(ciphertext));
}

type CachedAuthorization = { reuseUntil: number; value: Promise<string> };
const authorizations = new Map<string, CachedAuthorization>();

async function signVapid(settings: PushSettings, audience: string, now: number): Promise<string> {
  const point = publicPoint(settings.publicKey);
  const scalar = fromBase64url(settings.privateKey);
  const contact = new URL(settings.subject);
  if (scalar.length !== 32 || (contact.protocol !== "mailto:" && contact.protocol !== "https:")) throw new Error("Invalid VAPID settings");
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", x: toBase64url(point.slice(1, 33)), y: toBase64url(point.slice(33)), d: settings.privateKey,
  }, ECDSA, false, ["sign"]);
  const header = toBase64url(ENCODER.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toBase64url(ENCODER.encode(JSON.stringify({
    aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: settings.subject,
  })));
  const input = header + "." + claims;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: ECDSA.name, hash: "SHA-256" }, key, ENCODER.encode(input)));
  return "vapid t=" + input + "." + toBase64url(signature) + ", k=" + settings.publicKey;
}

function vapidAuthorization(settings: PushSettings, audience: string): Promise<string> {
  const now = Date.now();
  const cacheKey = JSON.stringify([audience, settings.publicKey, settings.subject]);
  const cached = authorizations.get(cacheKey);
  if (cached && cached.reuseUntil > now) return cached.value;
  if (!cached && authorizations.size >= 32) authorizations.delete(authorizations.keys().next().value!);
  // The public VAPID identity is shared by requests. Reuse a signed token for an hour per push service.
  const value = signVapid(settings, audience, now).catch(error => {
    authorizations.delete(cacheKey);
    throw error;
  });
  authorizations.set(cacheKey, { value, reuseUntil: now + HOUR_MS });
  return value;
}

export async function sendReminderPush(
  settings: PushSettings, subscription: PushSubscriptionData, digest: ReminderDigest, fetcher = fetch,
): Promise<PushResult> {
  const endpoint = endpointUrl(subscription.endpoint);
  if (!endpoint) return "failed";
  try {
    const [authorization, body] = await Promise.all([
      vapidAuthorization(settings, endpoint.origin),
      encryptPush(ENCODER.encode(JSON.stringify(digest)), subscription),
    ]);
    const response = await fetcher(endpoint.href, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: authorization, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600" },
      body,
    });
    if (response.status === 404 || response.status === 410) return "gone";
    return response.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
