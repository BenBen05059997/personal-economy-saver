import { NO_REFERRER, redirectTo } from "@/lib/door";

/** The URL the sign-in email links to (registered in Supabase). It only hands the query to the loading page, which then opens /api/auth/finish. */
export async function GET(request: Request) {
  return redirectTo("/signing-in" + new URL(request.url).search, undefined, NO_REFERRER);
}
