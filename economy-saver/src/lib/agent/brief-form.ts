import { InputError } from "@/db/input-error";
import { BriefSchema } from "./brief";

export const BRIEF_LIST_FIELDS = [
  ["decisions", "Decisions"], ["open_questions", "Open questions"], ["check_next", "Check next"],
] as const;

export const BRIEF_REF_FIELDS = [
  ["bills", "Bill", "Bills"], ["clients", "Client", "Clients"], ["pots", "Pot", "Pots"], ["documents", "Document", "Documents"],
] as const;

/** The same structured brief editor is used in the browser and by the space route. */
export function briefFromForm(form: FormData) {
  const text = (field: string) => {
    const value = form.get(field);
    return typeof value === "string" ? value.trim() : "";
  };
  const lines = (field: string) => text(field).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const state = lines("state").map(line => {
    const separator = line.indexOf("|");
    if (separator < 1) throw new InputError("Write each state line as source | detail.");
    return { source: line.slice(0, separator).trim(), text: line.slice(separator + 1).trim() };
  });
  const refs = Object.fromEntries(BRIEF_REF_FIELDS.map(([field]) => [field, text(field).split(/[\s,]+/).filter(Boolean)]));
  const parsed = BriefSchema.safeParse({
    about: text("about"), goal: text("goal"), state, refs,
    ...Object.fromEntries(BRIEF_LIST_FIELDS.map(([field]) => [field, lines(field)])),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue.code === "custom") throw new InputError(issue.message);
    const field = issue.path.join(".");
    throw new InputError(field ? `Check the brief field ${field} and try again.` : "Check the brief and try again.");
  }
  return parsed.data;
}
