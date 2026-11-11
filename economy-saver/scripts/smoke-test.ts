// Opt-in probe of the PayPal sandbox: does the setup make an order for fipa's own account, and is the webhook registered?
// Run from the project root: npm run smoke -- --run
// It makes one $1.00 order that nobody approves (it lapses on its own) and prints only statuses and which fields are present, never values.
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

if (!process.argv.includes("--run")) {
  console.log("PayPal sandbox smoke test. It talks to the sandbox, so it only runs when asked: npm run smoke -- --run");
  process.exit(0);
}

let passed = 0;
let total = 0;

function report(ok: boolean, name: string, detail = "") {
  total += 1;
  if (ok) passed += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` - ${detail}` : ""}`);
}

// Raw errors and API bodies can contain account data or request credentials: only the status is shown.
function describeError(error: unknown): string {
  const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : null;
  return status ? `PayPal check failed (HTTP ${status}).` : "PayPal check failed.";
}

function summary() {
  console.log(`\n${passed}/${total} checks passed`);
  process.exit(passed === total ? 0 : 1);
}

async function main() {
  console.log("PayPal sandbox smoke test\n");

  const { env } = await import("@/lib/env");
  let settings: ReturnType<typeof env>;
  try {
    settings = env();
    report(true, "Environment", "PAYPAL_ENVIRONMENT=SANDBOX, client id, secret, attribution code and partner merchant id present");
  } catch (error) {
    report(false, "Environment");
    console.log(error instanceof Error ? error.message : "Invalid PayPal configuration.");
    console.log("Hint: copy .env.example to .env.local and fill it in.");
    summary();
    return;
  }

  const { getAccessToken, paypalRead } = await import("@/lib/paypal/client");
  const { createOrder } = await import("@/lib/paypal/send");

  try {
    await getAccessToken();
    report(true, "Sandbox token", "obtained");
  } catch (error) {
    report(false, "Sandbox token", describeError(error));
    summary();
    return;
  }

  // An order for fipa's own sandbox account, the way a Try it household's link makes one.
  const payee = settings.PAYPAL_PARTNER_MERCHANT_ID;
  const id = crypto.randomUUID();
  let orderId: string | undefined;
  try {
    const order = await createOrder({
      payee, requestId: "O-smoke-" + id, invoiceId: id, number: "P-SMOKE", item: "Smoke test", amountMinor: 100, currency: "USD",
      returnUrl: "https://example.test/pay/smoke/done", cancelUrl: "https://example.test/pay/smoke",
    });
    orderId = order.orderId;
    report(true, "Create order", `200; id present: ${!!order.orderId}; payer-action link on paypal.com present: ${!!order.approveUrl}`);
  } catch (error) {
    report(false, "Create order", describeError(error));
  }

  if (orderId) {
    try {
      const read = await paypalRead({ method: "GET", path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`, actAs: payee }) as { status?: string } | undefined;
      report(true, "Read order back", `200; status present: ${!!read?.status}`);
    } catch (error) {
      report(false, "Read order back", describeError(error));
    }
  }

  try {
    const data = await paypalRead({ method: "GET", path: "/v1/notifications/webhooks" }) as { webhooks?: { id?: string }[] } | undefined;
    const hooks = data?.webhooks ?? [];
    if (hooks.length === 0) {
      report(true, "Webhooks", "none registered yet. After deploying, run: npm run webhook:register -- https://<your-app>");
    } else {
      report(true, "Webhooks", `${hooks.length} registered`);
      if (settings.PAYPAL_WEBHOOK_ID) {
        console.log(`    PAYPAL_WEBHOOK_ID ${hooks.some(h => h.id === settings.PAYPAL_WEBHOOK_ID) ? "matches a registered webhook" : "does NOT match any registered webhook"}`);
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
