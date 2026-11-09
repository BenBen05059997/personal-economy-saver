// OpenNext 1.20.15 otherwise copies local dotenv values into its generated Worker.
// Supply an empty project-env export during compilation itself. Runtime bindings still
// reach process.env through the adapter's normal Cloudflare request context.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const api = import.meta.resolve("@opennextjs/cloudflare");
const version = JSON.parse(readFileSync(new URL("../../package.json", api), "utf8")).version;
if (version !== "1.20.15") throw new Error("Review the OpenNext Worker build hooks before building this adapter version.");
const cli = new URL("../cli/index.js", api);
const extractor = new URL("./utils/extract-project-env-vars.js", cli).href;
const serverBundler = new URL("./build/bundle-server.js", cli).href;
let isolated = false;
let namesKept = false;
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url === extractor) {
      isolated = true;
      return { format: "module", shortCircuit: true, source: "export function extractProjectEnvVars() { return {}; }" };
    }
    if (url !== serverBundler) return nextLoad(url, context);
    // React resumes the prerendered shell using the component names recorded by Next.
    // esbuild can rename colliding functions even with identifier minification off.
    const loaded = nextLoad(url, context);
    const source = String(loaded.source);
    const option = "minifyIdentifiers: false,";
    if (source.split(option).length !== 2) throw new Error("OpenNext server bundler no longer has the expected options.");
    namesKept = true;
    return { ...loaded, source: source.replace(option, option + "\n        keepNames: true,") };
  },
});
try {
  process.argv = [process.execPath, fileURLToPath(cli), "build"];
  await import(cli.href);
  if (!namesKept) throw new Error("OpenNext server bundler did not preserve component names. Worker packaging stopped.");
  if (!isolated) throw new Error("OpenNext project-env isolation was not applied. Worker packaging stopped.");
} finally {
  hook.deregister();
}
