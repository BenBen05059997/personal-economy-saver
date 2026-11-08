import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountFrame } from "@/components/auth/AccountFrame";
import { ApiForm } from "@/components/ui/ApiForm";
import { LoadingState } from "@/components/ui/LoadingState";
import { db } from "@/db/client";
import { inviteView } from "@/db/invites";
import { verifiedIdentity } from "@/lib/auth-request";

export const metadata: Metadata = {
  title: "Join a household · Personal Economy Saver",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type JoinProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ sent?: string | string[]; expired?: string | string[]; refused?: string | string[] }>;
};

async function Join({ params, searchParams }: JoinProps) {
  await connection();
  const [{ token }, status] = await Promise.all([params, searchParams]);
  const invite = await inviteView(db(), token);
  if (!invite) return <AccountFrame title="Invitation unavailable">
    <p>This invitation is no longer available. Ask the household owner for a new link.</p>
  </AccountFrame>;

  const identity = await verifiedIdentity();
  if (!identity && status.sent === "1") return <AccountFrame title="Check your email">
    <p>Open the sign-in link in this browser to finish joining the household.</p>
  </AccountFrame>;

  return <AccountFrame title="Join a household">
    <p>You’re invited to join <strong>{invite.householdName}</strong> as <strong>{invite.memberName}</strong>.</p>
    {status.expired === "1" && <p role="alert">That sign-in link is invalid or has expired. Request a new one and open it in this browser.</p>}
    {status.refused === "1" && <p role="alert">This sign-in couldn’t join the household. Use the email address the household owner invited.</p>}
    {identity ? <>
      <p className="ui-hint">Continue with your current sign-in to accept this invitation.</p>
      <ApiForm action="/api/invites">
        <input type="hidden" name="kind" value="accept" />
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="ui-button primary">Join household</button>
      </ApiForm>
      <ApiForm action="/api/auth/logout">
        <p className="ui-hint">To use a different email address, sign out and reopen this invitation.</p>
        <button type="submit" className="ui-button">Sign out</button>
      </ApiForm>
    </> : <ApiForm action="/api/auth/link">
      <input type="hidden" name="invite" value={token} />
      <label className="ui-field">Email address<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
      <button type="submit" className="ui-button primary">Email me a sign-in link</button>
    </ApiForm>}
  </AccountFrame>;
}

export default function JoinPage(props: JoinProps) {
  return <Suspense fallback={<LoadingState label="Opening the invitation…" />}><Join {...props} /></Suspense>;
}
