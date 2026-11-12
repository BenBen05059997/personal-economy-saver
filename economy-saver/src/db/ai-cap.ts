// D33: the owner's AI connection is capped per household per day; a household's own key (D56) is never counted. The count is the
// household's row in the request buckets, one per purpose, in a UTC calendar-day window. Callers spend ONE unit per question or
// document, before any model call, not one per model call.
import { eq } from "drizzle-orm";
import { withHousehold, type Db } from "./household";
import { consumeRequest, requestCount } from "./rate-limit";
import { households } from "./schema";

export const DAILY_QUESTIONS = 30;
export const DAILY_DOCUMENTS = 10;

export const QUESTIONS_USED_UP = `You’ve asked ${DAILY_QUESTIONS} questions today on fipa’s AI model. Ask again tomorrow, or add your own AI key in Settings → Your AI model.`;
export const DOCUMENTS_USED_UP = `You’ve had ${DAILY_DOCUMENTS} documents read today on fipa’s AI model. Try again tomorrow, or add your own AI key in Settings → Your AI model.`;
/** The failed state of a forwarded or retried document that the cap stopped; the person retries it from To check. */
export const DOCUMENT_NOT_READ = `Not read: today’s AI limit of ${DAILY_DOCUMENTS} documents on fipa’s AI model is used. Try again tomorrow, or add your own AI key in Settings → Your AI model.`;

type Budget = "question" | "document";
const PURPOSE = { question: "ai-question-day", document: "ai-document-day" } as const;
const LIMIT = { question: DAILY_QUESTIONS, document: DAILY_DOCUMENTS } as const;

/** True when the household uses its own AI connection (it points at its own address), so the owner's cap does not apply. */
async function usesOwnConnection(db: Db, hid: string): Promise<boolean> {
  const [h] = await withHousehold(db, hid, tx => tx.select({ protocol: households.aiProtocol, baseUrl: households.aiBaseUrl }).from(households).where(eq(households.id, hid)));
  return Boolean(h?.protocol && h.baseUrl);
}

/** Spends one question (Ask, voice fill) or one document read for this household. True when allowed; a household on its own key is always allowed and never counted. */
export async function spendAiBudget(db: Db, hid: string, budget: Budget): Promise<boolean> {
  if (await usesOwnConnection(db, hid)) return true;
  return withHousehold(db, hid, tx => consumeRequest(tx, hid, PURPOSE[budget], LIMIT[budget], "day"));
}

/** Questions left today on the owner's connection, or null for a household on its own key. */
export async function questionsLeft(db: Db, hid: string): Promise<number | null> {
  if (await usesOwnConnection(db, hid)) return null;
  const used = await withHousehold(db, hid, tx => requestCount(tx, hid, PURPOSE.question, "day"));
  return Math.max(0, DAILY_QUESTIONS - used);
}
