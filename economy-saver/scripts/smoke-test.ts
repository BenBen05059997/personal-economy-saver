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

// Raw errors and API bodies can contain account data or request credentials.
function describeError(error: unknown): string {
  const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : null;
  return status ? `PayPal check failed (HTTP ${status}).` : "PayPal check failed.";
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
    console.log(error instanceof Error ? error.message : "Invalid PayPal configuration.");
    console.log("Hint: copy .env.example to .env.local and fill it in.");
    summary();
    return;
  }

  const { getAccessToken, paypalFetch } = await import("@/lib/paypal/client");
  const { runTool, deleteSmokeDraft } = await import("@/lib/paypal/toolkit");

  // b. Sandbox token
  await check("Sandbox token", async () => {
    await getAccessToken();
    return { value: true, detail: "obtained a sandbox access token" };
  });

  // c. Balance
  try {
    const data = await paypalFetch<Obj>("/v1/reporting/balances");
    report(true, "Balance", Array.isArray(data.balances) ? "balance report received" : "report received");
  } catch (error) {
    report(false, "Balance", describeError(error));
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
      if (!id) throw new Error("Draft response missing its invoice id");
      return { value: id, detail: "draft created" };
    });
  }

  // e. Read it back
  if (invoiceId) {
    await check("Read invoice back", async () => {
      const inv = await runTool<Obj>("get_invoice", { invoice_id: invoiceId });
      const status = inv.status ?? "unknown";
      if (status !== "DRAFT") throw new Error("Unexpected invoice state");
      const detail = "draft status verified";
      return { value: inv, detail };
    });
  }

  // f. Clean up
  if (invoiceId && keep) {
    console.log("Cleanup skipped (--keep). A draft remains in the sandbox.");
  } else if (invoiceId) {
    await check("Delete draft invoice", async () => {
      await deleteSmokeDraft(invoiceId!);
      return { value: true, detail: "draft deleted" };
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
