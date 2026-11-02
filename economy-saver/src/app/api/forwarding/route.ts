import { db } from "@/db/client";
import { forwardingAddress } from "@/lib/reader/forwarding";
import { ReaderError } from "@/lib/reader/settings";
import { currentHouseholdId, sameOrigin } from "@/lib/session";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const hid = await currentHouseholdId();
  if (!hid) return new Response(null, { status: 401 });
  try { await forwardingAddress(db(), hid); }
  catch (error) {
    if (error instanceof ReaderError) return new Response(error.message, { status: 400 });
    throw error;
  }
  return new Response(null, { status: 303, headers: { Location: "/settings#forwarding" } });
}
