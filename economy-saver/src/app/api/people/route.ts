import { db } from "@/db/client";
import { addMember, addMemberInput, removeMember, removeMemberInput, savePeople, savePeopleInput } from "@/db/people";
import { consumeRequest } from "@/db/rate-limit";
import { badFields, failure, formOf, redirectTo, returnPath, text, tooMany } from "@/lib/door";
import { hasHouseholdOwnerAccess, householdRequest } from "@/lib/session";

/** Settings, People (D45): `kind=add` adds a person (equal shares again); `kind=people` saves every name and share in one go, fields named `name:<member id>` and, with two or more people, `share:<member id>` in percent; `kind=remove` removes the person `id` (the rule is on `removeMember`). */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const kind = form.get("kind");
  try {
    if (kind !== "add" && kind !== "people" && kind !== "remove") return badFields();
    if (kind === "remove" && !await hasHouseholdOwnerAccess(hid)) return text("Household owner required", 403);
    if (!await consumeRequest(db(), hid, "people", 20)) return tooMany("Too many changes. Try again in a minute.");
    if (kind === "add") {
      const data = addMemberInput.safeParse({ name: form.get("name") });
      if (!data.success) return badFields();
      await addMember(db(), hid, data.data);
      return text("Added. Everyone’s share is now equal; change the shares if you split unevenly.", 200);
    }
    if (kind === "remove") {
      const data = removeMemberInput.safeParse({ id: form.get("id") });
      if (!data.success) return badFields();
      if (!await removeMember(db(), hid, data.data)) return text("Choose a person of this household", 400);
      return redirectTo(returnPath(form.get("returnTo")), request);
    }
    const people = [...form.entries()].flatMap(([key, value]) => key.startsWith("name:") ? [{ id: key.slice(5), name: String(value), percent: form.has(`share:${key.slice(5)}`) ? String(form.get(`share:${key.slice(5)}`)) : undefined }] : []);
    const data = savePeopleInput.safeParse({ people });
    if (!data.success) return badFields();
    await savePeople(db(), hid, data.data);
    return text("Saved", 200);
  } catch (error) {
    return failure(error);
  }
}
