import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
import { addMember, addMemberInput, removeMember, removeMemberInput, savePeople, savePeopleInput } from "@/db/people";
import { badFields, failure, householdForm, limited, redirectTo, returnPath, text } from "@/lib/door";
import { hasHouseholdOwnerAccess } from "@/lib/session";

/** Settings, People (D45): `kind=add` adds a person (equal shares again) and returns to `returnTo`; `kind=people` saves every name and share in one go, fields named `name:<member id>` and, with two or more people, `share:<member id>` in percent; `kind=remove` removes the person `id` (the rule is on `removeMember`). */
export async function POST(request: Request) {
  const ctx = await householdForm(request);
  if (ctx instanceof Response) return ctx;
  const { hid, form } = ctx;
  const kind = form.get("kind");
  try {
    if (kind !== "add" && kind !== "people" && kind !== "remove") return badFields();
    if (kind === "remove" && !await hasHouseholdOwnerAccess(hid)) return text("Household owner required", 403);
    const busy = await limited(hid, "people", 20, "Too many changes. Try again in a minute.");
    if (busy) return busy;
    if (kind === "add") {
      const data = addMemberInput.safeParse({ name: form.get("name") });
      if (!data.success) return badFields();
      await withHousehold(db(), hid, tx => addMember(tx, hid, data.data));
      return redirectTo(returnPath(form.get("returnTo")), request);
    }
    if (kind === "remove") {
      const data = removeMemberInput.safeParse({ id: form.get("id") });
      if (!data.success) return badFields();
      if (!await withHousehold(db(), hid, tx => removeMember(tx, hid, data.data))) return text("Choose a person of this household", 400);
      return redirectTo(returnPath(form.get("returnTo")), request);
    }
    const people = [...form.entries()].flatMap(([key, value]) => key.startsWith("name:") ? [{ id: key.slice(5), name: String(value), percent: form.has(`share:${key.slice(5)}`) ? String(form.get(`share:${key.slice(5)}`)) : undefined }] : []);
    const data = savePeopleInput.safeParse({ people });
    if (!data.success) return badFields();
    await withHousehold(db(), hid, tx => savePeople(tx, hid, data.data));
    return text("Saved", 200);
  } catch (error) {
    return failure(error);
  }
}
