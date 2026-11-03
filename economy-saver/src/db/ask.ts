import { z } from "zod";
import { aiKey } from "./ai-key";
import { requireHousehold, type Db } from "./household";
import { runAgent } from "@/lib/agent/run";
import { appUrl } from "@/lib/supabase-auth";

export const askInput = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(320), source: z.enum(["voice", "manual"]) });

/** Free-form questions go to the agent (D40). `pending` is true when a tool left a bill or charge in To check (D39). */
export async function answerQuestion(db: Db, hid: string, input: z.infer<typeof askInput>) {
  const { id, text, source } = askInput.parse(input);
  const householdId = requireHousehold(hid);
  return runAgent({ db, householdId, question: text, askId: id, source, appUrl: appUrl(), key: () => aiKey(db, householdId) });
}
