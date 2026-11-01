import { connection } from "next/server";
import { env } from "@/lib/env";

// Setup check. Never calls PayPal and never returns values, only variable names and reasons.
export async function GET() {
  await connection();

  let envReady = true;
  let problems: string[] = [];
  let webhookConfigured = false;
  try {
    webhookConfigured = Boolean(env().PAYPAL_WEBHOOK_ID);
  } catch (error) {
    envReady = false;
    webhookConfigured = Boolean(process.env.PAYPAL_WEBHOOK_ID);
    const lines = (error instanceof Error ? error.message : String(error))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // Drop the "Environment is not ready" header when per-variable lines follow it.
    problems = lines.length > 1 ? lines.slice(1) : lines;
  }

  return Response.json({
    ok: envReady,
    environment: "SANDBOX",
    envReady,
    problems,
    webhookConfigured,
    time: new Date().toISOString(),
  });
}
