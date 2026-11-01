// M0 check: does our PayPal sandbox setup actually work?
// Run from the project root: npm run smoke   (add -- --keep to keep the draft invoice)
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// PayPal responses are read loosely here; these scripts only print fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

const keep = process.argv.includes("--keep");
let passed = 0;
let total = 0;

function report(ok: boolean, name: string, detail = "") {
  total += 1;
  if (ok) passed += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` - ${detail}` : ""}`);
}

// Never prints more than message, status and debug id, so secrets cannot leak.
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const e = error as Error & { status?: number; debugId?: string };
    const parts = [error.message];
    if (e.status !== undefined) parts.push(`status ${e.status}`);
    if (e.debugId) parts.push(`debug id ${e.debugId}`);
    return parts.join(" | ");
  }
  return String(error);
}

// Runs one check; returns its result, or undefined if it failed.
async function check<T>(name: string, fn: () => Promise<{ value: T; detail?: string }>): Promise<T | undefined> {
  try {
    const { value, detail } = await fn();
    report(true, name, detail);
    return value;
  } catch (error) {
    report(false, name, describeError(error));
    return undefined;
  }
}

// create_invoice returns either a link { rel, href, method } or a full invoice with an id.
function extractInvoiceId(result: Obj): string | undefined {
  if (typeof result.id === "string") return result.id;
  if (typeof result.href === "string") return result.href.split("/").filter(Boolean).pop();
  return undefined;
}

function summary() {
  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

async function main() {
  console.log("PayPal sandbox smoke test\n");

  // a. Environment
  const { env } = await import("@/lib/env");
  let settings: ReturnType<typeof env>;
  try {
    settings = env();
    report(true, "Environment", "PAYPAL_ENVIRONMENT=SANDBOX, client id and secret present");
  } catch (error) {
    report(false, "Environment");
    console.log(`\n${describeError(error)}`);
    console.log("Hint: copy .env.example to .env.local and fill it in.");
    summary();
    return;
  }

  const { getAccessToken, paypalFetch } = await import("@/lib/paypal/client");
  const { runTool } = await import("@/lib/paypal/toolkit");

  // b. Sandbox token
  await check("Sandbox token", async () => {
    await getAccessToken();
    return { value: true, detail: "obtained a sandbox access token" };
  });

  // c. Balance
  try {
    const data = await paypalFetch<Obj>("/v1/reporting/balances");
    const lines = ((data?.balances ?? []) as Obj[]).map(
      (b) => `${b.available_balance?.value ?? b.total_balance?.value ?? "?"} ${b.currency ?? ""}`.trim(),
    );
    report(true, "Balance", lines.length ? `available ${lines.join(", ")}` : "call worked but no balances were returned");
  } catch (error) {
    report(false, "Balance", `${describeError(error)} (the forecast can fall back to a typed-in balance)`);
  }

  // d. Create a draft invoice
  let invoiceId: string | undefined;
  if (!settings.SANDBOX_CLIENT_EMAIL) {
    report(false, "Create draft invoice", "SANDBOX_CLIENT_EMAIL is not set; it is the recipient. Skipping read-back and cleanup.");
  } else {
    invoiceId = await check("Create draft invoice", async () => {
      const result = await runTool<Obj>("create_invoice", {
        currency_code: "USD",
        primary_recipients: [{ billing_info: { email_address: settings.SANDBOX_CLIENT_EMAIL } }],
        items: [{ name: "M0 smoke test", quantity: "1", unit_amount: { currency_code: "USD", value: "1.00" } }],
        note: "Smoke test draft from Personal Economy Saver. Safe to delete.",
      });
      const id = extractInvoiceId(result);
      if (!id) throw new Error(`Created, but could not find an invoice id in the response: ${JSON.stringify(result).slice(0, 200)}`);
      return { value: id, detail: `invoice id ${id}` };
    });
  }

  // e. Read it back
  if (invoiceId) {
    await check("Read invoice back", async () => {
      const inv = await runTool<Obj>("get_invoice", { invoice_id: invoiceId });
      const status = inv.status ?? "unknown";
      const currency = inv.detail?.currency_code ?? inv.amount?.currency_code ?? "?";
      const total = inv.amount?.value ?? inv.amounts?.total?.value ?? "?";
      const invoicerEmail = inv.invoicer?.email_address ?? "not returned";
      const country = inv.invoicer?.address?.country_code ?? "not returned";
      const detail =
        `status ${status}${status === "DRAFT" ? "" : " (expected DRAFT)"}, ${currency} ${total}, ` +
        `invoicer ${invoicerEmail}, invoicer country ${country}`;
      return { value: inv, detail };
    });
  }

  // f. Clean up
  if (invoiceId && keep) {
    console.log(`- Cleanup skipped (--keep). Draft invoice ${invoiceId} is still in the sandbox.`);
  } else if (invoiceId) {
    await check("Delete draft invoice", async () => {
      await runTool("delete_invoice", { invoice_id: invoiceId });
      return { value: true, detail: `deleted ${invoiceId}` };
    });
  }

  // g. Webhooks
  try {
    const data = await paypalFetch<Obj>("/v1/notifications/webhooks");
    const hooks = (data?.webhooks ?? []) as Obj[];
    if (hooks.length === 0) {
      report(true, "Webhooks", "none registered yet. After deploying, run: npm run webhook:register -- https://<your-app>");
    } else {
      report(true, "Webhooks", `${hooks.length} registered`);
      for (const hook of hooks) {
        const events = ((hook.event_types ?? []) as Obj[]).map((e) => e.name).join(", ");
        console.log(`    ${hook.id}  ${hook.url}  [${events}]`);
      }
      if (settings.PAYPAL_WEBHOOK_ID) {
        const match = hooks.some((h) => h.id === settings.PAYPAL_WEBHOOK_ID);
        console.log(`    PAYPAL_WEBHOOK_ID ${match ? "matches a registered webhook" : "does NOT match any registered webhook"}`);
      }
    }
  } catch (error) {
    report(false, "Webhooks", describeError(error));
  }

  summary();
}

main().catch((error) => {
  console.error(`Unexpected error: ${describeError(error)}`);
  process.exit(1);
});
