import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { serverDefaultHost } from "@/lib/agent/availability";
import { RAW_FILE_RETENTION_DAYS, STORAGE_CAP_BYTES, DEMO_STORAGE_CAP_BYTES } from "@/db/document-cleanup";
import { AccountFrame } from "@/components/auth/AccountFrame";

export const metadata: Metadata = { title: "Privacy" };

/** Read when the page is requested, never at build time: the server default's host comes from the server's settings. */
async function DefaultHost() {
  await connection();
  const host = serverDefaultHost();
  return <>{host ? `By default, questions and documents go to ${host}.` : "This server has no AI model set up."}</>;
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

export default function PrivacyPage() {
  return <AccountFrame title="Privacy">
    <p className="ui-hint">Last updated Nov 8, 2026.</p>
    <h2>What is stored</h2>
    <p>A household holds its name, time zone, home currency and bank balance; cards; bills and card charges with their category and business share; your clients’ names and email addresses and their invoices; pots and the household split; documents you upload or forward, and what the reader extracted from them; activity events; and settings. The assistant keeps the profile and space notes you ask it to remember. You can see and remove them in Memory or in the space. Saved spaces have a brief and their own conversation thread. You can keep memory and the journal, including the brief, on this device. The AI key you add for your own model is sealed twice (with a secret only the app holds, then again by Supabase’s vault), and the keys you create for other AI assistants are stored hashed. PayPal’s payment notices keep only what they are about and when they arrived.</p>
    <h2>Where your data lives</h2>
    <p>In Supabase in Tokyo: the database, and private storage for documents. The app runs on Cloudflare.</p>
    <h2>Who processes it</h2>
    <ul>
      <li><strong>Supabase</strong> stores the database and files, and sends the sign-in link for your email address.</li>
      <li><strong>Cloudflare</strong> hosts the app and receives bills you forward by email.</li>
      <li><strong>The AI model provider.</strong> <Suspense fallback="Reading this server’s AI settings…"><DefaultHost /></Suspense> The host gets your question and the household figures the assistant looks up when you use Ask, and the document or email the reader reads, only when you use those features. If you choose your own model in Settings, they go to the host Settings shows there instead, on your account with that provider.</li>
      <li><strong>Your browser’s speech service.</strong> When you tap a microphone, your browser turns what you say into text. Chrome sends the audio to Google to do this; Safari can do it on your device. The app never receives audio, only the words, handled like typed text: a question goes to Ask; words for a form go to the AI model provider above, with that form’s field names and choices (such as your card and client names), to fill its fields. Nothing is saved until you tap the form’s button.</li>
      <li><strong>PayPal</strong> (sandbox) gets the amount, currency and item of each payment link when your client taps Pay. If you connect your own PayPal, fipa also reads its balance and the payments it received.</li>
    </ul>
    <p>An Incognito question still goes to the AI model provider with its context. The question and reply stay out of the saved journal. The app temporarily keeps a retry key and leaves your brief and notes as they were.</p>
    <h2>Reminders</h2>
    <p>Reminders are optional. Email reminders use Resend and go to your sign-in address. Web push goes through your browser’s push service. A reminder contains a short summary of new findings, their amounts and space labels when relevant, and a link to the app’s Home page. Document contents are excluded.</p>
    <p>The app keeps delivery records for 30 days. It stores a push endpoint and the keys needed to encrypt messages for that device. You can turn off either channel in Settings. Your data lets you remove reminder records and push subscriptions. The household export excludes them.</p>
    <h2>Clients’ details</h2>
    <p>You type your clients’ names and emails so fipa can show who owes you. They never go to PayPal; fipa sends nothing to a client, and you send each payment link yourself.</p>
    <h2>Try it and Start with my numbers</h2>
    <p>These households live behind a cookie in your browser, with no account. They are deleted seven days after their last change. Reset and Start over replace them at once.</p>
    <h2>How long, and how to delete</h2>
    <p>An account household is kept until you delete it on the account page. That removes the household and what it holds, including its documents, your AI key, what the assistant remembers and your saved questions and replies. Raw files are removed {RAW_FILE_RETENTION_DAYS} days after every reading from them is confirmed or dismissed; what was read from them stays. Each household can keep up to {mb(STORAGE_CAP_BYTES)} MB of files ({mb(DEMO_STORAGE_CAP_BYTES)} MB on Try it). You can delete documents one by one in Settings, under Your data. Export my data in Settings downloads a copy first. Deleting does not remove your sign-in record at Supabase.</p>
    <details className="settings-dev"><summary>For developers</summary>
      <p>Your AI key is encrypted with AES-GCM using a secret only the Worker holds, and the sealed text is kept in Supabase Vault, which encrypts it again. MCP bearer tokens are stored as hashes. PayPal webhook deliveries keep the event id, type, invoice id and time. Documents sit in a private Supabase Storage bucket, which deleting the household also empties. The app runs on Cloudflare Workers.</p></details>
    <h2>Contact</h2>
    <p>This is a hackathon project. Questions go to its owner through the project’s Devpost page.</p>
  </AccountFrame>;
}
