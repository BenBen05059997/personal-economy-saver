import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUid } from "@/lib/auth-request";
import { PROVIDERS } from "@/lib/ai/providers";
import { benMoney } from "@/lib/sample/ben";
import { dayLabel, formatter, usd } from "@/lib/money/format";
import { addDays, daysBetween, low, safeToSpend, series, statementItems } from "@/lib/money/runway";
import { homeSentence } from "@/lib/money/sentence";
import { whatIf } from "@/lib/money/whatif";
import { LogoMark } from "@/components/shell/Logo";
import { TryItForm } from "./TryItForm";
import { LandingSignIn } from "./LandingSignIn";
import styles from "@/app/page.module.css";

function Forecast() {
  const late = series(benMoney, "worst"), usual = series(benMoney, "expected");
  const point = low(late), format = formatter(benMoney.homeCurrency);
  const all = [...late, ...usual, 0], min = Math.min(...all), max = Math.max(...all);
  const x = (index: number) => 560 * index / (late.length - 1);
  const y = (value: number) => 12 + (max - value) * 130 / (max - min || 1);
  const line = (values: number[]) => values.slice(1).reduce((path, value, i) => `${path} H${x(i + 1)} V${y(value)}`, `M0 ${y(values[0])}`);
  const area = `${line(usual)} L${x(late.length - 1)} ${y(late[late.length - 1])} ${late.slice(0, -1).reduceRight((path, value, i) => `${path} V${y(value)} H${x(i)}`, "")} Z`;
  const index = daysBetween(benMoney.today, point.date);
  return <figure className={styles.forecast}>
    <div className={styles.legend}><span><i className={styles.lateKey} />If clients pay late</span><span><i className={styles.usualKey} />If they pay on time</span></div>
    <svg viewBox="0 0 560 175" role="img" aria-label={`Cash over the next 30 days. If clients pay late, the lowest balance is ${format(point.amount)} on ${dayLabel(point.date)}; if they pay on time, the lowest is ${format(low(usual).amount)}.`}>
      <path d={area} fill="#fdecc8" /><line x1="0" x2="560" y1={y(0)} y2={y(0)} stroke="#8a857c" />
      <path d={line(usual)} fill="none" stroke="#8a857c" strokeWidth="1.5" /><path d={line(late)} fill="none" stroke="#F7A30A" strokeWidth="2.5" />
      <circle cx={x(index)} cy={y(point.amount)} r="5" fill="#b3261e" stroke="#fbfaf8" strokeWidth="2" />
      <text x={Math.min(x(index) + 10, 420)} y={Math.min(y(point.amount) + 16, 155)} fontSize="12" fontWeight="600" fill="#b3261e">{format(point.amount)} · {dayLabel(point.date)}</text>
      <text x="0" y="173" fontSize="11" fill="#6b665e">{dayLabel(benMoney.today)}</text><text x="560" y="173" textAnchor="end" fontSize="11" fill="#6b665e">{dayLabel(addDays(benMoney.today, late.length - 1))}</text>
    </svg>
  </figure>;
}

export async function Landing() {
  if (await verifiedUid()) redirect("/onboarding");
  const sentence = homeSentence(benMoney), format = formatter(benMoney.homeCurrency);
  const safe = safeToSpend(benMoney, 0);
  const open = statementItems(benMoney).find((item) => item.open && item.dueOn >= benMoney.today && daysBetween(benMoney.today, item.dueOn) < 30);
  const card = benMoney.cards.find((item) => item.id === open?.cardId);
  const unbilled = benMoney.invoices.find((item) => item.status === "unbilled");
  const client = benMoney.clients.find((item) => item.id === unbilled?.clientId);
  const providers = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(PROVIDERS.filter((provider) => provider.id !== "custom").map((provider) => provider.label));
  const tripAmount = 40000, tripDate = "2026-12-05", afterDate = "2026-12-10";
  const trip = whatIf(benMoney, [{ kind: "add_cost", name: "Trip", amountMinor: tripAmount, date: tripDate }]);
  const afterTrip = series(trip, "expected")[daysBetween(trip.today, afterDate)];
  const date = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(benMoney.today));
  return <div className={styles.landing} id="top">
    <header className={styles.header}><div className={styles.headerInner}><a className={styles.brand} href="#top"><LogoMark size={28} />fipa</a><nav aria-label="Account"><a href="#signin">Sign in</a><TryItForm className={styles.smallPrimary} /></nav></div></header>
    <main>
      <section className={styles.hero}><div className={styles.heroCopy}><p className={styles.pill}>For freelancers paid through PayPal</p><h1>Know the day money runs short, before it does.</h1><p className={styles.lead}>fipa reads your invoices, bills and card spend and tells you in one sentence whether you&apos;re fine this month. If a client is late, it drafts the PayPal invoice or reminder. Nothing is sent until you tap Approve.</p><div className={styles.entries}><TryItForm label="Try it with sample data →" className={styles.primary} /><Link href="/start" className={styles.secondary}>Start with my numbers</Link></div><p className={styles.note}>The sample is Ben, a fictional designer in Tokyo. PayPal runs in sandbox, so no real money moves.</p></div><LandingSignIn /></section>
      <section className={styles.preview}><div className={styles.sectionInner}><div className={styles.sectionIntro}><h2>One sentence, then one action.</h2><p>This is Home for the sample household. The sentence names the day and the client. The action fixes it.</p></div><div className={styles.previewCard}><div className={styles.previewMain}><p className={styles.previewDate}>{date}</p><p className={styles.sentence}>{sentence.lead} <span>{sentence.emphasis}</span></p><Forecast /></div><div className={styles.previewSide}><div className={styles.safeCard}><p>Safe to spend now</p><strong>{format(safe.amount)}</strong><p>{open && card ? `Includes ${format(open.amount)} on ${card.label} not yet billed.` : "No unbilled card spend due in the next 30 days."}</p></div>{unbilled && client && <div className={styles.actionCard}><strong>One action</strong><p>{client.name} hasn&apos;t been billed for <b>{unbilled.item}</b>. Invoicing {usd(unbilled.amountUsd)} today can help cover the shortfall.</p><TryItForm label="Try it and review" className={styles.actionButton} /></div>}</div></div></div></section>
      <section className={styles.how}><h2>How it works</h2><ol><li><span>1</span><h3>Add what you know</h3><p>Your bills, cards and the clients who pay you. Forward a bill email or upload a photo, and fipa reads it. Nothing counts until you confirm it.</p></li><li><span>2</span><h3>Read one sentence</h3><p>A date and a client name, not a score. The forecast covers the next 30 days twice: clients paying on time, and clients paying late.</p></li><li><span>3</span><h3>Approve one PayPal action</h3><p>Invoice finished work or nudge a late client. You tap Approve and PayPal sends it. When the payment lands, the sentence changes.</p></li></ol></section>
      <section className={styles.ask}><div><h2>Ask in your own words</h2><p>Ask about a bill, a month or a plan. The answer comes from fipa&apos;s own numbers, laid out as a small chart you can pin to Home.</p><p>Bring your own AI key from {providers}. The model words the answer; it never does the maths and can&apos;t send money.</p></div><div className={styles.askExample}><p>Can I afford a {format(tripAmount)} trip on December 5?</p><p>After the trip you&apos;d have {format(afterTrip)} on December 10 if clients pay as usual. The tight day if clients pay late is still {dayLabel(low(series(trip, "worst")).date)}, before the trip.</p><small>Based on: your forecast, Card B statement</small></div></section>
      <section className={styles.never}><div className={styles.sectionInner}><h2>What fipa never does</h2><ul><li>Show your AI key again. It is sealed when you save it.</li><li>Let the AI invent a number. Every figure comes from fipa&apos;s engine.</li><li>Send an invoice or reminder without your tap on Approve.</li><li>Keep your data when you leave. Export or delete it in Settings.</li></ul></div></section>
    </main>
    <footer className={styles.footer}><div><span className={styles.brand}><LogoMark size={20} />fipa</span><span>A PayPal sandbox demo. No real money moves.</span><nav aria-label="Footer"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><a href="#signin">Sign in</a></nav></div></footer>
  </div>;
}
