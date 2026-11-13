// The graph toolset (D77): runs every file in scripts/views/. A file may open its own PGlite database and export `done`.
// Run from the project root: npx tsx --tsconfig ./tsconfig.json scripts/views-test.ts
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Components import stylesheets; the test only renders markup, so a stylesheet loads as nothing (a CSS module as its own class names).
const extensions = require.extensions as unknown as Record<string, (module: { exports: unknown }) => void>;
extensions[".css"] = module => { module.exports = new Proxy({}, { get: (_, key) => String(key) }); };

const dir = join(process.cwd(), "scripts", "views");
const files = readdirSync(dir).filter(name => name.endsWith(".ts")).sort();
async function main() {
  for (const name of files) {
    console.log(`\n# ${name}`);
    // A file that needs the database exports `done`, the promise of its checks, so the runner waits for them.
    const loaded = await import(join(dir, name)) as { done?: Promise<unknown>; default?: { done?: Promise<unknown> } };
    await (loaded.done ?? loaded.default?.done);
  }
  console.log(`\nviews: ${files.length} file${files.length === 1 ? "" : "s"} passed`);
}
main().catch(error => { console.error(error); process.exit(1); });
