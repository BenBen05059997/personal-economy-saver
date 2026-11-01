// Registers this app's webhook endpoint with the PayPal sandbox.
// Usage: npm run webhook:register -- https://your-app.onrender.com
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

// PayPal responses are read loosely here; these scripts only print fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;

const EVENT_TYPES = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.REFUNDED",
];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Returns the full webhook URL, or exits with a helpful message.
function webhookUrlFromArgs(): string {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    fail("Usage: npm run webhook:register -- https://your-app.onrender.com");
  }

  let base: URL;
  try {
    base = new URL(args[0]);
  } catch {
    return fail(`"${args[0]}" is not a valid URL. Usage: npm run webhook:register -- https://your-app.onrender.com`);
  }
  if (base.protocol !== "https:") {
    fail("PayPal only accepts https webhook URLs. If this is local, deploy first or use an https tunnel such as ngrok.");
  }
  const host = base.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) {
    fail("PayPal cannot reach localhost. Deploy first (for example to Render), or use an https tunnel such as ngrok.");
  }

  return `${base.origin}${base.pathname.replace(/\/+$/, "")}/api/paypal/webhook`;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & { status?: number; debugId?: string };
  const parts = [error.message];
  if (e.status !== undefined) parts.push(`status ${e.status}`);
  if (e.debugId) parts.push(`debug id ${e.debugId}`);
  return parts.join(" | ");
}

async function main() {
  const url = webhookUrlFromArgs();

  const { env } = await import("@/lib/env");
  try {
    env();
  } catch (error) {
    fail(`${describeError(error)}\nHint: copy .env.example to .env.local and fill it in.`);
  }
  const { paypalFetch } = await import("@/lib/paypal/client");

  console.log(`Registering ${url} with the PayPal sandbox...`);

  let id: string | undefined;
  try {
    const created = await paypalFetch<Obj>("/v1/notifications/webhooks", {
      method: "POST",
      body: JSON.stringify({ url, event_types: EVENT_TYPES.map((name) => ({ name })) }),
    });
    id = created?.id;
    console.log("Webhook created.");
  } catch (error) {
    // Most likely the URL is already registered (WEBHOOK_URL_ALREADY_EXISTS). Look for it instead of guessing.
    console.log(`Create failed (${describeError(error)}). Checking whether it is already registered...`);
    const list = await paypalFetch<Obj>("/v1/notifications/webhooks").catch((listError) =>
      fail(`Could not list webhooks either: ${describeError(listError)}`),
    );
    id = ((list?.webhooks ?? []) as Obj[]).find((hook) => hook.url === url)?.id;
    if (!id) fail("No existing webhook with that URL was found, so the failure above is the real problem.");
    console.log("Found the existing webhook for this URL.");
  }

  if (!id) fail("PayPal did not return a webhook id.");
  console.log(`\nAdd this to .env.local and to Render's environment: PAYPAL_WEBHOOK_ID=${id}`);
}

main().catch((error) => fail(`Unexpected error: ${describeError(error)}`));
