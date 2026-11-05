import { db } from "@/db/client";
import { clientInput, insertClient } from "@/db/clients";
import { badFields, failure, redirectTo, formOf } from "@/lib/door";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  const body = await formOf(request);
  if (body instanceof Response) return body;
  const data = clientInput.safeParse(Object.fromEntries(body));
  if (!data.success) return badFields();
  try {
    return redirectTo(`/clients/${await insertClient(db(), hid, data.data)}`, request);
  } catch (error) {
    return failure(error);
  }
}
