// One-off: give every sent invoice that has no payment link its permanent link, where a link can be made.
// Usage: npm run db:backfill-pay-tokens -- --dry-run     (counts only, writes nothing)
//        npm run db:backfill-pay-tokens -- --apply       (writes; the owner decides when)
// Prints counts only, never a token. Safe to run twice: the second run changes nothing.
import { config } from "dotenv";
import { db } from "@/db/client";
import { backfillPayTokens } from "@/db/pay-token-backfill";

config({ path: ".env.local", quiet: true });

async function main() {
  const flags = process.argv.slice(2);
  const apply = flags.includes("--apply");
  const dry = flags.includes("--dry-run");
  if (apply === dry || flags.length !== 1) {
    console.error("Pass exactly one of --dry-run (counts only) or --apply (writes).");
    process.exitCode = 1;
    return;
  }
  const connection = db();
  try {
    const counts = await backfillPayTokens(connection, apply);
    console.log(apply ? "Applied." : "Dry run: nothing written.");
    console.log(`households with a link given: ${counts.households}`);
    console.log(`invoices ${apply ? "given" : "that would be given"} a link: ${counts.given}`);
    console.log(`invoices skipped, not USD: ${counts.skipped["not USD"]}`);
    console.log(`invoices skipped, no positive amount: ${counts.skipped["no positive amount"]}`);
  } finally {
    await connection.$client.end();
  }
}

main().catch(error => {
  console.error("Backfill failed:", error instanceof Error ? error.name : "error");
  process.exitCode = 1;
});
