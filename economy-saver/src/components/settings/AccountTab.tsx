import Link from "next/link";
import { ApiForm } from "@/components/ui/ApiForm";
import "@/components/auth/account.css";
import { DeleteAccount } from "@/components/auth/DeleteAccount";
import { ResetDemo } from "./ResetDemo";

/** Settings → Account: sign in or out, leave the household, delete the account, and reset a Try it household. `role` is null without a sign-in (a Try it household). */
export function AccountTab({ role }: { role: "owner" | "member" | null }) {
  return <section className="ui-panel" id="account"><div className="account-page settings-account"><h2>Your account</h2>
    {role === null ? <>
      <p>This is a Try it household. Sign in with email to start your own household.</p><Link href="/login">Sign in with email</Link> <Link className="account-link" href="/privacy">Privacy ›</Link>
      <section className="account-danger"><h2>Delete this Try it household</h2>
        <p>Its sample data is removed now, and this browser goes back to the start page.</p>
        <ApiForm action="/api/try/delete">
          <label className="ui-check"><input type="checkbox" required /> I understand this can&apos;t be undone</label>
          <button className="ui-button">Delete now</button>
        </ApiForm>
      </section>
      <ResetDemo />
    </> : <>
      <form method="post" action="/api/auth/logout"><button className="ui-button">Sign out</button></form>
      {role === "member" ? <section className="account-danger">
        <h2>Leave household</h2>
        <p>Leaving stops your access and reminders for this household. The shared records stay with the household.</p>
        <ApiForm action="/api/invites">
          <input type="hidden" name="kind" value="leave" />
          <label className="ui-check"><input type="checkbox" required /> Leave this household</label>
          <button type="submit" className="ui-button">Leave household</button>
        </ApiForm>
      </section> : null}
      <DeleteAccount role={role} />
    </>}
  </div></section>;
}
