// Writes the committed JSON Schemas in schema/ from the zod definitions. Run from economy-saver/: npm run schema
import { writeFileSync } from "node:fs";
import { schemaFiles } from "@/lib/schema/household-json";

for (const { file, text } of schemaFiles()) {
  writeFileSync(file, text);
  console.log(`Wrote ${file}`);
}
