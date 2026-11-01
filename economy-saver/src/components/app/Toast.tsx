"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "./cx";
import styles from "./Toast.module.css";

/** One message at a time, hidden after 2.6 seconds. */
export function useToast() {
  const [state, setState] = useState({ message: "", visible: false });
  const timer = useRef(0);

  const show = useCallback((message: string) => {
    setState({ message, visible: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState((s) => ({ ...s, visible: false })), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { ...state, show };
}

export function Toast({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div className={cx(styles.toast, visible && styles.show)} role="status" aria-live="polite">
      {message}
    </div>
  );
}
