"use client";

import type { ReactNode } from "react";
import { useApp } from "./AppContext";
import { cx } from "./cx";
import styles from "./Nav.module.css";
import { TABS, type TabId } from "./tabs";

const ICON: Record<TabId, ReactNode> = {
  today: <path d="M3.5 10.2 10 4.5l6.5 5.7V16a.8.8 0 0 1-.8.8H4.3a.8.8 0 0 1-.8-.8z M8 16.8v-4.5h4v4.5" />,
  plan: <path d="M3 15.5 7.5 10l3.2 3L17 5.5 M3 17.5h14" />,
  cards: <path d="M3 6.2a1.2 1.2 0 0 1 1.2-1.2h11.6A1.2 1.2 0 0 1 17 6.2v7.6a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 13.8z M3 8.5h14 M5.8 12.2h3" />,
  paid: <path d="M5 3.5h10v13l-2.5-1.6-2.5 1.6-2.5-1.6L5 16.5z M7.6 7.5h4.8 M7.6 10.5h3" />,
  activity: <path d="M3.5 5.5h13 M3.5 10h13 M3.5 14.5h8" />,
};

/** The five tabs. A phone gets a bar fixed to the bottom of the screen; a wide screen gets the same links in the sidebar. */
export function Nav({ placement }: { placement: "side" | "bottom" }) {
  const { tab, check } = useApp();
  return (
    <nav className={cx(styles.nav, placement === "side" ? styles.side : styles.bottom)} aria-label={placement === "side" ? "Sections" : "Sections, bottom bar"}>
      {TABS.map((t) => {
        const badge = t.id === "activity" && check.count > 0 ? check.count : 0;
        return (
          <a key={t.id} className={styles.link} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined}>
            <span className={styles.icon}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {ICON[t.id]}
              </svg>
              {badge > 0 && (
                <span className={styles.badgeDot} aria-hidden="true">
                  {badge}
                </span>
              )}
            </span>
            <span>{t.label}</span>
            {badge > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {badge}
              </span>
            )}
            {badge > 0 && <span className={styles.sr}>{`, ${badge} to check`}</span>}
          </a>
        );
      })}
    </nav>
  );
}
