import { LoadingState } from "@/components/ui/LoadingState";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountFrame } from "@/components/auth/AccountFrame";
import { ApiForm } from "@/components/ui/ApiForm";
import { verifiedUid } from "@/lib/auth-request";
import { accountHousehold } from "@/db/account";
import { db } from "@/db/client";
import { currentHouseholdId } from "@/lib/session";

async function Account() {
  const uid = await verifiedUid();
  if (!uid) {
    if (!await currentHouseholdId()) redirect("/login");
    return <AccountFrame title="Your account"><p>This is a Try it household. Sign in with email to start your own household.</p><Link href="/login">Sign in with email</Link> <Link className="account-link" href="/privacy">Privacy ›</Link>
      {/* Clears this device's household cookie (the same route signs out an account); the sweeper (D49) deletes the household seven days after its last change. */}
      <form method="post" action="/api/auth/logout"><p>Leave this household. It stays on this device for seven days, then it is swept.</p><button className="ui-button">Leave this household</button></form></AccountFrame>;
  }
  if (!await accountHousehold(db(), uid)) redirect("/onboarding");
  return <AccountFrame title="Your account">
    <form method="post" action="/api/auth/logout"><button className="ui-button">Sign out</button></form>
    <section className="account-danger"><h2>Delete household</h2>
      <p><Link className="account-link" href="/privacy">How your data is stored and deleted ›</Link></p>
      <p>Deleting your household permanently removes its bills, invoices, cards, activity and members.</p>
      <ApiForm action="/api/household">
        <label className="ui-check"><input type="checkbox" name="confirmation" value="delete" required /> Delete my household and its data</label>
        <button className="ui-button">Delete household</button>
      </ApiForm>
    </section>
  </AccountFrame>;
}
export default function AccountPage() {
  return <Suspense fallback={<LoadingState label="Opening account…" />}><Account /></Suspense>;
}
