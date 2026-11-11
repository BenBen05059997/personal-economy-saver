import assert from "node:assert/strict";
import { reminderDigest, testReminder } from "@/lib/notify/digest";
import { sendReminderEmail } from "@/lib/notify/email";
import { encryptPush, isPushEndpoint, isPushSubscription, sendReminderPush } from "@/lib/notify/push";

type Check = (name: string, run: () => void | Promise<void>) => Promise<void>;

const RECEIVER = {
  endpoint: "https://fcm.googleapis.com/wp/fictional",
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const SEND_POINT = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const SEND_SCALAR = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const from64 = (value: string) => Uint8Array.from(Buffer.from(value, "base64url"));
const app = "https://economy.example/";

export async function runNotifyTransportChecks(check: Check) {
  await check("RFC 8291 §5 Web Push encrypts the published vector byte for byte", async () => {
    const raw = from64(SEND_POINT);
    const curve = { name: "ECDH", namedCurve: "P-256" };
    const publicKey = await crypto.subtle.importKey("raw", raw, curve, true, []);
    const privateKey = await crypto.subtle.importKey("jwk", {
      kty: "EC", crv: "P-256", x: b64(raw.slice(1, 33)), y: b64(raw.slice(33)), d: SEND_SCALAR,
    }, curve, false, ["deriveBits"]);
    const encrypted = await encryptPush(new TextEncoder().encode("When I grow up, I want to be a watermelon"), RECEIVER, {
      key: { publicKey, privateKey }, salt: from64("DGv6ra1nlYgDCS1FRnbzlw"),
    });
    const expected = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
      + "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
      + "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";
    assert.equal(b64(encrypted), expected);
  });

  await check("the digest uses fixed words and engine amounts, and links only to app Home", () => {
    const digest = reminderDigest([
      { kind: "invoice_nudge", reason: "Open https://pay.example/path or mail someone@example.com." },
      { kind: "bill_due", reason: "¥4,250, covered even if clients pay late." },
      { kind: "safe_below", reason: "$21.50 safe to spend, below $30.50." },
      { kind: "cost_up", reason: "$99 excluded from the outbound digest." },
    ], "https://economy.example/ignored?q=other");
    assert.deepEqual(digest, {
      title: "Personal Economy Saver",
      body: "A client is late with a payment.\nA bill is due soon (¥4,250).\nSafe to spend is below your rule ($21.50, $30.50).",
      url: app,
    });
    assert.equal(reminderDigest([{ kind: "cost_up", reason: "¥3,500 more than last month." }], app), null);
    assert.equal(reminderDigest([{ kind: "toString", reason: "inherited object key" }], app), null);
    assert.equal(testReminder(app).url, app);
    assert.throws(() => testReminder("https://wrong:password@economy.example/"), /APP_URL/);
  });

  await check("Resend accepts the fixed text and app link, and refused or failed requests stay failed", async () => {
    const digest = testReminder(app);
    const settings = { apiKey: "fictional-key", from: "Fictional <reminder@economy.example>" };
    const to = "person@example.com";
    const send = (status: number) => sendReminderEmail(settings, to, digest, async (url, request) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(request?.redirect, "manual");
      assert.equal(request?.method, "POST");
      const headers = new Headers(request.headers);
      assert.equal(headers.get("authorization"), "Bearer fictional-key");
      assert.equal(headers.get("idempotency-key"), "reminder-fictional");
      assert.deepEqual(JSON.parse(String(request.body)), {
        from: settings.from, to: [to], subject: digest.title, text: digest.body + "\n\n" + app,
      });
      return new Response(null, { status });
    }, "reminder-fictional");
    assert.equal(await send(200), true);
    assert.equal(await send(401), false);
    assert.equal(await sendReminderEmail(settings, to, digest, async () => { throw new Error("offline"); }), false);
  });

  await check("Web Push sends a signed VAPID token to a known provider and classifies expired endpoints", async () => {
    const settings = { publicKey: SEND_POINT, privateKey: SEND_SCALAR, subject: "mailto:operator@economy.example" };
    const digest = testReminder(app);
    const headersSeen: string[] = [];
    let firstSalt: Uint8Array | undefined;
    const send = (status: number) => sendReminderPush(settings, RECEIVER, digest, async (url, request) => {
      assert.equal(url, RECEIVER.endpoint);
      assert.equal(request?.method, "POST");
      assert.equal(request?.redirect, "manual");
      const headers = new Headers(request.headers);
      assert.equal(headers.get("content-encoding"), "aes128gcm");
      assert.equal(headers.get("content-type"), "application/octet-stream");
      assert.equal(headers.get("ttl"), "3600");
      const authorization = headers.get("authorization")!;
      headersSeen.push(authorization);
      const [token, key] = authorization.slice("vapid t=".length).split(", k=");
      assert.equal(key, SEND_POINT);
      const [header, payload, signature] = token.split(".");
      const decode = (input: string) => JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
      assert.deepEqual(decode(header), { typ: "JWT", alg: "ES256" });
      const claims = decode(payload);
      const now = Math.floor(Date.now() / 1000);
      assert.equal(claims.aud, "https://fcm.googleapis.com");
      assert.equal(claims.sub, settings.subject);
      assert.ok(claims.exp > now && claims.exp <= now + 24 * 60 * 60);
      const publicKey = await crypto.subtle.importKey("raw", from64(SEND_POINT), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      assert.equal(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, from64(signature),
        new TextEncoder().encode(header + "." + payload)), true);
      assert.ok(request.body instanceof Uint8Array);
      const bytes = request.body as Uint8Array;
      const salt = bytes.slice(0, 16);
      if (firstSalt) assert.notDeepEqual(salt, firstSalt, "encryption uses a new salt");
      firstSalt = salt;
      assert.equal(bytes[20], 65, "an ephemeral public key travels in the header");
      assert.notEqual(b64(bytes.slice(21, 86)), SEND_POINT, "encryption key and signing key differ");
      assert.ok(!Buffer.from(bytes).includes(Buffer.from(digest.body)));
      return new Response(null, { status });
    });
    assert.equal(await send(201), "sent");
    assert.equal(await send(404), "gone");
    assert.equal(await send(410), "gone");
    assert.equal(await send(503), "failed");
    assert.equal(new Set(headersSeen).size, 1, "reuse the VAPID token for this service");
  });

  await check("forged push endpoints and malformed keys cannot make a network request", async () => {
    assert.equal(isPushSubscription(RECEIVER), true);
    for (const endpoint of [
      "https://web.push.apple.com/example", "https://updates.push.services.mozilla.com/wpush/v2/example",
      "https://wns.example.notify.windows.com/w/?token=fictional",
    ]) assert.equal(isPushEndpoint(endpoint), true);
    for (const endpoint of [
      "http://fcm.googleapis.com/wp/fictional", "https://127.0.0.1/push", "https://192.168.1.1/private",
      "https://fcm.googleapis.com.evil.example/wp/fictional", "https://fcm.googleapis.com@evil.example/push",
      "https://name@fcm.googleapis.com/wp/fictional", "https://fcm.googleapis.com:8443/wp/fictional",
      "https://fcm.googleapis.com/wp/fictional#extra",
    ]) assert.equal(isPushEndpoint(endpoint), false);
    const wrongKey = { ...RECEIVER, p256dh: "not a point" };
    assert.equal(isPushSubscription(wrongKey), false);
    const settings = { publicKey: SEND_POINT, privateKey: SEND_SCALAR, subject: "mailto:operator@economy.example" };
    let requests = 0;
    const fake = async () => { requests++; return new Response(null, { status: 201 }); };
    assert.equal(await sendReminderPush(settings, { ...RECEIVER, endpoint: "https://evil.example/push" }, testReminder(app), fake), "failed");
    assert.equal(await sendReminderPush(settings, wrongKey, testReminder(app), fake), "failed");
    assert.equal(requests, 0);
  });
}
