import Link from "next/link";
import { pluralWord } from "@/lib/plural";

const LOW = { questions: 5, documents: 3 } as const;

/** D33: shown only when a household on fipa's own model is running low for the day; `left` is null for a household on its own key. */
export function AllowanceHint({ kind, left, className = "" }: { kind: keyof typeof LOW; left: number | null; className?: string }) {
  if (left === null || left > LOW[kind]) return null;
  const noun = pluralWord(left, kind === "questions" ? "question" : "document");
  return <p className={`ui-hint ${className}`.trim()} role="status">{left} {noun} left today on fipa’s model. Add your own key in <Link href="/settings/ai-model">Settings</Link> for no limit.</p>;
}
