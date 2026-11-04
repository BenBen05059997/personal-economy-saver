// The in-app agent (D40): Claude chooses tools over the engine and phrases their results. Plain manual loop on the
// Messages API. It logs one content-free line per Ask (log.ts) and nothing else: never the key, the question, a tool
// argument or result, or the answer.
import Anthropic from "@anthropic-ai/sdk";
import { householdDate } from "@/db/account";
import { loadMoneyState, requireHousehold, type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { anthropicClient } from "@/lib/anthropic";
import type { MoneyState } from "@/lib/money/types";
import { logCall, type ToolLog } from "./log";
import { MODEL_RULES } from "./rules";
import { tools, toolInputSchema, type ToolContext } from "./tools";

/** Messages are fixed, human and free of secrets and SQL; safe to show in a response. */
export class AgentError extends Error {
  /** The key of the fixed message (`fail`) or "api_error"; goes in the log line, never the message. */
  constructor(message: string, readonly outcome: string = "other") { super(message); }
}

export const MAX_TOOL_TURNS = 4;
export const BUDGET_MS = 20_000;
const MAX_TOKENS = 16_000;

const definitions: Anthropic.Tool[] = tools.map(tool => ({
  name: tool.name, description: tool.description, input_schema: toolInputSchema(tool), strict: true,
}));

function systemPrompt(today: string, currency: string) {
  return `You are the money assistant inside Personal Economy Saver, for one household. Today is ${today} and the household's home currency is ${currency}.

${MODEL_RULES.split("\n")[0]}
Answer in one or two plain sentences, in the language the user wrote in. If no tool can answer, say so plainly.
${MODEL_RULES.split("\n").slice(1).join("\n")}`;
}

const fail = {
  budget: "That took too long. Try a simpler question.",
  turns: "I couldn't finish that. Try a simpler question.",
  cutOff: "The answer was cut off. Try a simpler question.",
  refusal: "The assistant declined to answer that.",
  empty: "The assistant gave no answer. Try again.",
  stop: "The assistant stopped unexpectedly. Try again.",
};

const failure = (key: keyof typeof fail) => new AgentError(fail[key], key);

function apiFailure(error: unknown): AgentError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AgentError(fail.budget, "api_error");
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    if (error.status === 401 || error.status === 403) return new AgentError("The AI key was not accepted. Check it in Settings.", "api_error");
    if (error.status === 429) return new AgentError("The AI service is busy. Try again in a minute.", "api_error");
    return new AgentError(`The AI service returned HTTP ${error.status}. Try again.`, "api_error");
  }
  return new AgentError("Couldn't reach the AI service. Try again.", "api_error");
}

/** What the one log line is built from; filled in as the Ask runs. */
type Trace = { stop: string; turns: number; tools: ToolLog[]; inputTokens: number; outputTokens: number };

type AskOptions = {
  db: Db; householdId: string; question: string; askId: string; appUrl: URL; source?: "voice" | "manual";
  key: () => Promise<string>; fetch?: typeof globalThis.fetch; now?: () => number;
};
type AskResult = { answer: string; links: { label: string; href: string }[]; pending: boolean };

export async function runAgent(opts: AskOptions): Promise<AskResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const trace: Trace = { stop: "none", turns: 0, tools: [], inputTokens: 0, outputTokens: 0 };
  let outcome = "error";
  try {
    const result = await converse(opts, trace);
    outcome = "answer";
    return result;
  } catch (error) {
    if (error instanceof AgentError) outcome = error.outcome;
    throw error;
  } finally {
    logCall({
      at: "ask", householdId: opts.householdId, askId: opts.askId, ...(opts.source && { source: opts.source }),
      stop: trace.stop, turns: trace.turns, tools: trace.tools, outcome, ms: now() - started,
      inputTokens: trace.inputTokens, outputTokens: trace.outputTokens,
    });
  }
}

async function converse(opts: AskOptions, trace: Trace): Promise<AskResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + BUDGET_MS;
  const hid = requireHousehold(opts.householdId);
  const model = process.env.ANTHROPIC_TEXT_MODEL?.trim();
  if (!model) throw new AgentError("ANTHROPIC_TEXT_MODEL is not set", "no_model");

  const links: { label: string; href: string }[] = [];
  let pending = false;
  // The household's state is read once per tool turn, so tools in one turn agree with each other.
  let loaded: Promise<MoneyState> | undefined;
  const state = () => (loaded ??= householdDate(opts.db, hid).then(today => loadMoneyState(opts.db, hid, today)));
  const ctx: ToolContext = {
    madeBy: "ask", db: opts.db, householdId: hid, state, appUrl: opts.appUrl, askId: opts.askId, source: opts.source,
    addLink: link => { if (!links.some(known => known.href === link.href)) links.push(link); },
    onPending: () => { pending = true; ctx.addLink?.({ label: "Open To check", href: new URL("/to-check", opts.appUrl).href }); },
  };
  const { today, homeCurrency } = await state();
  const system = systemPrompt(today, homeCurrency);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.question }];

  for (let toolTurns = 0; ;) {
    const remaining = deadline - now();
    if (remaining <= 0) throw failure("budget");
    // Reserves one unit of the owner-key allowance per model call; the household's own key is unlimited.
    const client = anthropicClient(await opts.key(), remaining, opts.fetch);
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model, max_tokens: MAX_TOKENS, system, messages, tools: definitions, tool_choice: { type: "auto" },
        output_config: { effort: "low" },
      });
    } catch (error) { trace.stop = "api_error"; throw apiFailure(error); }
    trace.stop = response.stop_reason ?? "none";
    trace.turns++;
    trace.inputTokens += response.usage.input_tokens;
    trace.outputTokens += response.usage.output_tokens;

    if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
      const answer = response.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n").trim();
      if (!answer) throw failure("empty");
      return { answer, links, pending };
    }
    if (response.stop_reason === "refusal") throw failure("refusal");
    if (response.stop_reason === "max_tokens") throw failure("cutOff");
    if (response.stop_reason !== "tool_use" && response.stop_reason !== "pause_turn") throw failure("stop");

    // The assistant turn goes back exactly as received (thinking blocks included); history is append-only.
    messages.push({ role: "assistant", content: response.content as Anthropic.ContentBlockParam[] });
    if (response.stop_reason === "pause_turn") continue;
    if (++toolTurns > MAX_TOOL_TURNS) throw failure("turns");
    loaded = undefined;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      results.push(await callTool(ctx, block, trace, now));
    }
    messages.push({ role: "user", content: results });
  }
}

async function callTool(ctx: ToolContext, block: Anthropic.ToolUseBlock, trace: Trace, now: () => number): Promise<Anthropic.ToolResultBlockParam> {
  const started = now();
  const result = await executeTool(ctx, block);
  // The model chose the name, so only a name in the catalogue is logged.
  trace.tools.push({ name: tools.some(t => t.name === block.name) ? block.name : "unknown", ok: !result.is_error, ms: now() - started });
  return result;
}

async function executeTool(ctx: ToolContext, block: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  const error = (message: string): Anthropic.ToolResultBlockParam => ({ type: "tool_result", tool_use_id: block.id, content: message, is_error: true });
  const tool = tools.find(candidate => candidate.name === block.name);
  if (!tool) return error("Unknown tool.");
  const input = tool.input.safeParse(block.input);
  if (!input.success) {
    // Paths only: a zod message can echo the value the model sent.
    const paths = [...new Set(input.error.issues.map(issue => issue.path.join(".") || "(input)"))];
    return error("Invalid input for this tool: " + paths.join(", "));
  }
  try {
    return { type: "tool_result", tool_use_id: block.id, content: await tool.run(ctx, input.data as never) };
  } catch (failure) {
    // An InputError is written for the user (an unknown member name, a missing second person): the model may relay it.
    return error(failure instanceof InputError ? failure.message : "This tool could not complete the request.");
  }
}
