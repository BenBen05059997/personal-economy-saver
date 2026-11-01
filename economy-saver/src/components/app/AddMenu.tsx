"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "./AppContext";
import { cx } from "./cx";
import { Address, useUpload } from "./Inbox";
import styles from "./AddMenu.module.css";
import ui from "./ui.module.css";

/** The one Add button: forward an email, upload a photo, or start an invoice. */
export function AddMenu({ placement }: { placement: "side" | "header" }) {
  const { go } = useApp();
  const [open, setOpen] = useState(false);
  const [forward, setForward] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const upload = useUpload();

  useEffect(() => {
    if (!open) return;
    const close = (refocus: boolean) => {
      setOpen(false);
      setForward(false);
      if (refocus) button.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    setOpen((o) => !o);
    setForward(false);
  }

  function pick(run: () => void) {
    setOpen(false);
    setForward(false);
    run();
  }

  return (
    <div className={cx(styles.root, placement === "side" ? styles.side : styles.header)} ref={root}>
      <button ref={button} type="button" className={cx(ui.btn, ui.primary, styles.add)} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={toggle}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Add
      </button>
      {upload.field}
      {open && (
        <div className={styles.menu} id={menuId} role="menu" aria-label="Add">
          {forward ? (
            <div className={styles.forward}>
              <b>Forward an email</b>
              <p>Bills, card emails and receipts you forward to this address are read for you to confirm.</p>
              <Address />
              <button type="button" className={styles.back} onClick={() => setForward(false)}>
                Back
              </button>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => setForward(true)}>
                Forward an email
              </button>
              <button type="button" role="menuitem" onClick={() => pick(upload.open)}>
                Upload a photo
              </button>
              <button type="button" role="menuitem" onClick={() => pick(() => go("paid"))}>
                New invoice
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
