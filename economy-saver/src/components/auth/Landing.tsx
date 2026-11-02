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
    <form method="get" action="/api/try"><button>Try it</button></form>
    <p style={{ marginTop: "1rem" }}><Link href="/login">Sign in with email</Link></p>
  </main>;
}
