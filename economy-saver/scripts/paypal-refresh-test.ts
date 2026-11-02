// Only the scoped sandbox read boundary is simulated. No network calls.
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as s from "@/db/schema";
import { seedBen } from "@/db/seed";
import { refreshPayPal } from "@/db/paypal-refresh";
import { observeRunway } from "@/db/runway-events";
import { listEvents, loadMoneyState, recordEvent } from "@/db/household";
import { updateSettings } from "@/db/settings";
import { applyVerifiedDelivery } from "@/lib/events";

async function test() {
  process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
  process.env.PAYPAL_CLIENT_ID = "fictional-test-client";
  process.env.PAYPAL_CLIENT_SECRET = "fictional-test-secret";
  const pg = new PGlite();
  try {
    const db = drizzle(pg, { schema: s });
    await migrate(db, { migrationsFolder: "./drizzle" });
    const a = await seedBen(db, { isDemo: true }), b = await seedBen(db, { isDemo: true }), owner = await seedBen(db), other = await seedBen(db);
    for (const hid of [owner, other]) await db.insert(s.fxRates).values({ householdId: hid, base:"USD", quote:"JPY", date:"2020-01-01", rateMicro:150000000 });
    const now = new Date("2026-11-03T04:00:00Z");
    const later = (mins: number) => new Date(now.getTime() + mins * 60000);
    const conn = async (hid: string) => (await db.select().from(s.paypalConnections).where(eq(s.paypalConnections.householdId, hid)))[0];
    async function giveId(hid: string, remote: string, number: string) {
      const [invoice] = await db.update(s.invoices).set({ paypalInvoiceId: remote, fxRateMicro:150000000 })
        .where(and(eq(s.invoices.householdId,hid),eq(s.invoices.number,number))).returning();
      return invoice;
    }
    const demoInvoice = await giveId(a, "INV2-DEMO", "1042");
    await giveId(b, "INV2-OTHER-DEMO", "1042");
    const paid = (remote: string, event: string, at = now) => applyVerifiedDelivery(db, { id:event, event_type:"INVOICING.INVOICE.PAID", create_time:at.toISOString(), resource:{id:remote,status:"PAID"} });
    const invoiceData = (id: string, status = "SENT") => ({ id, status, detail:{invoice_number:"1042",payment_term:{due_date:"2026-11-16"}} });
    const report = (cutoff: Date, value = "10000") => ({ account_id:"FICTIONAL-MERCHANT", as_of_time:cutoff.toISOString(), last_refresh_time:cutoff.toISOString(),
      balances:[{available_balance:{currency_code:"JPY",value}}] });
    process.env.PAYPAL_BALANCE_HOUSEHOLD_ID = a;
    const paths: string[] = [];
    const readDemo = async (path: string) => { paths.push(path); return invoiceData("INV2-DEMO", "PAID"); };
    const before = (await conn(a)).balanceMinor;
    await Promise.all([refreshPayPal(db,a,readDemo,now), refreshPayPal(db,a,readDemo,now)]);
    await refreshPayPal(db,a,readDemo,later(3));
    assert.deepEqual(paths, ["/v2/invoicing/invoices/INV2-DEMO"]);
    let [demoRow] = await db.select().from(s.invoices).where(and(eq(s.invoices.householdId,a),eq(s.invoices.id,demoInvoice.id)));
    assert.equal(demoRow.status, "sent", "only the webhook can mark paid");
    assert.equal(demoRow.paypalStatus, "PAID");
    assert.equal((await conn(a)).balanceMinor,before);
    await paid("INV2-DEMO","WH-EARLY-DEMO");
    [demoRow] = await db.select().from(s.invoices).where(and(eq(s.invoices.householdId,a),eq(s.invoices.id,demoInvoice.id)));
    assert.equal(demoRow.paidOn,"2026-11-14","pre-anchor demo delivery uses business date");
    const [receipt] = (await listEvents(db,a)).filter(e=>e.kind==="invoice_paid");
    assert.equal(receipt.occurredAt.toISOString(),now.toISOString());
    assert.equal((await conn(a)).balanceMinor,before+demoInvoice.amountMinor/100*150);
    console.log("✓ Concurrent demo opens share one scoped invoice read; no merchant balance; real receipt clock and anchored demo date");

    process.env.PAYPAL_BALANCE_HOUSEHOLD_ID = owner;
    const first = await giveId(owner,"INV2-OWNER-A","1042");
    const second = await giveId(owner,"INV2-OWNER-B","1038");
    await refreshPayPal(db,owner,async path => path.endsWith("/balances") ? report(now) : invoiceData(path.split("/").pop()!), now);
    assert.equal((await conn(owner)).balanceMinor,10000);
    await paid("INV2-OWNER-A","WH-IN-REPORT",new Date(now.getTime()-500));
    assert.equal((await conn(owner)).balanceMinor,10000,"report already included this receipt");
    const [ownerInvoice] = await db.select().from(s.invoices).where(and(eq(s.invoices.householdId,owner),eq(s.invoices.id,first.id)));
    assert.equal(ownerInvoice.paidOn,"2026-11-03","real household uses actual Tokyo date");

    let started!: () => void, release!: () => void;
    const startedReport = new Promise<void>(resolve => { started=resolve });
    const blockedReport = new Promise<void>(resolve => { release=resolve });
    const refresh = refreshPayPal(db,owner,async path => {
      if(!path.endsWith("/balances")) return invoiceData("INV2-OWNER-B");
      started();
      await blockedReport;
      return report(later(2), "12000");
    },later(6));
    await startedReport;
    await paid("INV2-OWNER-B","WH-DURING-PULL",later(5));
    release();
    const stale=await refresh;
    assert.ok(stale.stale?.includes("predates"));
    assert.equal((await conn(owner)).balanceMinor,10000+second.amountMinor/100*150);
    console.log("✓ Designated real merchant only; delayed and concurrent reports cannot erase or duplicate verified credits");

    let attempts=0;
    await giveId(other,"INV2-OTHER-REAL","1042");
    const broken = async (path: string) => { assert.equal(path,"/v2/invoicing/invoices/INV2-OTHER-REAL");attempts++;throw new Error("provider unavailable"); };
    const failed=await refreshPayPal(db,other,broken,now);
    assert.equal(failed.stale,"PayPal could not refresh. Showing the last stored household data.");
    await refreshPayPal(db,other,broken,later(4));
    assert.equal(attempts,1);
    await refreshPayPal(db,other,async path=>{assert.equal(path,"/v2/invoicing/invoices/INV2-OTHER-REAL");attempts++;return invoiceData("INV2-OTHER-REAL","CANCELLED");},later(6));
    assert.equal(attempts,2);
    assert.equal((await loadMoneyState(db,other,"2026-11-14")).invoices.find(i=>i.number==="1042")?.status,"closed");
    delete process.env.PAYPAL_BALANCE_HOUSEHOLD_ID;
    assert.match((await refreshPayPal(db,other,async()=>invoiceData("INV2-OTHER-REAL"),later(12))).stale!,/PAYPAL_BALANCE_HOUSEHOLD_ID/);
    console.log("✓ Stored data survives failures; retry waits five minutes, cancelled invoices leave the forecast, missing binding named");

    await db.transaction(async tx=>{await observeRunway(tx,b)});
    await updateSettings(db,b,{kind:"household",name:"Ben",bank:"950000"});
    await updateSettings(db,b,{kind:"household",name:"Ben",bank:"0"});
    await db.transaction(async tx=>{await recordEvent(tx,b,{kind:"daily_reminder",title:"Due soon",notify:true})});
    const changes=(await listEvents(db,b)).filter(e=>["runway_clear","runway_short","daily_reminder"].includes(e.kind));
    assert.equal(changes.filter(e=>e.kind==="runway_clear").length,1);
    assert.equal(changes.filter(e=>e.kind==="runway_short").length,1);
    assert.equal(changes.filter(e=>e.notify).length,1);
    await paid("INV2-OTHER-DEMO","WH-MONEY-EXCEPTION");
    assert.ok((await listEvents(db,b)).some(e=>e.kind==="invoice_paid" && e.notify));
    console.log("✓ Fine/short transitions stay in Activity; one non-money alert per local day, verified payments still notify");
  } finally {await pg.close();}
}
test().catch(e=>{ console.error("Refresh tests failed", e instanceof Error ? e.stack?.split("\n").filter(line=>line.trim().startsWith("at ")).slice(0,4).join("\n") : ""); process.exitCode=1; });
