import Link from "next/link";
import { hasNothingToForecast, homeSentence } from "@/lib/money/sentence";
import { low, safeToSpend, series } from "@/lib/money/runway";
import { hrefFor } from "@/lib/links";
import type { MoneyState } from "@/lib/money/types";

/** The day the sentence names: the lowest point of the line it states. */
export function focusDate(state: MoneyState) {
  if (hasNothingToForecast(state)) return undefined;
  const safe = safeToSpend(state, 0);
  const usualLow = low(series(state, "expected"));
  return safe.low.amount < 0 && usualLow.amount < 0 ? usualLow.date : safe.low.date;
}

/**
 * Home's one sentence, built by `homeSentence`. On Home (`linked`) a client's name opens its page and the date jumps to the
 * runway day; on the family page (D52) the same words are plain text, because nothing there leads into the signed-in app.
 */
export function Sentence({ state, linked }: { state: MoneyState; linked: boolean }) {
  const sentence = homeSentence(state);
  const safe = safeToSpend(state, 0);
  const lead = linked ? sentence.lead.split(/([,\s]+)/).map((word, index) => {
    if (!sentence.lead.startsWith("You're fine if ") || !safe.lateClients.includes(word)) return word;
    const matches = state.clients.filter((client) => client.name.split(" ")[0] === word);
    if (matches.length !== 1) return word;
    return <Link key={index} prefetch={false} href={hrefFor({ type: "client", id: matches[0].id })}>{word}</Link>;
  }) : sentence.lead;
  const target = focusDate(state);
  const cut = sentence.emphasis.lastIndexOf(" on the ");
  const emphasis = linked && target && cut >= 0
    ? <>{sentence.emphasis.slice(0, cut)} <a href="#runway-day">{sentence.emphasis.slice(cut + 1, -1)}</a>.</>
    : sentence.emphasis;
  return <>{lead} <span className={safe.shortBy > 0 ? "home-short" : undefined}>{emphasis}</span></>;
}
