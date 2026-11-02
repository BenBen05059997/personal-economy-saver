// OpenNext 1.20.15 otherwise copies local dotenv values into its generated Worker.
// Supply an empty project-env export during compilation itself. Runtime bindings still
// reach process.env through the adapter's normal Cloudflare request context.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const api = import.meta.resolve("@opennextjs/cloudflare");
const version = JSON.parse(readFileSync(new URL("../../package.json", api), "utf8")).version;
if (version !== "1.20.15") throw new Error("Review the OpenNext dotenv compiler before building this adapter version.");
const cli = new URL("../cli/index.js", api);
const extractor = new URL("./utils/extract-project-env-vars.js", cli).href;
let isolated = false;
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url !== extractor) return nextLoad(url, context);
    isolated = true;
    return { format: "module", shortCircuit: true, source: "export function extractProjectEnvVars() { return {}; }" };
  },
});
try {
  process.argv = [process.execPath, fileURLToPath(cli), "build"];
  await import(cli.href);
  if (!isolated) throw new Error("OpenNext project-env isolation was not applied. Worker packaging stopped.");
} finally {
  hook.deregister();
}
