// Only report setting names. Both the Worker and its source map must be safe to upload.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const local = new URL("../.env.local", import.meta.url);
if (existsSync(local)) process.loadEnvFile(fileURLToPath(local));
const names = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "SANDBOX_CLIENT_EMAIL",
  "PAYPAL_PARTNER_ATTRIBUTION_ID", "PAYPAL_PARTNER_MERCHANT_ID",
  "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "AI_API_KEY",
  "INBOUND_ADDRESS_KEY", "INBOUND_WORKER_SECRET", "CRON_SECRET", "MCP_TOKEN_KEY", "AI_KEY_SEAL_KEY", "RESEND_API_KEY",
  "WEB_PUSH_PRIVATE_KEY", "EVAL_API_KEY"];
for (const file of ["worker.js", "worker.js.map"]) {
  const path = new URL("../.wrangler/dryout/" + file, import.meta.url);
  const source = readFileSync(path, "utf8");
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && (source.includes(value) || source.includes(JSON.stringify(value).slice(1, -1)))) {
      throw new Error(`${name} is embedded in ${file}. Worker packaging stopped.`);
    }
  }
}
console.log("Worker and source map passed the credential scan.");
