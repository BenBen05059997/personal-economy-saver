"use client";

import { useEffect, useRef } from "react";
import { cx } from "../know/format";
import styles from "./ConfirmStep.module.css";

// The inline "Do this now?" step. Every action goes through it; nothing happens unasked.
export function ConfirmStep({
  detail,
  onConfirm,
  onCancel,
}: {
  detail?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  return (
    <div className={styles.confirm} role="group" aria-label="Confirm">
      <p className={styles.q}>Do this now?</p>
      {detail && <p className={styles.detail}>{detail}</p>}
      <div className={styles.row}>
        <button ref={confirmRef} type="button" className={cx(styles.btn, styles.primary)} onClick={onConfirm}>
          Confirm
        </button>
        <button type="button" className={styles.btn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
