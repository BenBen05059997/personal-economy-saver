import Link from "next/link";
import "@/components/auth/account.css";

export default function NotFound() {
  return <main className="account-page">
    <h1 className="ui-title">Page not found</h1>
    <p>There is nothing at this address.</p>
    <p><Link href="/" className="ui-button">Go Home</Link></p>
  </main>;
}
