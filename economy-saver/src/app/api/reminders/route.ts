import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { saveReminderSettings, sendTestReminder, subscribeReminder, unsubscribeReminder } from "@/db/reminders";
import { verifiedIdentity } from "@/lib/auth-request";
import { badFields, failure, formOf, limited, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

const endpoint = z.string().min(1).max(2048);
const hour = z.string().regex(/^\d{1,2}$/).transform(Number).pipe(z.number().int().min(0).max(23));
const quiet = z.array(z.enum(["0", "1", "2", "3", "4", "5", "6"])).max(7).transform(days => days.map(Number));

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const store = db();
  const busy = await limited(hid, "reminders", 10, "Too many reminder requests. Try again in a minute.", store);
  if (busy) return busy;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  try {
    const identity = await verifiedIdentity();
    switch (form.get("kind")) {
      case "settings": {
        const parsed = z.object({ hour, quietDays: quiet }).safeParse({ hour: form.get("hour"), quietDays: form.getAll("quietDays") });
        if (!parsed.success) return badFields();
        await withHousehold(store, hid, tx => saveReminderSettings(tx, hid, identity, { ...parsed.data, emailOn: form.get("emailOn") === "on" }));
        return text("Reminder settings saved.", 200);
      }
      case "subscribe": {
        const parsed = z.object({ endpoint, p256dh: z.string().max(128), auth: z.string().max(64) }).safeParse(Object.fromEntries(form));
        if (!parsed.success) return badFields();
        await withHousehold(store, hid, tx => subscribeReminder(tx, hid, identity, parsed.data));
        return text("Push is on for this device.", 200);
      }
      case "unsubscribe": {
        const parsed = endpoint.safeParse(form.get("endpoint"));
        if (!parsed.success) return badFields();
        await withHousehold(store, hid, tx => unsubscribeReminder(tx, hid, identity, parsed.data));
        return text("Push is off for this device.", 200);
      }
      case "test": {
        const parsed = z.enum(["email", "push"]).safeParse(form.get("channel"));
        const device = endpoint.safeParse(form.get("endpoint"));
        if (!parsed.success || (parsed.data === "push" && !device.success)) return badFields();
        return await sendTestReminder(store, hid, identity, parsed.data, device.data)
          ? text("Test reminder sent.", 200) : text("The reminder service could not deliver the test.", 502);
      }
      default: return badFields();
    }
  } catch (error) {
    return failure(error);
  }
}
