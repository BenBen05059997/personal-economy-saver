// The assistant evaluation against a real model (D56, D60): `npm run model:eval -- --provider <id> --model <name> [--base-url <url>]`.
// The key is read only as process.env.EVAL_API_KEY; it is sent to the provider's host and never printed, logged or put in a URL.
// The household is Ben's Try it copy in a throwaway PGlite database; nothing is written anywhere else.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { PROVIDERS, providerById } from "@/lib/ai/providers";
import type { Connection } from "@/lib/ai/types";
import { runEval, runVoiceEval } from "./model-eval-cases";

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  const value = at === -1 ? undefined : process.argv[at + 1];
  return value && !value.startsWith("--") ? value : undefined;
}
const stop = (message: string): never => { console.error(message); process.exit(1); };

async function main() {
  const key = process.env.EVAL_API_KEY?.trim();
  if (!key) stop("EVAL_API_KEY is not set. Put the key of the provider you are testing in economy-saver/.env.local as EVAL_API_KEY and run `npm run model:eval -- --provider <id> --model <name>`.");
  const providerId = argument("provider"), model = argument("model"), given = argument("base-url");
  const provider = providerById(providerId);
  if (!provider || !model) stop(`Usage: npm run model:eval -- --provider <${PROVIDERS.map(p => p.id).join("|")}> --model <name> [--base-url <url>]`);
  const baseUrl = given ?? provider!.baseUrl;
  if (!baseUrl) stop(`The provider "${provider!.id}" needs --base-url <the OpenAI-compatible address>.`);

  const connection: Connection = { protocol: provider!.protocol, baseUrl: baseUrl!.replace(/\/+$/, ""), key: key!, textModel: model!, documentModel: null, own: true };
  const scrub = (text: string) => text.split(key!).join("[key]");
  console.log(`Evaluating ${provider!.id} / ${model} at ${new URL(connection.baseUrl).host}`);

  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  let results: { name: string; passed: boolean; why: string | null }[];
  try {
    const agentResults = await runEval({
      db, connection, scrub,
      onResult: r => console.log(r.passed ? `PASS  ${r.name}` : `FAIL  ${r.name}: ${r.why}`),
    });
    results = [...agentResults];
    const voice = await runVoiceEval({ db, connection, scrub });
    console.log(voice.passed ? `PASS  ${voice.name}` : `FAIL  ${voice.name}: ${voice.why}`);
    results.push(voice);
  } finally { await pg.close(); }

  const failedCases = results.filter(r => !r.passed);
  console.log(`\n${results.length - failedCases.length} of ${results.length} cases passed.`);
  if (failedCases.length) {
    console.log(`Not tested: ${failedCases.map(r => r.name).join(", ")} failed. Nothing to add to src/lib/ai/tested.ts.`);
    process.exitCode = 1;
    return;
  }
  const checkedOn = new Date().toISOString().slice(0, 10);
  console.log("Add this line to TESTED in src/lib/ai/tested.ts:");
  console.log(`  { provider: ${JSON.stringify(provider!.id)}, model: ${JSON.stringify(model)}, checkedOn: ${JSON.stringify(checkedOn)} },`);
}
main().catch(error => { console.error("The evaluation could not run:", error instanceof Error ? error.constructor.name : "error"); process.exitCode = 1; });
