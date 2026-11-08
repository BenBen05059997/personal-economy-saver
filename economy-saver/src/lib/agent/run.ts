// The in-app agent (D40): Claude chooses tools over the engine and phrases their results. Plain manual loop on the
// provider-neutral model call (lib/ai). It logs one content-free line per Ask (log.ts) and nothing else: never the key, the question, a tool
// argument or result, or the answer.
import { householdDate } from "@/db/account";
import { loadMoneyState, requireHousehold, withHousehold, type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { listMemory } from "@/db/memory";
import { unconfirmedAmounts } from "@/lib/ai/number-check";
import { rulesFor } from "@/db/rules";
import { minorMoney } from "@/lib/money/format";
import { normalise } from "@/lib/money/name-key";
import { callModel } from "@/lib/ai/call";
import { ModelError, type Connection, type ToolResult, type ToolSpec, type Turn } from "@/lib/ai/types";
import type { MoneyState } from "@/lib/money/types";
import { logCall, type ToolLog } from "./log";
import type { Recipe } from "@/lib/canvas/schema";
import { chooseReply, type ReplyKind, type Source } from "./reply";
import { briefWords, type Brief } from "./brief";
import type { MemoryItem } from "@/lib/schema/memory";
import { memoryBlock } from "./memory-prompt";
import type { KeepOffer } from "./keep-offer";
import { MAX_KEEP_OFFERS, offerValue } from "./offer-tools";
import type { DeviceMemory } from "@/lib/store/memory-ops";
import { ASK_RULES, MODEL_RULES } from "./rules";
import { tools, toolInputSchema, type ToolContext } from "./tools";
import { THINKING_WORDS, toolWords } from "./words";

/** Messages are fixed, human and free of secrets and SQL; safe to show in a response. */
export class AgentError extends Error {
  /** The key of the fixed message (`fail`) or "api_error"; goes in the log line, never the message. */
  constructor(message: string, readonly outcome: string = "other") { super(message); }
  /** Set when a write tool had already succeeded in this question: what was kept, so the route can reply instead of failing. */
  saved?: { pending: boolean; links: { label: string; href: string }[] };
}

/** Tools whose result repeats text the model wrote. */
const NOT_SOURCES = new Set(["remember", "forget", "make_canvas", "offer_keep", "update_brief"]);

const MAX_TOOL_TURNS = 4;
const BUDGET_MS = 20_000;
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
  assembled?: { systemData: string; memoryForAmounts: string[]; memory: MemoryItem[] };
  spaceId?: string;
  /** D59: when the household keeps its memory on one device, the list the question carried. It is used for this question only; `remember` and `forget` change it in place and record `changes` for the reply. Without it, memory is read from the cloud. */
  deviceMemory?: DeviceMemory;
  /** Progress for the person waiting: fixed words when a model call starts and when a tool turn starts (words.ts). Never an amount, an argument or a result. */
  onStep?: (step: string) => void;
  /** D59: called once, right after the first write that left something on the server, so a retry of this question can be told it already wrote. */
  onWrote?: () => Promise<void>;
};
export type AskResult = {
  kind: ReplyKind; answer: string; choices: string[] | null; recipe: Recipe | null; sources: Source[];
  links: { label: string; href: string }[]; pending: boolean; offers: KeepOffer[]; brief?: Brief;
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
  const offers = new Map<string, { offer: KeepOffer; value: number | null }>();
  let pending = false;
  let brief: Brief | undefined;
  const toolAmounts: string[] = [];
  let recipe: Recipe | null = null;
  let clarify: { question: string; choices: string[] } | null = null;
  let outOfScope: "off_topic" | "not_offered" | null = null;
  const used: string[] = [];
  let called = false;
  let wrote = false, wroteToServer = false, wroteMemory = false;
  // The household's state is read once per tool turn, so tools in one turn agree with each other.
  let loaded: Promise<MoneyState> | undefined;
  const state = (tx: Db) => (loaded ??= householdDate(tx, hid).then(today => loadMoneyState(tx, hid, today)));
  const [initialState, initialMemory] = await withHousehold(opts.db, hid, async tx => Promise.all([
    state(tx),
    opts.assembled?.memory ?? opts.deviceMemory?.items ?? listMemory(tx, hid),
  ]));
  const { today, homeCurrency } = initialState;
  const ctx: ScopedToolContext = {
    madeBy: "ask", db: opts.db, householdId: hid, state, appUrl: opts.appUrl, askId: opts.askId, source: opts.source,
    addLink: link => { if (!links.some(known => known.href === link.href)) links.push(link); },
    onCanvas: next => { recipe = next; },
    onClarify: next => { clarify = next; },
    onOutOfScope: next => { outOfScope = next; },
    onOffer: offer => {
      const value = offerValue(offer, homeCurrency);
      const key = offerKey(offer);
      if (offers.has(key)) return;
      if (offers.size >= MAX_KEEP_OFFERS) throw new InputError(`Offer at most ${MAX_KEEP_OFFERS} different things to keep.`);
      offers.set(key, { offer, value });
    },
    deviceMemory: opts.deviceMemory,
    onBrief: opts.spaceId ? next => { brief = next; } : undefined,
    onPending: () => { pending = true; ctx.addLink?.({ label: "Open To check", href: new URL("/to-check", opts.appUrl).href }); },
  };
  const memory = memoryBlock(initialMemory.filter(item => !item.spaceId));
  const system = systemPrompt(today, homeCurrency, opts.assembled?.systemData ?? memory);
  const availableTools = opts.spaceId ? definitions : definitions.filter(tool => tool.name !== "update_brief");
  const turns: Turn[] = [{ role: "user", parts: [{ type: "text", text: opts.context ? `${opts.question}\n\n${opts.context}` : opts.question }] }];
  // Every amount in the answer must come from the question or a tool result (D56).
  const sources = [opts.question];
  sources.push(...(opts.assembled?.memoryForAmounts ?? (memory ? [memory] : [])));

  try {
    for (let toolTurns = 0; ;) {
      const remaining = deadline - now();
      if (remaining <= 0) throw failure("budget");
      opts.onStep?.(THINKING_WORDS);
      const connection = await opts.connection();
      trace.protocol = connection.protocol; trace.own = connection.own;
      if (!connection.textModel) throw new AgentError("AI_TEXT_MODEL is not set", "no_model");
      let reply;
      try {
        reply = await callModel({
          connection, model: connection.textModel, system, turns, tools: availableTools, maxTokens: MAX_TOKENS,
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
        return await finish(chooseReply({ clarify, outOfScope, text: answer, tools: used, called, recipe, sources }));
      }
      if (reply.stop === "refusal") throw failure("refusal");
      if (reply.stop === "length") throw failure("cutOff");
      if (reply.stop !== "tools" && reply.stop !== "pause") throw failure("stop");

      // The assistant turn goes back exactly as received (thinking blocks included); history is append-only.
      turns.push({ role: "assistant", raw: reply.raw });
      if (reply.stop === "pause") continue;
      if (++toolTurns > MAX_TOOL_TURNS) throw failure("turns");
      loaded = undefined;
      for (const words of new Set(reply.calls.map(call => toolWords(call.name)))) opts.onStep?.(words);

      const results: ToolResult[] = [];
      // clarify and out_of_scope end the question: when one is asked for and valid, it is the only call that runs, and there is no further model call.
      // One that fails its schema is an ordinary tool error: the other calls run and the loop goes on.
      const ending = reply.calls.find(call => call.name === "clarify" || call.name === "out_of_scope");
      if (ending) {
        const { result, log } = await callTool(ctx, ending, now);
        trace.tools.push(log);
        if (clarify !== null || outOfScope !== null) return await finish(chooseReply({ clarify, outOfScope, text: "", tools: used, called, recipe, sources }));
        results.push(result);
        await recordResult(result);
      }
      results.push(...await callAll(ctx, reply.calls.filter(call => call !== ending), trace, now, deadline, recordResult));
      turns.push({ role: "tools", results });
    }
  } catch (error) {
    // A write already succeeded (its rows are in To check, its memory change is in hand): the failure becomes a reply, so nothing is lost and a retry does not write twice.
    if (error instanceof AgentError && wrote) {
      if (wroteMemory) ctx.addLink?.({ label: "Open Memory", href: new URL("/memory", opts.appUrl).href });
      error.saved = { pending, links };
    }
    throw error;
  }

  async function recordResult(result: ToolResult) {
    // What the model wrote (a canvas it drew, a memory it kept) comes back echoed: it is not a source, or the model could confirm its own number.
    if (!NOT_SOURCES.has(result.name)) sources.push(result.content);
    const tool = tools.find(candidate => candidate.name === result.name);
    if (tool && result.name !== "update_brief" && result.name !== "clarify" && result.name !== "out_of_scope") called = true;
    if (result.isError) return;
    used.push(result.name);
    if (tool?.scope === "read" && !NOT_SOURCES.has(result.name)) toolAmounts.push(result.content);
    if (tool?.scope !== "draft") return;
    const memoryTool = result.name === "remember" || result.name === "forget";
    const onDevice = opts.deviceMemory !== undefined && memoryTool;
    wrote = true;
    if (memoryTool) wroteMemory = true;
    // A tool's transaction committed before this point. Note its write before starting the next tool.
    if (!wroteToServer && !onDevice) {
      await opts.onWrote?.();
      wroteToServer = true;
    }
  }

  async function finish(chosen: ReturnType<typeof chooseReply>): Promise<AskResult> {
    if (!chosen) throw new AgentError("The model gave an amount the app could not confirm from your numbers, so the answer is not shown. Ask again, or choose another model in Settings.", "unconfirmed_amount");
    const candidates = chosen.kind === "answer" ? [...offers.values()] : [];
    const readMemory = !opts.deviceMemory && wroteMemory && candidates.some(({ offer }) => offer.kind === "memory");
    const readRules = candidates.some(({ offer }) => offer.kind === "rule");
    const currentMemory = opts.deviceMemory?.items ?? initialMemory;
    const [memoryNow, standingRules] = readMemory || readRules
      ? await withHousehold(opts.db, hid, tx => Promise.all([readMemory ? listMemory(tx, hid) : currentMemory, readRules ? rulesFor(tx, hid) : null]))
      : [currentMemory, null] as const;
    const available = candidates.filter(({ offer, value }) => {
      if (offer.kind === "memory") {
        return !memoryNow.some(item => item.kind === offer.memoryKind && normalise(item.text) === normalise(offer.text))
          && unconfirmedAmounts(offer.text, sources).length === 0;
      }
      if (offer.kind === "goal") {
        return value !== null && !initialState.pots.some(pot => normalise(pot.name) === normalise(offer.name))
          && unconfirmedAmounts(`${offer.name} ${minorMoney(value, homeCurrency)}`, sources).length === 0;
      }
      const current = standingRules?.[offer.ruleKind];
      if (current?.enabled === offer.enabled && (current.threshold === value || !offer.enabled && value === null)) return false;
      return offer.ruleKind !== "safe_below" || value === null || unconfirmedAmounts(minorMoney(value, homeCurrency), sources).length === 0;
    }).map(({ offer }) => offer);
    const validSources = new Set([
      ...tools.map(tool => tool.name),
      ...initialMemory.filter(item => !item.spaceId || item.spaceId === opts.spaceId).map(item => item.id),
    ]);
    const checkedBrief = chosen.kind === "answer" && brief && brief.state.every(line => validSources.has(line.source))
      && unconfirmedAmounts(briefWords(brief).join("\n"), toolAmounts).length === 0
      ? brief : undefined;
    return { ...(checkedBrief && { brief: checkedBrief }), kind: chosen.kind, answer: chosen.text, choices: chosen.choices, recipe: chosen.recipe, sources: chosen.sources, links, pending, offers: available };
  }
}

function offerKey(offer: KeepOffer): string {
  switch (offer.kind) {
    case "memory": return `memory:${offer.memoryKind}:${normalise(offer.text)}`;
    case "goal": return `goal:${normalise(offer.name)}`;
    case "rule": return `rule:${offer.ruleKind}`;
  }
}

type Call = { id: string; name: string; input: unknown };
type ScopedToolContext = Omit<ToolContext, "state"> & { state: (tx: Db) => Promise<MoneyState> };

/** Reads in a row run together; a write (or a name outside the catalogue) runs alone, so the writes keep the order they were asked in. The results come back in the order asked. */
async function callAll(ctx: ScopedToolContext, calls: Call[], trace: Trace, now: () => number, deadline: number, onResult: (result: ToolResult) => Promise<void>): Promise<ToolResult[]> {
  const isRead = (call: Call) => tools.some(tool => tool.name === call.name && tool.scope === "read");
  const results: ToolResult[] = [];
  for (let at = 0; at < calls.length;) {
    let end = at + 1;
    if (isRead(calls[at])) while (end < calls.length && isRead(calls[end])) end++;
    // Each call times itself; the log keeps the order asked, not the order they finished in.
    const group = calls.slice(at, end);
    const runGroup = (context: ScopedToolContext) => Promise.all(group.map(call => callTool(context, call, now)));
    const step = group[0].name;
    // Only reads are raced against the budget; a write that has started is waited for, never abandoned half-way.
    const batch = isRead(group[0]) ? await beforeDeadline(
      withHousehold(ctx.db, ctx.householdId, tx => {
        const remaining = deadline - now();
        if (remaining <= 0) throw toolTimeout(step);
        // Share one scope for concurrent reads, and release it even when a tool times out.
        return beforeDeadline(runGroup({ ...ctx, db: tx }), remaining, step);
      }, { isolationLevel: "repeatable read", accessMode: "read only" }),
      Math.max(0, deadline - now()), step,
    ) : await runGroup(ctx);
    for (const { result, log } of batch) {
      results.push(result);
      trace.tools.push(log);
      await onResult(result);
    }
    at = end;
  }
  return results;
}

/** The reads of a turn against the time left of the question: past it, the question stops and says which step it was on. */
async function beforeDeadline<T>(work: Promise<T>, ms: number, tool: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(toolTimeout(tool)), ms);
  });
  try { return await Promise.race([work, late]); } finally { clearTimeout(timer); }
}

const lowerFirst = (words: string) => words.charAt(0).toLowerCase() + words.slice(1);
const toolTimeout = (tool: string) => new AgentError(`That took too long while ${lowerFirst(toolWords(tool))}. Try a simpler question.`, "budget");

async function callTool(ctx: ScopedToolContext, call: Call, now: () => number): Promise<{ result: ToolResult; log: ToolLog }> {
  const started = now();
  const result = await executeTool(ctx, call);
  // The model chose the name, so only a name in the catalogue is logged.
  return { result, log: { name: tools.some(t => t.name === call.name) ? call.name : "unknown", ok: !result.isError, ms: now() - started } };
}

async function executeTool(ctx: ScopedToolContext, call: Call): Promise<ToolResult> {
  const error = (message: string): ToolResult => ({ id: call.id, name: call.name, content: message, isError: true });
  const tool = tools.find(candidate => candidate.name === call.name);
  if (!tool || (tool.name === "update_brief" && !ctx.onBrief)) return error("Unknown tool.");
  const input = tool.input.safeParse(call.input);
  if (!input.success) {
    // Paths only: a zod message can echo the value the model sent.
    const paths = [...new Set(input.error.issues.map(issue => issue.path.join(".") || "(input)"))];
    return error("Invalid input for this tool: " + paths.join(", "));
  }
  try {
    const afterCommit: (() => void)[] = [];
    const content = await withHousehold(ctx.db, ctx.householdId, tx => tool.run({
      ...ctx, db: tx, state: () => ctx.state(tx),
      addLink: link => afterCommit.push(() => ctx.addLink?.(link)),
      onPending: () => afterCommit.push(() => ctx.onPending?.()),
    }, input.data as never));
    for (const effect of afterCommit) effect();
    return { id: call.id, name: call.name, content, isError: false };
  } catch (failure) {
    // An InputError is written for the user (an unknown member name, a missing second person): the model may relay it.
    return error(failure instanceof InputError ? failure.message : "This tool could not complete the request.");
  }
}
