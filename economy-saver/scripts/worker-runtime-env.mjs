// OpenNext 1.x generates this module from Next's dotenv files. Wrangler secrets and
// .dev.vars supply the server settings at runtime. Package none of the build machine's values.
import { writeFileSync } from "node:fs";

const target = new URL("../.open-next/cloudflare/next-env.mjs", import.meta.url);
writeFileSync(target, "export const production = {}, development = {}, test = {};\n");
