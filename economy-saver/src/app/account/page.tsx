import { LoadingState } from "@/components/ui/LoadingState";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountFrame } from "@/components/auth/AccountFrame";
import { verifiedUid } from "@/lib/auth-request";
import { accountHousehold } from "@/db/account";
import { db } from "@/db/client";
import { currentHouseholdId } from "@/lib/session";

async function Account() {
  const uid = await verifiedUid();
  if (!uid) {
    if (!await currentHouseholdId()) redirect("/login");
    return <AccountFrame title="Your account"><p>This is a Try it household. Sign in with email to start your own household.</p><Link href="/login">Sign in with email</Link></AccountFrame>;
  }
  if (!await accountHousehold(db(), uid)) redirect("/onboarding");
  return <AccountFrame title="Your account">
    <form method="post" action="/api/auth/logout"><button className="ui-button">Sign out</button></form>
    <section className="account-danger"><h2>Delete household</h2>
      <p>Deleting your household permanently removes its bills, invoices, cards, activity and members.</p>
      <form method="post" action="/api/household">
        <label><input type="checkbox" name="confirmation" value="delete" required /> Delete my household and its data</label>
        <button className="ui-button">Delete household</button>
      </form>
    </section>
  </AccountFrame>;
}
export default function AccountPage() {
  return <Suspense fallback={<LoadingState label="Opening account…" />}><Account /></Suspense>;
}
