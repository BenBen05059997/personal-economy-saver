import type { Metadata } from "next";
import { AccountFrame } from "@/components/auth/AccountFrame";

export const metadata: Metadata = { title: "Privacy · Personal Economy Saver" };

export default function PrivacyPage() {
  return <AccountFrame title="Privacy">
    <p className="ui-hint">Last updated Nov 4, 2026.</p>
    <h2>What is stored</h2>
    <p>A household holds its name, time zone, home currency and bank balance; cards; bills and card charges with their category and business share; your clients’ names and email addresses and their invoices; pots and the household split; documents you upload or forward, and what the reader extracted from them; activity events; and settings. An Anthropic key you add is stored encrypted, and the keys you create for other AI assistants are stored hashed. PayPal’s payment notices keep only what they are about and when they arrived.</p>
    <h2>Where your data lives</h2>
    <p>In Supabase in Tokyo: the database, and private storage for documents. The app runs on Cloudflare.</p>
    <h2>Who processes it</h2>
    <ul>
      <li><strong>Supabase</strong> stores the database and files, and sends the sign-in link for your email address.</li>
      <li><strong>Cloudflare</strong> hosts the app and receives bills you forward by email.</li>
      <li><strong>Anthropic</strong>, in the United States, gets your question and the household figures the assistant looks up when you use Ask, and the document or email the reader reads. Only when you use those features; with your own key, on your account.</li>
      <li><strong>PayPal</strong> (sandbox) gets the invoices and reminders you approve, and is asked for invoice status and balance.</li>
    </ul>
    <h2>Clients’ details</h2>
    <p>You type or import your clients’ names and emails to invoice them; they go to PayPal only on an invoice you approve.</p>
    <h2>Try it and Start with my numbers</h2>
    <p>These households live behind a cookie in your browser, with no account. They are deleted seven days after their last change. Reset and Start over replace them at once.</p>
    <h2>How long, and how to delete</h2>
    <p>An account household is kept until you delete it on the account page. That removes the household and what it holds, including its documents and your AI key. Documents stay until then; deleting a single document is not built. Export my data in Settings downloads a copy first. Deleting does not remove your sign-in record at Supabase.</p>
    <details className="settings-dev"><summary>For developers</summary>
      <p>The Anthropic key is encrypted in Supabase Vault. MCP bearer tokens are stored as hashes. PayPal webhook deliveries keep the event id, type, invoice id and time. Documents sit in a private Supabase Storage bucket, which deleting the household also empties. The app runs on Cloudflare Workers.</p></details>
    <h2>Contact</h2>
    <p>This is a hackathon project. Questions go to its owner through the project’s Devpost page.</p>
  </AccountFrame>;
}
