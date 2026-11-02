import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccountFrame } from "@/components/auth/AccountFrame";
import { verifiedUid } from "@/lib/auth-request";

async function Login({ searchParams }: PageProps<"/login">) {
  if (await verifiedUid()) redirect("/account");
  const params = await searchParams;
  return <AccountFrame title={params.sent ? "Check your email" : "Sign in with email"}>
    {params.sent ? <p>Open the sign-in link in this browser to finish.</p> : <>
      <p className="ui-hint">We’ll email a one-time link. If this is your first visit, you’ll set up your household after opening it.</p>
      {params.expired && <p role="alert">That link is invalid or has expired. Request a new link and open it in this browser.</p>}
      <form method="post" action="/api/auth/link">
        <label className="ui-field">Email address<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <button className="ui-button primary">Email me a sign-in link</button>
      </form>
    </>}
  </AccountFrame>;
}
export default function LoginPage(props: PageProps<"/login">) {
  return <Suspense fallback={<main aria-busy="true">Opening sign in…</main>}><Login {...props} /></Suspense>;
}
