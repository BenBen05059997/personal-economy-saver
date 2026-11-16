import { z } from "zod";
import { hasLongNumber, SECRET_REFUSAL } from "@/lib/schema/memory";
import { KEY_TEXT_WORDS, looksLikeApiKey } from "@/lib/ai/key-text";
import { group } from "@/lib/money/format";
import { QUOTED_DATA } from "./memory-prompt";

export const BRIEF_MAX = 2_000;
const line = z.string().trim().min(1).max(BRIEF_MAX).refine(value => !/[\r\n]/.test(value), "Keep each entry on one line.");
const source = z.string().trim().min(1).max(80).refine(value =>
  /^[a-z][a-z0-9_]*$/.test(value) || z.string().uuid().safeParse(value).success, "Use a tool name or a memory note ID as the source.");
const ids = z.array(z.string().uuid());
const refs = { bills: ids.default([]), clients: ids.default([]), pots: ids.default([]), documents: ids.default([]) };
/** What a brief can point at, in the order it is shown. */
export const BRIEF_REF_KINDS = Object.keys(refs) as (keyof typeof refs)[];
export const BriefFields = z.object({
  about: z.string().trim().max(BRIEF_MAX).default(""),
  goal: z.string().trim().max(BRIEF_MAX).default(""),
  state: z.array(z.object({ text: line, source }).strict()).default([]),
  decisions: z.array(line).default([]),
  open_questions: z.array(line).default([]),
  check_next: z.array(line).default([]),
  refs: z.object(refs).strict().default({}),
}).strict();

/** Who last wrote a brief: the assistant's proposal or the person's form. */
export const BriefAuthor = z.enum(["ask", "form"]);
export type BriefAuthor = z.infer<typeof BriefAuthor>;

export type Brief = z.infer<typeof BriefFields>;
export type BriefRecord = { brief: Brief; updatedAt: string; updatedBy: BriefAuthor };

export function briefWords(brief: Brief): string[] {
  return [brief.about, brief.goal, ...brief.state.map(row => row.text), ...brief.decisions, ...brief.open_questions, ...brief.check_next];
}

export const BriefSchema = BriefFields.superRefine((brief, ctx) => {
  if (JSON.stringify(brief).length > BRIEF_MAX) ctx.addIssue({
    code: "custom", message: `Keep the whole brief to ${group(BRIEF_MAX)} characters.`,
  });
  if (briefWords(brief).some(hasLongNumber) || brief.state.some(row => !z.string().uuid().safeParse(row.source).success && hasLongNumber(row.source))) {
    ctx.addIssue({ code: "custom", message: SECRET_REFUSAL });
  }
  if (looksLikeApiKey(JSON.stringify(brief))) ctx.addIssue({ code: "custom", message: KEY_TEXT_WORDS });
});

export function briefContext(brief: Brief): string {
  if (!briefWords(brief).some(Boolean) && !BRIEF_REF_KINDS.some(kind => brief.refs[kind].length)) return "";
  return `Space brief (${QUOTED_DATA} or confirmation of an amount):\n` + JSON.stringify(brief);
}
