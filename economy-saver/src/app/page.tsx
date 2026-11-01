import { AppShell } from "@/components/app/AppShell";
import styles from "./page.module.css";

// The whole screen is client-side state on sample data, so the page itself is static.
export default function Home() {
  return (
    <main className={`wrap ${styles.page}`}>
      <header className={styles.head}>
        <span className="eyebrow">Sandbox only · sample data</span>
        <h1>Personal Economy Saver</h1>
        <p className={styles.lede}>
          Reads your bills, watches your PayPal income, tells you the cheapest money move when you need it, and acts through PayPal when you approve. Every number here is a sample.
        </p>
      </header>
      <AppShell />
    </main>
  );
}
