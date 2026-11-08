import { connection } from "next/server";

import { db } from "@/db/client";
import { dueHouseholds, runDaily } from "@/db/daily";
import { pruneIpBuckets } from "@/db/rate-limit";
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
  const store = db();
  const now = new Date();
  const { swept, failed } = await sweepDemoHouseholds(store, now);
  await pruneIpBuckets(store);
  const ids = await dueHouseholds(store, now);
  const runs = { completed: 0, failed: 0 };
  for (const id of ids) {
    try {
      await runDaily(store, id, now);
      runs.completed++;
    } catch {
      runs.failed++;
    }
  }
  return Response.json({ ok: runs.failed === 0, swept, failed, runs }, { status: runs.failed ? 503 : 200 });
}
