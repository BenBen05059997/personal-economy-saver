import Link from "next/link";

/** What Ask says when a request comes back 401: the session ended. The landing page is where Try it or sign-in starts again. */
export const SESSION_ENDED = "Your session has expired.";

export function SessionEnded() {
  return <>{SESSION_ENDED} <Link href="/">Start again from the home page.</Link></>;
}
