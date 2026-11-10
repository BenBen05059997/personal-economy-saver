"use client";

import { useState } from "react";
import Link from "next/link";
import { ApiForm, ApiFormNavigation } from "@/components/ui/ApiForm";
import { FORM_REDIRECT_HEADER } from "@/lib/form-fetch";
import styles from "@/app/page.module.css";

export function LandingSignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return <section id="signin" aria-labelledby="signin-title" className={styles.signin}>
    <div><h2 id="signin-title">Sign in or create an account</h2>
      <p>We email you a one-time link. If you&apos;ve been here before, it signs you in. If you&apos;re new, it starts your account.</p></div>
    {sent ? <div className={styles.inbox} role="status"><div><strong>Check your inbox</strong><p>We sent a link to {email}. Open it on this device to continue.</p><button type="button" onClick={() => setSent(false)}>Use a different email</button></div></div> :
      <ApiFormNavigation.Provider value={(action, destination) => action === "/api/auth/link" && destination === "/login?sent=1"}>
        <ApiForm action="/api/auth/link" className={styles.emailForm} onDone={(response) => { if (response.headers.get(FORM_REDIRECT_HEADER) === "/login?sent=1") setSent(true); }}>
          <label htmlFor="landing-email">Email</label><input id="landing-email" type="email" name="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <button type="submit">Email me a sign-in link</button>
        </ApiForm>
      </ApiFormNavigation.Provider>}
    <div className={styles.signinFoot}><p><strong>Invited to a household?</strong> Open the link in your invite email. It signs you in to that household.</p><p>No password. Your email is used to sign you in and for reminders you turn on. <Link href="/privacy">Privacy</Link></p></div>
  </section>;
}
