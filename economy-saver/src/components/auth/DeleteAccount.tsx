import Link from "next/link";
import { ApiForm } from "@/components/ui/ApiForm";

const WORDS = {
  owner: { text: "Deleting your account permanently removes your household (its bills, invoices, cards, activity and members) and your sign-in email.", check: "Delete my account, my household and its data" },
  member: { text: "This removes you from this household and deletes your sign-in email. The shared records stay with the household.", check: "I understand this can't be undone" },
  none: { text: "This deletes your sign-in email. You have no household here.", check: "I understand this can't be undone" },
} as const;

/** Delete my account, for every signed-in person; the words follow the role (`none`: signed in without a household). */
export function DeleteAccount({ role }: { role: keyof typeof WORDS }) {
  const { text, check } = WORDS[role];
  return <section className="account-danger"><h2>Delete my account</h2>
    <p><Link className="account-link" href="/privacy">How your data is stored and deleted ›</Link></p>
    <p>{text}</p>
    <ApiForm action="/api/account">
      <label className="ui-check"><input type="checkbox" name="confirmation" value="delete" required /> {check}</label>
      <button className="ui-button">Delete my account</button>
    </ApiForm>
  </section>;
}
