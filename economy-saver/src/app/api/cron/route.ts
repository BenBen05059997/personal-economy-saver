import { connection } from "next/server";

import { z } from "zod";
import { db } from "@/db/client";
import { runDaily } from "@/db/daily";
import { sweepDemoHouseholds } from "@/db/demo";

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
  const { swept, failed } = await sweepDemoHouseholds(db()); // D49: before the per-household work, so it runs even without CRON_HOUSEHOLD_IDS
  const configured = process.env.CRON_HOUSEHOLD_IDS?.trim();
  if (!configured) return Response.json({ error: "CRON_HOUSEHOLD_IDS is not set", swept, failed }, { status: 503 });
  const ids = z.array(z.string().uuid()).safeParse(configured.split(",").map(id => id.trim()));
  if (!ids.success) return Response.json({ error: "CRON_HOUSEHOLD_IDS must contain household UUIDs", swept, failed }, { status: 503 });
  for (const id of new Set(ids.data)) await runDaily(db(), id);
  return Response.json({ ok: true, swept, failed });
}
