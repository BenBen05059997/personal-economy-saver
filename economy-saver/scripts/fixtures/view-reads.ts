// What every view's reading must hold (D79), shared by the view tests: the line's numbers are the view's own facts, and every fact is a term.
// Not under scripts/views/, which the views runner executes as suites.
import assert from "node:assert/strict";
import { unconfirmedNumbers } from "@/lib/ai/number-check";
import type { Fact } from "@/lib/money/facts";
import { termOf } from "@/lib/money/terms";
import type { ViewResult } from "@/lib/views/types";

/** Every fact is one of the terms. */
export function termsOnly(facts: readonly Fact[]) {
  for (const item of facts) assert.doesNotThrow(() => termOf(item.name), `${item.name} is a term`);
}

/** The view carries facts, every number in its line is one of them, and every fact is a term. */
export function reads(view: ViewResult, today: string) {
  assert.ok(view.facts.length > 0, `${view.view} carries facts`);
  assert.deepEqual(unconfirmedNumbers(view.line ?? "", view.facts, { today }), [], `${view.view}: every number in the line is one of its facts`);
  termsOnly(view.facts);
}
