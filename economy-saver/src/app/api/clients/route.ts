import { db } from "@/db/client";
import { clientInput, insertClient } from "@/db/clients";
import { badFields, failure, redirectTo } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const data = clientInput.safeParse(Object.fromEntries(await request.formData()));
  if (!data.success) return badFields();
  try {
    return redirectTo(`/clients/${await insertClient(db(), hid, data.data)}`);
  } catch (error) {
    return failure(error);
  }
}
