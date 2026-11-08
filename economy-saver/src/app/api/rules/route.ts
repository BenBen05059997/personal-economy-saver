import { z } from "zod";
import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { consumeRequest } from "@/db/rate-limit";
import { changeStandingRule } from "@/db/rules";
import { badFields, failure, formOf, redirectTo, returnPath, tooMany } from "@/lib/door";
import { RULE_KINDS } from "@/lib/money/suggestion-types";
import { householdRequest } from "@/lib/session";

const fields = z.object({
  kind: z.literal("set"), ruleKind: z.enum(RULE_KINDS),
  enabled: z.literal("on").optional().transform(value => value === "on"),
  value: z.string().max(30).optional().transform(value => value ?? null),
  spaceId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const store = db();
  if (!await withHousehold(store, hid, tx => consumeRequest(tx, hid, "rules", 20))) return tooMany("Too many rule changes. Try again in a minute.");
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const parsed = fields.safeParse(Object.fromEntries(form));
  if (!parsed.success) return badFields();
  try {
    await withHousehold(store, hid, tx => changeStandingRule(tx, hid, parsed.data));
    const destination = returnPath(form.get("returnTo"));
    return redirectTo(destination === "/canvas" || destination.startsWith("/canvas?space=") ? destination : "/memory?tab=rules", request);
  } catch (error) {
    return failure(error);
  }
}
