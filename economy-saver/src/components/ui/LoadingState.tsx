import { LogoMark } from "@/components/shell/Logo";
import styles from "./LoadingState.module.css";

/** Small, inline: a ring in the accent colour and a label. */
export function LoadingIndicator({ label }: { label: string }) {
  return <span className={styles.indicator} role="status">
    <span className={styles.spinner} aria-hidden="true" />
    <span>{label}</span>
  </span>;
}

/** The one full loader: the fipa mark breathing, an indeterminate bar and a label, centred in the space. */
export function LoadingState({ label = "Opening your household…" }: { label?: string }) {
  return <main className={styles.page} aria-busy="true">
    <div className={styles.stack} role="status">
      <span className={styles.mark}><LogoMark size={56} /></span>
      <span className={styles.bar} aria-hidden="true"><span className={styles.fill} /></span>
      <span className={styles.label}>{label}</span>
    </div>
  </main>;
}
