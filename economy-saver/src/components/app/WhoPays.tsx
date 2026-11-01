import { arrivals } from "@/lib/money/runway";
import type { Client, MoneyState } from "@/lib/money/types";
import { cx } from "./cx";
import { dayLabel, shortName, usd } from "./format";
import styles from "./Rail.module.css";
import ui from "./ui.module.css";

const SCALE_DAYS = 30;
const sx = (d: number) => 4 + (Math.min(d, SCALE_DAYS) / SCALE_DAYS) * 92;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

/** How each client has paid before, one mark per paid invoice, with the terms as a dashed line. */
export function WhoPays({ money }: { money: MoneyState }) {
  const next = arrivals(money);
  return (
    <section className={ui.block} aria-labelledby="pay-h">
      <div className={ui.sectionHead}>
        <h3 id="pay-h">Who pays when</h3>
        <small>from PayPal invoices</small>
      </div>
      <div className={styles.payers}>
        {money.clients.map((c) => (
          <Payer key={c.id} client={c} money={money} worstByInvoice={next} />
        ))}
      </div>
      <div className={styles.axisnote} aria-hidden="true">
        <span>sent</span>
        <span>10 days</span>
        <span>20</span>
        <span>30</span>
      </div>
      <p className={cx(styles.axisnote, styles.axisnoteStart)}>Each mark is one paid invoice, in days after sending. The dashed line is the due date.</p>
    </section>
  );
}

function Payer({ client, money, worstByInvoice }: { client: Client; money: MoneyState; worstByInvoice: ReturnType<typeof arrivals> }) {
  const med = median(client.daysToPay);
  const late = med - client.termsDays;
  const ok = late <= 2;
  const mine = money.invoices.filter((i) => i.clientId === client.id);
  return (
    <div className={styles.payer}>
      <b>{client.name}</b>
      <span className={cx(styles.hab, ok ? styles.ok : styles.late)}>{ok ? `pays in ~${med} day${med === 1 ? "" : "s"}` : `~${late} days late`}</span>
      <svg viewBox="0 0 100 26" preserveAspectRatio="none" role="img" aria-label={`${client.name}: days from invoice to payment`}>
        <line className={styles.track} x1="4" x2="96" y1="13" y2="13" vectorEffect="non-scaling-stroke" />
        <line className={styles.terms} x1={sx(client.termsDays)} x2={sx(client.termsDays)} y1="4" y2="22" vectorEffect="non-scaling-stroke" />
        {client.daysToPay.map((d, i) => (
          <line key={i} className={ok ? styles.markOk : styles.markLate} x1={sx(d)} x2={sx(d)} y1="8" y2="18" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <span className={styles.open}>
        {mine.map((i) => {
          const a = worstByInvoice.find((x) => x.invoiceId === i.id);
          const num = i.number ? (/^\d+$/.test(i.number) ? `#${i.number}` : i.number) : "";
          let text: string;
          if (i.status === "unbilled") text = `Unbilled: ${i.item} · ${usd(i.amountUsd)}`;
          else if (i.status === "draft") text = `${num} · ${usd(i.amountUsd)} · draft, not sent`;
          else if (i.status === "paid") text = `${num} · ${usd(i.amountUsd)} · paid`;
          else text = `${num} · ${usd(i.amountUsd)}${i.dueOn ? ` · due ${dayLabel(i.dueOn)}` : ""}${a ? ` · worst case ${dayLabel(a.worstOn)}` : ""}`;
          return <span key={i.id}>{text}</span>;
        })}
        {mine.length === 0 && <span>No invoices yet from {shortName(client.name)}</span>}
      </span>
    </div>
  );
}
