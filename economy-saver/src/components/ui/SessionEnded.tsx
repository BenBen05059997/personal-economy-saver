import Link from "next/link";

import { SESSION_ENDED } from "@/lib/session-ended";

export function SessionEnded() {
  return <>{SESSION_ENDED} <Link href="/">Start again from the home page.</Link></>;
}
