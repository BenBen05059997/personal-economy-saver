// Cloudflare allows 32 Worker invocations in one request chain: the trigger, discovery and 30 households.
export const CRON_BATCH_SIZE = 30;
export const CRON_HOUSEHOLD_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export async function dispatchCron(send: (request: Request) => Promise<Response>, secret: string) {
  const call = (householdId?: string) => {
    const url = new URL("https://worker.internal/api/cron");
    if (householdId) url.searchParams.set("household", householdId);
    return send(new Request(url, { headers: { authorization: "Bearer " + secret } }));
  };
  const list = await call();
  if (!list.ok) throw new Error("Cron discovery returned HTTP " + list.status);
  const { ids }: { ids: unknown } = await list.json();
  if (!Array.isArray(ids) || !ids.every(id => typeof id === "string" && CRON_HOUSEHOLD_ID.test(id))) {
    throw new Error("Cron discovery returned invalid household ids");
  }

  const runs = { completed: 0, failed: 0 };
  for (const id of new Set(ids.slice(0, CRON_BATCH_SIZE))) {
    try {
      const response = await call(id);
      await response.body?.cancel();
      if (response.ok) runs.completed++;
      else runs.failed++;
    } catch {
      runs.failed++;
    }
  }
  return runs;
}
