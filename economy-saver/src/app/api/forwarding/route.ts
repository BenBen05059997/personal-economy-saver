import { db } from "@/db/client";
import { text } from "@/lib/door";
import { redirectTo } from "@/lib/form-fetch";
import { forwardingAddress } from "@/lib/reader/forwarding";
import { ReaderError } from "@/lib/reader/settings";
import { householdRequest } from "@/lib/session";

export async function POST(request: Request) {
  const hid = await householdRequest(request);
  if (hid instanceof Response) return hid;
  try { await forwardingAddress(db(), hid); }
  catch (error) {
    if (error instanceof ReaderError) return text(error.message, 400);
    throw error;
  }
  return redirectTo("/bills#forwarding");
}
