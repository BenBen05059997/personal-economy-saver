import { connection } from "next/server";

// Daily job, called by the Cloudflare Cron Trigger (see worker.ts). Stub for now: the Supabase
// keep-alive ping and reminders land here later.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // No secret configured: refuse everything.
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  await connection();
  if (!authorized(request)) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true, at: new Date().toISOString() });
}
