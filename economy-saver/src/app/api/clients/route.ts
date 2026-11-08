import { db } from "@/db/client";
import { withHousehold } from "@/db/household";
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
    const id = await withHousehold(db(), hid, tx => insertClient(tx, hid, data.data));
    return redirectTo(`/clients/${id}`, request);
  } catch (error) {
    return failure(error);
  }
}
