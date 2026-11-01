"use client";

import type { Move, Suggestion } from "@/lib/catalogue/types";
import { cx } from "./format";
import styles from "./Why.module.css";

const CONFIDENCE: Record<Move["confidence"], string> = {
  verified_primary: "Checked against the primary source",
  secondary: "Secondary sources",
  anecdotal: "Community reports only",
};

export function SourceChips({ sources }: { sources: Move["sources"] }) {
  if (!sources?.length) return null;
  return (
    <ul className={styles.sources} aria-label="Sources" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {sources.map((s) => {
        const safe = /^https?:\/\//i.test(s.url);
        const inner = (
          <>
            {s.title} · <time dateTime={s.asOf}>{s.asOf}</time>
          </>
        );
        return (
          <li key={s.url + s.title}>
            {safe ? (
              <a className={styles.source} href={s.url} target="_blank" rel="noreferrer">
                {inner}
              </a>
            ) : (
              <span className={styles.source}>{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Everything behind "Why": the fact, where the number came from, steps, traps, notes, sources.
export function WhyBody({
  s,
  showFact = true,
  showNotes = true,
}: {
  s: Suggestion;
  showFact?: boolean;
  showNotes?: boolean; // false when the card already shows exitNote and taxNote inline
}) {
  const { move, value } = s;
  return (
    <div className={styles.body}>
      {showFact && <p className={styles.fact}>{move.fact}</p>}
      {value.basis && (
        <p>
          <span className={styles.label}>Your number</span>
          <span className={styles.num}>{value.basis}</span>
        </p>
      )}
      {move.valueText && (
        <p>
          <span className={styles.label}>How it is worked out</span>
          {move.valueText}
        </p>
      )}
      {!!move.steps?.length && (
        <div>
          <span className={styles.label}>Steps</span>
          <ol className={styles.list}>
            {move.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
      )}
      {!!move.traps?.length && (
        <div>
          <span className={styles.label}>Watch out for</span>
          <ul className={styles.list}>
            {move.traps.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {showNotes && move.exitNote && (
        <p className={styles.note}>
          <span className={styles.label}>Before you start, how to get out</span>
          {move.exitNote}
        </p>
      )}
      {showNotes && move.taxNote && (
        <p className={styles.note}>
          <span className={styles.label}>Tax</span>
          {move.taxNote}
        </p>
      )}
      <div className={styles.meta}>
        {move.illustrative && (
          <span className={styles.tagWarn} title="This number uses example figures, not verified ones">
            Sample figure
          </span>
        )}
        {move.confidence && <span className={styles.tag}>{CONFIDENCE[move.confidence]}</span>}
      </div>
      <SourceChips sources={move.sources} />
    </div>
  );
}

export function WhyDisclosure({
  s,
  showFact = true,
  showNotes = true,
  className,
}: {
  s: Suggestion;
  showFact?: boolean;
  showNotes?: boolean;
  className?: string;
}) {
  return (
    <details className={cx(styles.details, className)}>
      <summary>Why</summary>
      <WhyBody s={s} showFact={showFact} showNotes={showNotes} />
    </details>
  );
}
