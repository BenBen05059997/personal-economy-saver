// Stage 30A (D68). Real PGlite invitations with a fake Supabase Auth transport.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import { NextRequest, NextResponse } from "next/server";
import { accountMembership, finishSetup, setupForm } from "@/db/account";
import type { Db } from "@/db/household";
import { createInvite } from "@/db/invites";
import { FORM_FETCH_HEADER, FORM_REDIRECT_HEADER } from "@/lib/form-fetch";
import { INVITE_COOKIE, INVITE_COOKIE_AGE } from "@/lib/invite-auth";
import { routePattern } from "@/lib/request-log";
import { middleware } from "@/middleware";

const ORIGIN = "https://saver.example.test";
const EMAIL = "fictional-invite@example.test";
const CALLBACK = "/api/auth/callback";
type Check = (name: string, run: () => Promise<void>) => Promise<void>;
type AuthUser = { id: string; email: string; email_confirmed_at?: string };

export async function runInviteAuthChecks(db: Db, check: Check) {
  const owner = randomUUID();
  const hid = await finishSetup(db, owner, setupForm.parse({ name: "Fictional Wren", timeZone: "Asia/Tokyo", currency: "USD", bank: "1250" }), null);
  const { token } = await createInvite(db, hid, owner, { email: EMAIL, name: "Fictional Finch" });
  const join = "/join/" + token;
  const refuse = join + "?refused=1";
  const guest = randomUUID();
  const confirmed = "2026-11-08T12:00:00.000Z";

  const incoming = new Map<string, string>([["household", "fictional-demo"]]);
  const deletions: { name: string; path?: string }[] = [];
  const jar = {
    get: (name: string) => incoming.has(name) ? { value: incoming.get(name) } : undefined,
    set: (name: string, value: string, options: { maxAge?: number; path?: string }) => {
      if (options.maxAge === 0) {
        incoming.delete(name);
        deletions.push({ name, path: options.path });
      } else {
        incoming.set(name, value);
      }
    },
  };
  const sends: { email: string; options: { emailRedirectTo: string } }[] = [];
  const exchanges: { code: string; flowId?: string }[] = [];
  let sendError: { status: number } | null = null;
  let authUser: AuthUser | null = null;
  let signedOut = false;
  const fakeAuth = {
    signInWithOtp: async (input: (typeof sends)[number]) => {
      sends.push(input);
      return { error: sendError };
    },
    exchangeCodeForSession: async (code: string, options?: { flowId: string }) => {
      exchanges.push({ code, flowId: options?.flowId });
      return { data: { user: authUser }, error: authUser ? null : new Error("Fictional invalid code") };
    },
    signOut: async (options: { scope: string }) => {
      assert.equal(options.scope, "local");
      signedOut = true;
      return { error: null };
    },
  };
  const settings = { APP_URL: ORIGIN, CLIENT_IP_HEADER: "x-test-client-ip" };
  const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const loader = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
    _resolveFilename: (request: string, parent: unknown, isMain: boolean) => string;
  };
  const realLoad = loader._load;
  loader._load = function (request, parent, isMain) {
    if (request === "next/headers") return { cookies: async () => jar };
    const path = (() => { try { return loader._resolveFilename(request, parent, isMain); } catch { return ""; } })();
    if (path.endsWith("/src/db/client.ts")) return { db: () => db, MissingDatabaseUrl: class extends Error {} };
    const real = realLoad.call(this, request, parent, isMain);
    if (path.endsWith("/src/lib/auth-request.ts")) {
      return { ...(real as object), verifiedUid: async () => null, routeAuth: async () => ({ auth: fakeAuth }) };
    }
    return real;
  };

  try {
    const link = (await import("@/app/api/auth/link/route")).POST;
    const callback = (await import("@/app/api/auth/callback/route")).GET;
    const logout = (await import("@/app/api/auth/logout/route")).POST;
    const post = (path: string, values: Record<string, string>, headers: Record<string, string> = {}) => new Request(ORIGIN + path, {
      method: "POST", body: new URLSearchParams(values),
      headers: { origin: ORIGIN, "x-test-client-ip": "203.0.113.16", ...headers },
    });
    const linkPost = (values: Record<string, string>, headers?: Record<string, string>) => link(post("/api/auth/link", values, headers));
    const returnFromAuth = (query = "?code=fixture&sb_flow_id=fixture-flow") => callback(new Request(ORIGIN + CALLBACK + query));
    function assertClearedPending() {
      assert.equal(incoming.has(INVITE_COOKIE), false);
      assert.deepEqual(deletions.at(-1), { name: INVITE_COOKIE, path: CALLBACK });
    }

    await check("invite link rejects a foreign origin, malformed token, wrong email or invalid token before sending", async () => {
      assert.equal((await linkPost({ email: EMAIL, invite: token }, { origin: "https://other.example.test" })).status, 403);
      assert.equal((await linkPost({ email: EMAIL, invite: "invalid" })).status, 400);
      assert.equal((await linkPost({ email: "fictional-other@example.test", invite: token })).status, 400);
      assert.equal((await linkPost({ email: EMAIL, invite: "A".repeat(43) })).status, 400);
      assert.equal(sends.length, 0);
    });

    await check("valid invite link uses the exact PKCE callback and a short-lived HttpOnly invite cookie", async () => {
      const res = await linkPost({ email: EMAIL, invite: token }, { [FORM_FETCH_HEADER]: "1" });
      assert.equal(res.status, 204);
      assert.equal(res.headers.get(FORM_REDIRECT_HEADER), join + "?sent=1");
      assert.deepEqual(sends, [{ email: EMAIL, options: { emailRedirectTo: ORIGIN + CALLBACK } }]);
      assert.ok(res instanceof NextResponse);
      const pending = res.cookies.get(INVITE_COOKIE);
      assert.equal(pending?.value === token, true);
      assert.deepEqual([pending?.path, pending?.httpOnly, pending?.sameSite, pending?.maxAge], [CALLBACK, true, "lax", INVITE_COOKIE_AGE]);
      assert.equal(res.cookies.get("upgrade-demo")?.value, "");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    });

    await check("a failed invite send sets no pending cookie, and ordinary sign-in clears any old pending intent", async () => {
      sendError = { status: 429 };
      const failed = await linkPost({ email: EMAIL, invite: token });
      assert.equal(failed.status, 429);
      assert.equal(failed.headers.has("set-cookie"), false);
      sendError = null;
      incoming.set(INVITE_COOKIE, token);
      const ordinary = await linkPost({ email: EMAIL });
      assert.equal(ordinary.status, 303);
      assert.equal(ordinary.headers.get("location"), "/login?sent=1");
      assertClearedPending();
      assert.ok(ordinary instanceof NextResponse);
      assert.equal(ordinary.cookies.get("upgrade-demo")?.value, "fictional-demo");
    });

    await check("invite callback clears pending state and refuses missing or invalid authorization without onboarding", async () => {
      incoming.set(INVITE_COOKIE, token);
      assert.equal((await returnFromAuth("")).headers.get("location"), refuse);
      assert.equal(exchanges.length, 0);
      assertClearedPending();

      incoming.set(INVITE_COOKIE, token);
      assert.equal((await returnFromAuth()).headers.get("location"), refuse);
      assert.deepEqual(exchanges, [{ code: "fixture", flowId: "fixture-flow" }]);
      assertClearedPending();
    });

    await check("invite callback refuses mismatched or unverified email and an account that already belongs to a household", async () => {
      for (const user of [
        { id: guest, email: "fictional-other@example.test", email_confirmed_at: confirmed },
        { id: guest, email: EMAIL },
        { id: owner, email: EMAIL, email_confirmed_at: confirmed },
      ]) {
        authUser = user;
        incoming.set(INVITE_COOKIE, token);
        const res = await returnFromAuth();
        assert.equal(res.headers.get("location"), refuse);
        assertClearedPending();
      }
      assert.equal(await accountMembership(db, guest), null);
      assert.equal((await accountMembership(db, owner))?.role, "owner");
    });

    await check("invite callback joins using the verified matching email, clears demo cookies, and sends the member Home", async () => {
      authUser = { id: guest, email: EMAIL, email_confirmed_at: confirmed };
      incoming.set(INVITE_COOKIE, token);
      const res = await returnFromAuth();
      assert.equal(res.headers.get("location"), "/");
      assert.equal(res.cookies.get("household")?.value, "");
      assert.equal(res.cookies.get("upgrade-demo")?.value, "");
      assertClearedPending();
      const membership = await accountMembership(db, guest);
      assert.deepEqual([membership?.householdId, membership?.role], [hid, "member"]);
    });

    await check("ordinary callback still sends a new account to onboarding, and the join sign-out form returns Home", async () => {
      authUser = { id: randomUUID(), email: EMAIL, email_confirmed_at: confirmed };
      assert.equal((await returnFromAuth()).headers.get("location"), "/onboarding");
      const res = await logout(post("/api/auth/logout", {}, { [FORM_FETCH_HEADER]: "1" }));
      assert.equal(res.status, 204);
      assert.equal(res.headers.get(FORM_REDIRECT_HEADER), "/");
      assert.equal(signedOut, true);
    });

    await check("join pages send no-store and no-referrer and the app log masks the full credential path", async () => {
      const res = await middleware(new NextRequest(ORIGIN + join));
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      assert.equal(routePattern(join), "/join/:token");
      assert.equal(routePattern(join + "/malformed"), "/join/:token");
    });
  } finally {
    loader._load = realLoad;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
