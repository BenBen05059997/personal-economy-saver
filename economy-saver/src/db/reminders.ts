import { and, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { reminderDigest, testReminder } from "@/lib/notify/digest";
import { sendReminderEmail } from "@/lib/notify/email";
import { isPushSubscription, sendReminderPush } from "@/lib/notify/push";
import { reminderSettings as deliverySettings } from "@/lib/notify/settings";
import { appUrl } from "@/lib/supabase-auth";
import { logSettingProblem } from "@/lib/operator-log";
import { clockForHousehold } from "./clock";
import { householdClockRow, requireHousehold, withHousehold, type Db } from "./household";
import { InputError } from "./input-error";
import { openSuggestions } from "./suggestions";
import { households, members, pushSubscriptions, reminderSettings, reminders, spaces, suggestions, users } from "./schema";

type Identity = { uid: string; email: string | null } | null;
type Channel = typeof reminders.$inferInsert.channel;
type Subscription = Pick<typeof pushSubscriptions.$inferInsert, "endpoint" | "p256dh" | "auth">;
type Recipient = Pick<typeof reminderSettings.$inferSelect, "memberId" | "email">;
const DIGEST_KINDS = ["statement_due", "bill_due", "invoice_nudge", "goal_behind", "safe_below", "cancel_by", "tax_short"] as const;

async function memberFor(db: Db, hid: string, identity: Identity) {
  const [row] = identity ? await db.select({ id: users.memberId }).from(users)
    .where(and(eq(users.householdId, hid), eq(users.authUserId, identity.uid)))
    : await db.select({ id: members.id }).from(members)
      .innerJoin(households, and(eq(households.id, hid), eq(households.isDemo, true)))
      .where(and(eq(members.householdId, hid), eq(members.role, "owner")));
  if (!row) throw new InputError("Choose a member of this household.");
  return row.id;
}

/** The person's words for a delivery setting the server lacks, or null; the setting's name goes to the operator log. */
function settingWords(setting: { problem: string | null; words: string | null }, householdId: string) {
  if (setting.problem) logSettingProblem("reminders_not_set_up", setting.problem, householdId);
  return setting.words;
}

export async function reminderView(db: Db, id: string, identity: Identity) {
  const hid = requireHousehold(id);
  const memberId = await memberFor(db, hid, identity);
  const [rows, subscriptions] = await Promise.all([
    db.select({ hour: reminderSettings.hour, quietDays: reminderSettings.quietDays, emailOn: reminderSettings.emailOn })
      .from(reminderSettings).where(and(eq(reminderSettings.householdId, hid), eq(reminderSettings.memberId, memberId))),
    db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.householdId, hid), eq(pushSubscriptions.memberId, memberId))),
  ]);
  const config = deliverySettings();
  const emailProblem = settingWords(config.email, hid) ?? (identity?.email ? null : "Sign in with a verified email to use email reminders.");
  const endpointHashes = await Promise.all(subscriptions.map(async ({ endpoint }) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
    return Buffer.from(digest).toString("hex");
  }));
  return {
    hour: rows[0]?.hour ?? 8, quietDays: rows[0]?.quietDays ?? [],
    emailOn: emailProblem === null && rows[0]?.emailOn === true, emailAvailable: emailProblem === null, emailProblem,
    pushPublicKey: config.push.value?.publicKey ?? null, pushProblem: settingWords(config.push, hid), endpointHashes,
  };
}

export async function saveReminderSettings(db: Db, id: string, identity: Identity, input: { hour: number; quietDays: number[]; emailOn: boolean }) {
  const hid = requireHousehold(id);
  const memberId = await memberFor(db, hid, identity);
  const email = input.emailOn ? identity?.email : null;
  if (input.emailOn && !email) throw new InputError("Sign in with a verified email to use email reminders.");
  const problem = settingWords(deliverySettings().email, hid);
  if (input.emailOn && problem) throw new InputError(problem);
  const values = { ...input, quietDays: [...new Set(input.quietDays)].sort(), email: email ?? null };
  await db.insert(reminderSettings).values({ householdId: hid, memberId, ...values }).onConflictDoUpdate({
    target: [reminderSettings.householdId, reminderSettings.memberId], set: values,
  });
}

export async function subscribeReminder(db: Db, id: string, identity: Identity, subscription: Subscription) {
  const hid = requireHousehold(id);
  const problem = settingWords(deliverySettings().push, hid);
  if (problem) throw new InputError(problem);
  if (!isPushSubscription(subscription)) throw new InputError("This browser’s push subscription is invalid.");
  return db.transaction(async tx => {
    const memberId = await memberFor(tx, hid, identity);
    await tx.insert(reminderSettings).values({ householdId: hid, memberId }).onConflictDoNothing();
    const [row] = await tx.insert(pushSubscriptions).values({ householdId: hid, memberId, ...subscription }).onConflictDoUpdate({
      target: [pushSubscriptions.householdId, pushSubscriptions.endpoint],
      set: { p256dh: subscription.p256dh, auth: subscription.auth, failures: 0 },
      setWhere: eq(pushSubscriptions.memberId, memberId),
    }).returning({ id: pushSubscriptions.id });
    if (!row) throw new InputError("This device is already subscribed for another member.");
  });
}

export async function unsubscribeReminder(db: Db, id: string, identity: Identity, endpoint: string) {
  const hid = requireHousehold(id);
  const memberId = await memberFor(db, hid, identity);
  const removed = await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.householdId, hid),
    eq(pushSubscriptions.memberId, memberId), eq(pushSubscriptions.endpoint, endpoint))).returning({ id: pushSubscriptions.id });
  return removed.length > 0;
}

async function deliverPush(db: Db, hid: string, settings: NonNullable<ReturnType<typeof deliverySettings>["push"]["value"]>,
  subscriptions: (Subscription & { id: string; memberId: string })[], digest: ReturnType<typeof testReminder>, fetcher: typeof fetch) {
  let sent = false;
  for (const subscription of subscriptions) {
    const result = await sendReminderPush(settings, subscription, digest, fetcher);
    const where = and(eq(pushSubscriptions.householdId, hid), eq(pushSubscriptions.memberId, subscription.memberId),
      eq(pushSubscriptions.id, subscription.id), eq(pushSubscriptions.p256dh, subscription.p256dh), eq(pushSubscriptions.auth, subscription.auth));
    await withHousehold(db, hid, async tx => {
      if (result === "gone") await tx.delete(pushSubscriptions).where(where);
      else await tx.update(pushSubscriptions).set({ failures: result === "sent" ? 0 : sql`${pushSubscriptions.failures} + 1` }).where(where);
    });
    if (result === "sent") sent = true;
  }
  return sent;
}

export async function sendTestReminder(db: Db, id: string, identity: Identity, channel: Channel, endpoint?: string, fetcher = fetch) {
  const hid = requireHousehold(id);
  const config = deliverySettings();
  if (channel === "email") {
    await withHousehold(db, hid, tx => memberFor(tx, hid, identity));
    if (!identity?.email) throw new InputError("Sign in with a verified email to use email reminders.");
    { const problem = settingWords(config.email, hid); if (problem) throw new InputError(problem); }
    return sendReminderEmail(config.email.value!, identity.email, testReminder(appUrl().href), fetcher);
  }
  const rows = await withHousehold(db, hid, async tx => {
    const memberId = await memberFor(tx, hid, identity);
    { const problem = settingWords(config.push, hid); if (problem) throw new InputError(problem); }
    if (!endpoint) throw new InputError("Turn on push for this device first.");
    return tx.select().from(pushSubscriptions).where(and(eq(pushSubscriptions.householdId, hid),
      eq(pushSubscriptions.memberId, memberId), eq(pushSubscriptions.endpoint, endpoint)));
  });
  if (!rows.length) throw new InputError("Turn on push for this device first.");
  return deliverPush(db, hid, config.push.value!, rows, testReminder(appUrl().href), fetcher);
}

const beforeDay = (column: typeof reminderSettings.emailRanOn | typeof reminderSettings.pushRanOn, today: string) =>
  sql`(${column} is null or ${column} < ${today})`;

async function claimReminder(db: Db, hid: string, recipient: Recipient, channel: Channel, today: string, ids: string[], spaceId: string | null) {
  const lastDay = channel === "email" ? reminderSettings.emailRanOn : reminderSettings.pushRanOn;
  return withHousehold(db, hid, async tx => {
    const [claimed] = await tx.update(reminderSettings)
      .set(channel === "email" ? { emailRanOn: today } : { pushRanOn: today })
      .where(and(eq(reminderSettings.householdId, hid), eq(reminderSettings.memberId, recipient.memberId), beforeDay(lastDay, today),
        channel === "email" && recipient.email ? and(eq(reminderSettings.emailOn, true), eq(reminderSettings.email, recipient.email)) : undefined))
      .returning({ memberId: reminderSettings.memberId });
    if (!claimed) return null;
    const [space] = spaceId ? await tx.select({ id: spaces.id }).from(spaces)
      .where(and(eq(spaces.householdId, hid), eq(spaces.id, spaceId))).for("key share") : [];
    const [row] = await tx.insert(reminders).values({ householdId: hid, memberId: recipient.memberId, channel, day: today,
      spaceId: space?.id ?? null, suggestionIds: ids, status: "failed" })
      .onConflictDoNothing().returning({ id: reminders.id });
    return row?.id ?? null;
  });
}

function hourOf(timeZone: string, now: Date) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now));
}

export async function runReminders(db: Db, id: string, now = new Date(), fetcher = fetch) {
  const hid = requireHousehold(id);
  const snapshot = await withHousehold(db, hid, async tx => {
    const household = await householdClockRow(tx, hid);
    if (!household) return null;
    await tx.delete(reminders).where(and(eq(reminders.householdId, hid), lt(reminders.createdAt, new Date(now.getTime() - 30 * 86_400_000))));
    const { today } = clockForHousehold(household, now);
    const [findings, recipients, subscriptions] = await Promise.all([
      openSuggestions(tx, hid, { day: today, kinds: DIGEST_KINDS }),
      tx.select().from(reminderSettings).where(eq(reminderSettings.householdId, hid)),
      tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.householdId, hid)),
    ]);
    return { household, today, findings, recipients, subscriptions };
  });
  if (!snapshot) return;
  const { household, today, findings, recipients, subscriptions } = snapshot;
  if (!findings.length) return;
  const hour = hourOf(household.timeZone, now);
  const weekday = new Date(today + "T00:00:00Z").getUTCDay();
  const config = deliverySettings();
  const ids = findings.map(finding => finding.id);
  const firstSpace = findings[0].spaceId;
  const spaceId = findings.every(finding => finding.spaceId === firstSpace) ? firstSpace : null;
  for (const member of recipients) {
    if (member.hour > hour || member.quietDays.includes(weekday)) continue;
    const deviceRows = subscriptions.filter(row => row.memberId === member.memberId);
    const channels: Channel[] = [];
    if (!household.isDemo && member.emailOn && member.email && (!member.emailRanOn || member.emailRanOn < today)) channels.push("email");
    if (deviceRows.length && (!member.pushRanOn || member.pushRanOn < today)) channels.push("push");
    for (const channel of channels) {
      const receipt = await claimReminder(db, hid, member, channel, today, ids, spaceId);
      if (!receipt) continue;
      const problem = config[channel].problem;
      if (problem) {
        console.warn("[reminders]", problem);
        continue;
      }
      let sent = false;
      try {
        const digest = reminderDigest(findings, appUrl().href);
        if (!digest) continue;
        sent = channel === "email"
          ? await sendReminderEmail(config.email.value!, member.email!, digest, fetcher)
          : await deliverPush(db, hid, config.push.value!, deviceRows, digest, fetcher);
      } catch {
        // The claim stays failed. A transport failure or interruption must not send a second digest.
      }
      if (sent) await withHousehold(db, hid, async tx => tx.update(reminders).set({ status: "sent" })
        .where(and(eq(reminders.householdId, hid), eq(reminders.id, receipt))));
    }
  }
}

/** For the cron selector: a household already scanned today with a member now due. */
export function remindersDue(db: Db, local: SQL) {
  const day = sql`${local}::date`;
  const eligible = db.select({ id: suggestions.id }).from(suggestions).where(and(eq(suggestions.householdId, households.id),
    sql`${suggestions.createdOn} = ${day}`, eq(suggestions.status, "open"), inArray(suggestions.kind, DIGEST_KINDS)));
  const due = db.select({ member: reminderSettings.memberId }).from(reminderSettings).where(and(
    eq(reminderSettings.householdId, households.id), sql`${reminderSettings.hour} <= extract(hour from ${local})`,
    sql`not (extract(dow from ${local}) = any(${reminderSettings.quietDays}))`,
    sql`((
      ${reminderSettings.emailOn} and ${reminderSettings.email} is not null and (${reminderSettings.emailRanOn} is null or ${reminderSettings.emailRanOn} < ${day})
    ) or (
      (${reminderSettings.pushRanOn} is null or ${reminderSettings.pushRanOn} < ${day}) and exists (
        select 1 from ${pushSubscriptions} where ${pushSubscriptions.householdId} = ${households.id} and ${pushSubscriptions.memberId} = ${reminderSettings.memberId}
      )
    ))`,
  ));
  return and(sql`${households.dailyRanOn} = ${day}`, sql`exists (${eligible})`, sql`exists (${due})`);
}
