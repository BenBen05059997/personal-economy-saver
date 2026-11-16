import { connection } from "next/server";

import { db } from "@/db/client";
import { dueHouseholds, logDailyError, runDaily } from "@/db/daily";
import { pruneIpBuckets } from "@/db/rate-limit";
import { dropIdleDemoKeys, sweepDemoHouseholds } from "@/db/demo";
import { sweepOrphanKeys } from "@/db/ai-key";
import { bearerMatches } from "@/lib/door";
import { CRON_HOUSEHOLD_ID } from "@/lib/cron";
import { NO_STORE } from "@/lib/form-fetch";
import { jobError } from "@/lib/job-error";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // No secret configured: refuse everything.
  return bearerMatches(request.headers.get("authorization") ?? "", secret);
}

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request) {
  await connection();
  if (!authorized(request)) return reply({ ok: false }, 401);
  const id = new URL(request.url).searchParams.get("household");
  if (id !== null && !CRON_HOUSEHOLD_ID.test(id)) return reply({ ok: false }, 400);
  const now = new Date();

  if (id !== null) {
    try {
      await runDaily(db(), id, now);
      return reply({ ok: true });
    } catch (error) {
      logDailyError("cron_household_failed", id, error);
      return reply({ ok: false }, 503);
    }
  }

  const store = db();
  let housekeeping = { swept: 0, failed: 0 };
  try {
    housekeeping = await sweepDemoHouseholds(store, now);
    housekeeping.failed += (await dropIdleDemoKeys(store, now)).failed;
    await sweepOrphanKeys(store);
    await pruneIpBuckets(store);
  } catch (error) {
    housekeeping.failed++;
    console.error(JSON.stringify({ at: "cron_housekeeping_failed", ...jobError(error) }));
  }
  return reply({ ok: true, ...housekeeping, ids: await dueHouseholds(store, now) });
}
