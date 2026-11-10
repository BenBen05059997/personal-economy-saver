import Link from "next/link";
import { homeSentence } from "@/lib/money/sentence";
import { hrefFor } from "@/lib/links";
import type { MoneyState } from "@/lib/money/types";

/**
 * Home's one sentence, built by `homeSentence`, which hands over its parts. On Home (`linked`) a client's name opens its page and the
 * date jumps to the Next 30 days panel; on the family page (D52) the same words are plain text, because nothing there leads into the signed-in app.
 */
export function Sentence({ state, linked }: { state: MoneyState; linked: boolean }) {
  const sentence = homeSentence(state);
  const lead = linked ? sentence.leadParts.map((part, index) => typeof part === "string" ? part
    : <Link key={index} prefetch={false} href={hrefFor({ type: "client", id: part.id })}>{part.name}</Link>) : sentence.lead;
  const { before, on } = sentence.emphasisParts;
  const emphasis = linked && sentence.day && on ? <>{before} <a href="#next-30-days">{on}</a>.</> : sentence.emphasis;
  return <>{lead} <span className={sentence.short ? "home-short" : undefined}>{emphasis}</span></>;
}
