import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { countKind, deleteKind } from "@/db/data-kinds";
import { dueHouseholds } from "@/db/daily";
import { changeStandingRule } from "@/db/rules";
import { createSpace } from "@/db/spaces";
import type { Fact } from "@/lib/money/facts";
import { engineFact } from "@/lib/money/facts";
import { reminderDigest } from "@/lib/notify/digest";
import { reminderView, runReminders, saveReminderSettings, sendTestReminder, subscribeReminder } from "@/db/reminders";
import * as s from "@/db/schema";
import { runNotifyTransportChecks } from "./notify-transport-test";

async function main() {
  const pg = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pg, { schema: s });
  let passed = 0;
  async function check(name: string, run: () => Promise<void> | void) { await run(); passed++; console.log("✓ " + name); }

  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url");
  const privateKey = (await crypto.subtle.exportKey("jwk", keys.privateKey)).d!;
  const recipientKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/fictional-device", p256dh: Buffer.from(await crypto.subtle.exportKey("raw", recipientKeys.publicKey)).toString("base64url"), auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") };
  const config = {
    APP_URL: "https://example.test", RESEND_API_KEY: "fictional-key", REMINDER_FROM: "reminders@example.test",
    WEB_PUSH_PUBLIC_KEY: publicKey, WEB_PUSH_PRIVATE_KEY: privateKey, WEB_PUSH_SUBJECT: "mailto:contact@example.test",
  };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  const sends: { url: string; body: BodyInit | null | undefined }[] = [];
  let emailStatus = 202, pushStatus = 201;
  const transport: typeof fetch = async (input, init) => {
    const url = String(input);
    sends.push({ url, body: init?.body });
    return new Response(null, { status: url === subscription.endpoint ? pushStatus : emailStatus });
  };
  try {
    await runNotifyTransportChecks(check);
    await migrate(db, { migrationsFolder: "./drizzle" });
    const today = "2026-11-14";
    const morning = new Date(today + "T00:00:00Z"); // 09:00 Tokyo
    const [household] = await db.insert(s.households).values({ homeCurrency: "JPY", name: "Fictional reminders", dailyRanOn: today }).returning();
    const hid = household.id;
    const [owner, guest] = await db.insert(s.members).values([
      { householdId: hid, displayName: "Fictional owner", role: "owner", shareBp: 5_000 },
      { householdId: hid, displayName: "Fictional guest", role: "member", shareBp: 5_000 },
    ]).returning();
    const identity = { uid: crypto.randomUUID(), email: "owner@example.test" };
    const guestIdentity = { uid: crypto.randomUUID(), email: "guest@example.test" };
    await db.insert(s.users).values([{ householdId: hid, memberId: owner.id, authUserId: identity.uid },
      { householdId: hid, memberId: guest.id, authUserId: guestIdentity.uid }]);
    const history = () => db.select().from(s.reminders).where(eq(s.reminders.householdId, hid));
    const finding = async (day: string, kind: typeof s.suggestions.$inferInsert.kind, facts: Fact[] = [engineFact("bill_amount", 2500, { from: "test", currency: "JPY" })]) => {
      const [row] = await db.insert(s.suggestions).values({ householdId: hid, kind, key: kind + ":" + day, title: "Untrusted https://evil.example/",
        reason: "¥2,500, covered even if clients pay late.", action: "runway", urgency: 1, createdOn: day, facts }).returning();
      return row;
    };

    await check("quiet days and late reminder hours suppress their own members, and only new eligible findings trigger a digest", async () => {
      await saveReminderSettings(db, hid, identity, { hour: 9, quietDays: [6], emailOn: true });
      await saveReminderSettings(db, hid, guestIdentity, { hour: 11, quietDays: [], emailOn: true });
      await subscribeReminder(db, hid, identity, subscription);
      await finding(today, "cost_up");
      await runReminders(db, hid, morning, transport);
      assert.equal(sends.length, 0);
      await finding(today, "bill_due");
      assert.deepEqual(await dueHouseholds(db, morning), []);
      await runReminders(db, hid, morning, transport);
      assert.equal(sends.length, 0);
      assert.deepEqual(await dueHouseholds(db, new Date(today + "T02:00:00Z")), [hid]);
      await runReminders(db, hid, new Date(today + "T02:00:00Z"), transport);
      assert.equal(sends.length, 1, "only the member whose hour arrived");
      assert.equal(JSON.parse(String(sends[0].body)).to[0], guestIdentity.email);
    });

    await check("each member gets one digest per channel even across concurrent runs or deletion of delivery history", async () => {
      const day = "2026-11-15", now = new Date(day + "T00:00:00Z");
      const bill = await finding(day, "bill_due");
      const initial = sends.length;
      await Promise.all([runReminders(db, hid, now, transport), runReminders(db, hid, now, transport)]);
      const rows = (await history()).filter(row => row.day === day);
      assert.deepEqual(new Set(rows.map(row => row.channel)), new Set(["email", "push"]));
      assert.ok(rows.every(row => row.status === "sent" && row.memberId === owner.id && row.suggestionIds[0] === bill.id));
      assert.equal(sends.length - initial, 2);
      const email = JSON.parse(String(sends[initial].body));
      assert.equal(email.to[0], identity.email);
      assert.deepEqual(email.text.match(/https?:\/\/\S+/g), ["https://example.test/"]);
      assert.match(email.text, /¥2,500/);
      assert.equal(await countKind(db, hid, "reminders"), 3);
      await deleteKind(db, hid, "reminders", { madeBy: "form" });
      await runReminders(db, hid, now, transport);
      assert.equal(sends.length - initial, 2);
    });

    await check("failed email and gone push are recorded once, and the 410 removes only that subscription", async () => {
      const day = "2026-11-16", now = new Date(day + "T00:00:00Z");
      await finding(day, "statement_due");
      emailStatus = 503;
      pushStatus = 410;
      const before = sends.length;
      await runReminders(db, hid, now, transport);
      await runReminders(db, hid, now, transport);
      const rows = await history();
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.status === "failed"));
      assert.equal(sends.length - before, 2);
      assert.equal(await countKind(db, hid, "push_subscriptions"), 0);
    });

    await check("missing channel setting is named, and a test uses only the verified address or this member's enrolled device", async () => {
      const before = sends.length;
      delete process.env.RESEND_API_KEY;
      const view = await reminderView(db, hid, identity);
      assert.equal(view.emailOn, false);
      assert.equal(view.emailProblem, "Email reminders aren’t set up on this server.");
      await assert.rejects(sendTestReminder(db, hid, identity, "email", undefined, transport), /Email reminders aren’t set up on this server\./);
      process.env.RESEND_API_KEY = config.RESEND_API_KEY;
      await assert.rejects(sendTestReminder(db, hid, guestIdentity, "push", subscription.endpoint, transport), /Turn on push/);
      assert.equal(sends.length, before);
      emailStatus = 202;
      assert.equal(await sendTestReminder(db, hid, identity, "email", undefined, transport), true);
      assert.equal(JSON.parse(String(sends.at(-1)!.body)).to[0], identity.email);
      assert.equal((await history()).length, 2, "a test doesn't claim a daily reminder");
    });

    await check("delivery history expires after 30 days, scoped to the household", async () => {
      const before = sends.length;
      await db.update(s.reminders).set({ createdAt: new Date("2026-10-01T00:00:00Z") }).where(and(eq(s.reminders.householdId, hid), eq(s.reminders.memberId, owner.id)));
      await runReminders(db, hid, new Date("2026-12-01T00:00:00Z"), transport);
      assert.deepEqual(await history(), []);
      assert.equal(sends.length, before);
    });
    await check("one linked space is named in the digest and receipt, while a mixed digest names both with one daily send", async () => {
      const utilities = await createSpace(db, hid, "Fictional utilities review");
      const cards = await createSpace(db, hid, "Fictional cards review");
      await changeStandingRule(db, hid, { ruleKind: "bill_ahead", enabled: true, value: "3", spaceId: utilities.id });
      await changeStandingRule(db, hid, { ruleKind: "statement_ahead", enabled: true, value: "3", spaceId: cards.id });
      await saveReminderSettings(db, hid, identity, { hour: 9, quietDays: [], emailOn: true });

      const singleDay = "2026-12-02";
      const bill = await finding(singleDay, "bill_due");
      const before = sends.length;
      await runReminders(db, hid, new Date(singleDay + "T00:00:00Z"), transport);
      assert.equal(sends.length - before, 1);
      const single = (await history()).find(row => row.day === singleDay);
      assert.deepEqual([single?.spaceId, single?.suggestionIds], [utilities.id, [bill.id]]);
      const email = JSON.parse(String(sends.at(-1)!.body));
      assert.match(email.text, /A bill is due soon \(¥2,500\)\. Space: Fictional utilities review\./);

      const mixedDay = "2026-12-03", now = new Date(mixedDay + "T00:00:00Z");
      const mixed = await Promise.all([finding(mixedDay, "bill_due"), finding(mixedDay, "statement_due")]);
      await Promise.all([runReminders(db, hid, now, transport), runReminders(db, hid, now, transport)]);
      assert.equal(sends.length - before, 2);
      const receipt = (await history()).find(row => row.day === mixedDay);
      assert.equal(receipt?.spaceId, null);
      assert.deepEqual(receipt?.suggestionIds.sort(), mixed.map(row => row.id).sort());
      const digest = JSON.parse(String(sends.at(-1)!.body));
      assert.match(digest.text, /Space: Fictional utilities review\./);
      assert.match(digest.text, /Space: Fictional cards review\./);
      assert.deepEqual(digest.text.match(/https?:\/\/\S+/g), ["https://example.test/"]);
    });

    await check("a tax pot short is in the digest, with its amounts from facts, and a row with no money fact still prints", () => {
      const tax = [engineFact("tax_ahead", 12_000, { from: "test", currency: "JPY" }), engineFact("tax_short_on", "2026-11-27", { from: "test" }),
        engineFact("bill_amount", 30_000, { from: "test", currency: "JPY" })];
      const digest = reminderDigest([{ kind: "tax_short", facts: tax }, { kind: "bill_due", facts: [] }, { kind: "goal_behind" }], "https://example.test/")!;
      assert.equal(digest.body, "A tax pot falls short of its bills (¥12,000, ¥30,000).\nA bill is due soon.\nA goal is behind its pace.");
    });

    await check("reminder labels neutralize links and controls and name scopes beyond the six-line cap", () => {
      const shown = { kind: "bill_due", spaceName: "Fictional utilities review" };
      const digest = reminderDigest([
        ...Array.from({ length: 6 }, () => shown),
        { ...shown, spaceName: "Fictional cards review" },
        { ...shown, spaceName: "Fictional \n https://evil.example/ someone@evil.example" },
        shown,
      ], "https://example.test/home")!;
      assert.equal(digest.url, "https://example.test/");
      assert.doesNotMatch(digest.body, /https?:\/\/|evil\.example|someone@/);
      assert.match(digest.body, /Space: Fictional utilities review\./);
      assert.match(digest.body, /3 more findings on Home\./);
      assert.match(digest.body, /More findings in these spaces: Fictional cards review, Fictional https \/\/evil dot example\/ someone at evil dot example\./);
      assert.equal(digest.body.split("\n").length, 8, "the space label cannot add a line");
    });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await pg.close();
  }
  console.log("reminders: " + passed + " checks passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
