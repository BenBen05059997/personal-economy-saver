"use client";

import { useState } from "react";
import { PERSONAS, PERSONA_ORDER } from "@/lib/sample/personas";
import { AddMenu } from "./AddMenu";
import { useApp } from "./AppContext";
import { cx } from "./cx";
import { currencySymbol, group, homeFormat, parseAmount, weekdayLabel } from "./format";
import { Address } from "./Inbox";
import styles from "./TopBar.module.css";
import ui from "./ui.module.css";

/** On every tab: the app name, who is looking, the cash behind the numbers, the forwarding address and the demo triggers. */
export function TopBar() {
  const { persona, money, state, dispatch, switchPerson, play, reset, startTrip, openStatement } = useApp();
  const { playing, opened } = state;
  const fmt = homeFormat(money);
  const sym = currencySymbol(money.homeCurrency);
  // The field keeps what the person types; the numbers update when they leave it.
  const [text, setText] = useState(group(money.bank));

  function commit() {
    const n = parseAmount(text);
    dispatch({ type: "bank", value: n });
    setText(group(n));
  }

  return (
    <div className={styles.topbar}>
      <div className={styles.brand}>
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
          <rect width="30" height="30" rx="8" fill="var(--accent)" />
          <path d="M6 19 L11 14 L15 17 L24 8" stroke="var(--accent-ink)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 23 H24" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" opacity=".55" />
        </svg>
        <div>
          <b>Economy Saver</b>
          <small>
            {persona.profile.name} · {persona.role} · {weekdayLabel(money.today)}
          </small>
        </div>
      </div>
      <div className={styles.addMobile}>
        <AddMenu placement="header" />
      </div>
      <div className={styles.who} role="group" aria-label="Demo person">
        {PERSONA_ORDER.map((id) => (
          <button key={id} type="button" aria-pressed={id === persona.id} disabled={playing} onClick={() => id !== persona.id && switchPerson(id)}>
            {PERSONAS[id].switchLabel}
          </button>
        ))}
      </div>
      <div className={styles.chips}>
        <span className={styles.chip}>
          <span className={styles.k}>PayPal</span>
          <span className={styles.v}>{fmt(money.paypal)}</span>
          <span className={cx(styles.tag, styles.live)}>sandbox · live</span>
        </span>
        <span className={styles.chip}>
          <label className={styles.k} htmlFor="bank-input">
            Bank
          </label>
          {sym}
          <input
            id="bank-input"
            type="text"
            inputMode="numeric"
            value={text}
            aria-label={`Bank balance in ${money.homeCurrency === "JPY" ? "yen" : "dollars"}`}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <span className={styles.tag}>typed in</span>
        </span>
        <span className={cx(styles.chip, styles.inbox)}>
          <span className={styles.k}>Bills inbox</span>
          <Address />
        </span>
      </div>
      <div className={styles.demo} role="group" aria-label="Demo">
        <span className={styles.demoLabel}>Demo</span>
        <button className={cx(ui.btn, ui.primary, styles.dbtn)} type="button" onClick={play} disabled={playing}>
          <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 1.2v9.6L10.4 6z" fill="currentColor" />
          </svg>
          Play the demo
        </button>
        <button className={cx(ui.btn, ui.demo, styles.dbtn)} type="button" onClick={startTrip} disabled={playing}>
          {persona.demo.trip.button.replace(/^Demo: /, "")}
        </button>
        <button className={cx(ui.btn, ui.demo, styles.dbtn)} type="button" aria-pressed={opened.includes("statement")} onClick={openStatement}>
          Card statement arrives
        </button>
        <button className={cx(ui.btn, ui.ghost, styles.dbtn)} type="button" onClick={reset} disabled={playing}>
          Reset
        </button>
      </div>
    </div>
  );
}
