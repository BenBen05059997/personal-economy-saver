// The in-app agent (D40): Claude chooses tools over the engine and phrases their results. Plain manual loop on the
// provider-neutral model call (lib/ai). It logs one content-free line per Ask (log.ts) and nothing else: never the key, the question, a tool
// argument or result, or the answer.
import { householdDate } from "@/db/account";
import { loadMoneyState, requireHousehold, type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { callModel } from "@/lib/ai/call";
import { ModelError, type Connection, type ToolResult, type ToolSpec, type Turn } from "@/lib/ai/types";
import type { MoneyState } from "@/lib/money/types";
import { logCall, type ToolLog } from "./log";
import type { Recipe } from "@/lib/canvas/schema";
import { chooseReply, type ReplyKind, type Source } from "./reply";
import { memoryBlock, memoryContext } from "./memory-prompt";
import type { DeviceMemory } from "@/lib/store/memory-ops";
import { ASK_RULES, MODEL_RULES } from "./rules";
import { tools, toolInputSchema, type ToolContext } from "./tools";

/** Messages are fixed, human and free of secrets and SQL; safe to show in a response. */
export class AgentError extends Error {
  /** The key of the fixed message (`fail`) or "api_error"; goes in the log line, never the message. */
  constructor(message: string, readonly outcome: string = "other") { super(message); }
}

/** Tools whose result repeats text the model wrote. */
const NOT_SOURCES = new Set(["remember", "forget", "make_canvas"]);

export const MAX_TOOL_TURNS = 4;
export const BUDGET_MS = 20_000;
const MAX_TOKENS = 16_000;

const definitions: ToolSpec[] = tools.map(tool => ({ name: tool.name, description: tool.description, schema: toolInputSchema(tool) }));

function systemPrompt(today: string, currency: string, memory: string) {
  return `You are the money assistant inside Personal Economy Saver, for one household. Today is ${today} and the household's home currency is ${currency}.

${MODEL_RULES.split("\n")[0]}
Answer in one or two plain sentences, in the language of the person's latest message.
${MODEL_RULES.split("\n").slice(1).join("\n")}
${ASK_RULES}${memory ? `\n\n${memory}` : ""}`;
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
  if (error instanceof InputError) return new AgentError(error.message, "api_error"); // the address rule, written for a person
  if (error instanceof ModelError) {
    if (error.timeout) return new AgentError(fail.budget, "api_error");
    if (error.status === 401 || error.status === 403) return new AgentError("The AI key was not accepted. Check it in Settings.", "api_error");
    if (error.status === 429) return new AgentError("The AI service is busy. Try again in a minute.", "api_error");
    if (error.status !== undefined) return new AgentError(`The AI service returned HTTP ${error.status}. Try again.`, "api_error");
  }
  return new AgentError("Couldn't reach the AI service. Try again.", "api_error");
}

/** What the one log line is built from; filled in as the Ask runs. */
type Trace = { kind?: string; canvas?: boolean; stop: string; turns: number; tools: ToolLog[]; inputTokens: number; outputTokens: number; protocol?: string; own?: boolean };

type AskOptions = {
  db: Db; householdId: string; question: string; askId: string; appUrl: URL; source?: "voice" | "manual";
  connection: () => Promise<Connection>; fetch?: typeof globalThis.fetch; now?: () => number;
  /** Quoted data that goes into the user turn after the question (earlier turns, the canvas on screen). Never an amount source. */
  context?: string;
  /** D59: when the household keeps its memory on one device, the list the question carried. It is used for this question only; `remember` and `forget` change it in place and record `changes` for the reply. Without it, memory is read from the cloud. */
  deviceMemory?: DeviceMemory;
};
export type AskResult = {
  kind: ReplyKind; answer: string; choices: string[] | null; recipe: Recipe | null; sources: Source[];
  links: { label: string; href: string }[]; pending: boolean;
};

export async function runAgent(opts: AskOptions): Promise<AskResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const trace: Trace = { stop: "none", turns: 0, tools: [], inputTokens: 0, outputTokens: 0 };
  let outcome = "error";
  try {
    const result = await converse(opts, trace);
    outcome = "answer";
    trace.kind = result.kind;
    trace.canvas = result.recipe !== null;
    return result;
  } catch (error) {
    if (error instanceof AgentError) outcome = error.outcome;
    throw error;
  } finally {
    logCall({
      at: "ask", householdId: opts.householdId, askId: opts.askId, ...(opts.source && { source: opts.source }),
      kind: trace.kind ?? "error", canvas: trace.canvas ?? false,
      stop: trace.stop, turns: trace.turns, tools: trace.tools, outcome, ms: now() - started,
      inputTokens: trace.inputTokens, outputTokens: trace.outputTokens,
      ...(trace.protocol && { protocol: trace.protocol, own: trace.own }),
    });
  }
}

async function converse(opts: AskOptions, trace: Trace): Promise<AskResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + BUDGET_MS;
  const hid = requireHousehold(opts.householdId);

  const links: { label: string; href: string }[] = [];
  let pending = false;
  let recipe: Recipe | null = null;
  let clarify: { question: string; choices: string[] } | null = null;
  let outOfScope: "off_topic" | "not_offered" | null = null;
  const used: string[] = [];
  let called = false;
  // The household's state is read once per tool turn, so tools in one turn agree with each other.
  let loaded: Promise<MoneyState> | undefined;
  const state = () => (loaded ??= householdDate(opts.db, hid).then(today => loadMoneyState(opts.db, hid, today)));
  const ctx: ToolContext = {
    madeBy: "ask", db: opts.db, householdId: hid, state, appUrl: opts.appUrl, askId: opts.askId, source: opts.source,
    addLink: link => { if (!links.some(known => known.href === link.href)) links.push(link); },
    onCanvas: next => { recipe = next; },
    onClarify: next => { clarify = next; },
    onOutOfScope: next => { outOfScope = next; },
    deviceMemory: opts.deviceMemory,
    onPending: () => { pending = true; ctx.addLink?.({ label: "Open To check", href: new URL("/to-check", opts.appUrl).href }); },
  };
  const { today, homeCurrency } = await state();
  const memory = opts.deviceMemory ? memoryBlock(opts.deviceMemory.items) : await memoryContext(opts.db, hid);
  const system = systemPrompt(today, homeCurrency, memory);
  const turns: Turn[] = [{ role: "user", parts: [{ type: "text", text: opts.context ? `${opts.question}\n\n${opts.context}` : opts.question }] }];
  // Every amount in the answer must come from the question or a tool result (D56).
  const sources = [opts.question];
  if (memory) sources.push(memory);

  for (let toolTurns = 0; ;) {
    const remaining = deadline - now();
    if (remaining <= 0) throw failure("budget");
    // Reserves one unit of the owner-key allowance per model call; the household's own key is unlimited.
    const connection = await opts.connection();
    trace.protocol = connection.protocol; trace.own = connection.own;
    if (!connection.textModel) throw new AgentError("AI_TEXT_MODEL is not set", "no_model");
    let reply;
    try {
      reply = await callModel({
        connection, model: connection.textModel, system, turns, tools: definitions, maxTokens: MAX_TOKENS,
        timeoutMs: remaining, fetch: opts.fetch, appUrl: opts.appUrl,
      });
    } catch (error) { trace.stop = "api_error"; throw apiFailure(error); }
    trace.stop = reply.stop;
    trace.turns++;
    trace.inputTokens += reply.inputTokens;
    trace.outputTokens += reply.outputTokens;

    if (reply.stop === "end") {
      const answer = reply.text.trim();
      if (!answer) throw failure("empty");
      return finish(chooseReply({ clarify, outOfScope, text: answer, tools: used, called, recipe, sources }));
    }
    if (reply.stop === "refusal") throw failure("refusal");
    if (reply.stop === "length") throw failure("cutOff");
    if (reply.stop !== "tools" && reply.stop !== "pause") throw failure("stop");

    // The assistant turn goes back exactly as received (thinking blocks included); history is append-only.
    turns.push({ role: "assistant", raw: reply.raw });
    if (reply.stop === "pause") continue;
    if (++toolTurns > MAX_TOOL_TURNS) throw failure("turns");
    loaded = undefined;

    const results: ToolResult[] = [];
    // clarify and out_of_scope end the question: when one is asked for and valid, it is the only call that runs, and there is no further model call.
    // One that fails its schema is an ordinary tool error: the other calls run and the loop goes on.
    const ending = reply.calls.find(call => call.name === "clarify" || call.name === "out_of_scope");
    if (ending) {
      const result = await callTool(ctx, ending, trace, now);
      if (clarify !== null || outOfScope !== null) return finish(chooseReply({ clarify, outOfScope, text: "", tools: used, called, recipe, sources }));
      results.push(result);
    }
    for (const call of reply.calls) if (call !== ending) results.push(await callTool(ctx, call, trace, now));
    for (const result of results) {
      // What the model wrote (a canvas it drew, a memory it kept) comes back echoed: it is not a source, or the model could confirm its own number.
      if (!NOT_SOURCES.has(result.name)) sources.push(result.content);
      if (tools.some(t => t.name === result.name) && result.name !== "clarify" && result.name !== "out_of_scope") called = true;
      if (!result.isError) used.push(result.name);
    }
    turns.push({ role: "tools", results });
  }

  function finish(chosen: ReturnType<typeof chooseReply>): AskResult {
    if (!chosen) throw new AgentError("The model gave an amount the app could not confirm from your numbers, so the answer is not shown. Ask again, or choose another model in Settings.", "unconfirmed_amount");
    return { kind: chosen.kind, answer: chosen.text, choices: chosen.choices, recipe: chosen.recipe, sources: chosen.sources, links, pending };
  }
}

type Call = { id: string; name: string; input: unknown };

async function callTool(ctx: ToolContext, call: Call, trace: Trace, now: () => number): Promise<ToolResult> {
  const started = now();
  const result = await executeTool(ctx, call);
  // The model chose the name, so only a name in the catalogue is logged.
  trace.tools.push({ name: tools.some(t => t.name === call.name) ? call.name : "unknown", ok: !result.isError, ms: now() - started });
  return result;
}

async function executeTool(ctx: ToolContext, call: Call): Promise<ToolResult> {
  const error = (message: string): ToolResult => ({ id: call.id, name: call.name, content: message, isError: true });
  const tool = tools.find(candidate => candidate.name === call.name);
  if (!tool) return error("Unknown tool.");
  const input = tool.input.safeParse(call.input);
  if (!input.success) {
    // Paths only: a zod message can echo the value the model sent.
    const paths = [...new Set(input.error.issues.map(issue => issue.path.join(".") || "(input)"))];
    return error("Invalid input for this tool: " + paths.join(", "));
  }
  try {
    return { id: call.id, name: call.name, content: await tool.run(ctx, input.data as never), isError: false };
  } catch (failure) {
    // An InputError is written for the user (an unknown member name, a missing second person): the model may relay it.
    return error(failure instanceof InputError ? failure.message : "This tool could not complete the request.");
  }
}
