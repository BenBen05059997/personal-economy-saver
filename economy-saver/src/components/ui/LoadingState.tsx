import styles from "./LoadingState.module.css";

export function LoadingIndicator({ label }: { label: string }) {
  return <span className={styles.indicator} role="status">
    <span className={styles.spinner} aria-hidden="true" />
    <span>{label}</span>
  </span>;
}

export function LoadingState({ label = "Opening your household…" }: { label?: string }) {
  return <main className={styles.page} aria-busy="true">
    <LoadingIndicator label={label} />
  </main>;
}
