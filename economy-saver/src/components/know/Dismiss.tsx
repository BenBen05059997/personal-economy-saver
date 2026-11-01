"use client";

import styles from "./Dismiss.module.css";

export function DismissButtons({ onLater, onNever }: { onLater: () => void; onNever: () => void }) {
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.link} onClick={onLater}>
        Not now
      </button>
      <button type="button" className={styles.link} onClick={onNever}>
        Never for this
      </button>
    </div>
  );
}

export function UndoLine({ title, onUndo }: { title: string; onUndo: () => void }) {
  return (
    <p className={styles.undo} role="status">
      <span>We won&apos;t suggest &ldquo;{title}&rdquo; again.</span>
      <button type="button" className={styles.link} onClick={onUndo}>
        Undo
      </button>
    </p>
  );
}
