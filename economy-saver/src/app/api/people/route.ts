import { db } from "@/db/client";
import { addMember, addMemberInput, savePeople, savePeopleInput } from "@/db/people";
import { consumeRequest } from "@/db/rate-limit";
import { badFields, failure, text } from "@/lib/door";
import { householdRequest } from "@/lib/session";

/** Settings, People (D45): `kind=add` adds a person (equal shares again); `kind=people` saves every name and share in one go, fields named `name:<member id>` and, with two or more people, `share:<member id>` in percent. */
export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const form = await request.formData();
  const kind = form.get("kind");
  try {
    if (kind !== "add" && kind !== "people") return badFields();
    if (!await consumeRequest(db(), hid, "people", 20)) return text("Too many changes. Try again in a minute.", 429, { "Retry-After": "60" });
    if (kind === "add") {
      const data = addMemberInput.safeParse({ name: form.get("name") });
      if (!data.success) return badFields();
      await addMember(db(), hid, data.data);
      return text("Added. Everyone’s share is now equal; change the shares if you split unevenly.", 200);
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
