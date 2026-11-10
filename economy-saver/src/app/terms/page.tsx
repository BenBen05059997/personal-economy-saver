import type { Metadata } from "next";
import Link from "next/link";
import { AccountFrame } from "@/components/auth/AccountFrame";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return <AccountFrame title="Terms">
    <p className="ui-hint">Last updated Nov 10, 2026.</p>
    <h2>A hackathon demo</h2>
    <p>This is a hackathon project. It is a demo, not a service you can rely on. It can change or go away at any time.</p>
    <h2>No real money</h2>
    <p>The app talks to PayPal’s sandbox only. No real money moves, and no real invoice reaches a real client.</p>
    <h2>Fictional data</h2>
    <p>The sample household, its clients and its bills are made up. Any real person or company with the same name is a coincidence.</p>
    <h2>Not advice</h2>
    <p>Nothing here is financial, tax or legal advice. The suggestions are information. Check your own numbers and ask a professional before you act on them.</p>
    <h2>Your AI key</h2>
    <p>If you add your own AI key, the app uses it only for your household’s own requests. You can remove it in Settings at any time.</p>
    <p>See also how your data is stored in the <Link className="account-link" href="/privacy">Privacy page ›</Link>.</p>
  </AccountFrame>;
}
