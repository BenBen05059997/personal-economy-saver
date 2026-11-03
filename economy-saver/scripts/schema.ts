// Writes schema/household.v1.json from the zod definition. Run from economy-saver/: npm run schema
import { writeFileSync } from "node:fs";
import { SCHEMA_FILE, householdJsonSchema } from "@/lib/schema/household-json";

writeFileSync(SCHEMA_FILE, householdJsonSchema());
console.log(`Wrote ${SCHEMA_FILE}`);
