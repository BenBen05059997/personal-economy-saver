import { TryItForm } from "./TryItForm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUid } from "@/lib/auth-request";
import styles from "@/app/page.module.css";

export async function Landing() {
  if (await verifiedUid()) redirect("/onboarding");
  return <main className={styles.landing}>
    <p className={styles.brand}><span aria-hidden="true">¥</span> Personal Economy Saver</p>
    <h1>Will your next payment arrive in time?</h1>
    <p>Follow a fictional Tokyo designer’s bills, cards and client payments over the next 30 days.</p>
    <div className={styles.entries}>
      <TryItForm />
      <Link className={styles.secondary} href="/start">Start with my numbers</Link>
    </div>
    <p style={{ marginTop: "1rem" }}><Link href="/login">Sign in with email</Link></p>
    <p><Link className={styles.secondary} href="/privacy">Privacy</Link></p>
  </main>;
}
