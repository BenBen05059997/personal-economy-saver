"use client";

import { useRef } from "react";
import { useApp } from "./AppContext";
import { cx } from "./cx";
import styles from "./Inbox.module.css";
import ui from "./ui.module.css";

/** The forwarding address and a Copy button. Falls back to selecting the text when the clipboard is blocked. */
export function Address({ className }: { className?: string }) {
  const { persona, toast } = useApp();
  const ref = useRef<HTMLSpanElement>(null);

  function selectIt() {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    toast("Selected. Press Cmd+C to copy.");
  }

  function copy() {
    try {
      navigator.clipboard.writeText(persona.inbox).then(() => toast("Copied. Forward bills to this address."), selectIt);
    } catch {
      selectIt();
    }
  }

  return (
    <span className={cx(styles.address, className)}>
      <span className={styles.addr} ref={ref}>
        {persona.inbox}
      </span>
      <button type="button" className={styles.copy} onClick={copy}>
        Copy
      </button>
    </span>
  );
}

/** The existing upload: a file picker that tells the person what the app would do with it. */
export function useUpload() {
  const { persona, toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const field = (
    <input
      ref={input}
      className={styles.hidden}
      type="file"
      accept="image/*,application/pdf"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        if (e.target.files?.length) toast(persona.demo.uploadToast);
        e.target.value = "";
      }}
    />
  );
  return { field, open: () => input.current?.click() };
}

export function UploadPhoto({ className }: { className?: string }) {
  const { field, open } = useUpload();
  return (
    <>
      <button type="button" className={cx(ui.btn, className)} onClick={open}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 10V2M3.5 5.5 7 2l3.5 3.5M2 12h10" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Upload a photo
      </button>
      {field}
    </>
  );
}
