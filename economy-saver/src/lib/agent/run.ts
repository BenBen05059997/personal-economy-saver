import { logSettingProblem } from "@/lib/operator-log";
// The in-app agent (D40): Claude chooses tools over the engine and phrases their results. Plain manual loop on the
// provider-neutral model call (lib/ai). It logs one content-free line per Ask (log.ts) and nothing else: never the key, the question, a tool
// argument or result, or the answer.
import { modelFailureWords } from "@/lib/ai/provider-failure";
import { householdDate } from "@/db/account";
import { loadMoneyState, requireHousehold, withHousehold, type Db } from "@/db/household";
import { InputError } from "@/db/input-error";
import { listMemory } from "@/db/memory";
import { unconfirmedNumbers, type CheckFact } from "@/lib/ai/number-check";
import { openSuggestions } from "@/db/suggestions";
import { fundingOptions } from "@/lib/money/options";
import { rulesFor } from "@/db/rules";
import { minorMoney } from "@/lib/money/format";
import { normalise } from "@/lib/money/name-key";
import { callModel } from "@/lib/ai/call";
import { ModelError, type Connection, type ToolResult, type ToolSpec, type Turn } from "@/lib/ai/types";
import type { MoneyState } from "@/lib/money/types";
import { logCall, type BriefDropReason, type ToolLog } from "./log";
import type { Recipe } from "@/lib/canvas/schema";
import { VIEW_META } from "@/lib/views/catalogue";
import { MAX_SHOWN, type Reading, type ViewBlock } from "./view-tools";
import { nextSteps } from "./see-it";
import { canvasWords, chooseReply, type OutOfScopeReason, type ReplyKind, type Source, type Wording } from "./reply";
import { briefWords, type Brief } from "./brief";
import { memorySourceLabel, type MemorySource } from "@/lib/schema/turn";
import type { ContextTurn } from "./context";
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
const NOT_SOURCES = new Set(["remember", "forget", "make_canvas", "offer_keep", "update_brief", "search_history", "open_space"]);

const MAX_TOOL_TURNS = 4;
let cachedBudgetMs: number | undefined;

/** Read once per process, when Ask first runs. */
export function askBudgetMs(): number {
  if (cachedBudgetMs !== undefined) return cachedBudgetMs;
  const setting = process.env.ASK_BUDGET_MS?.trim();
  if (!setting) return cachedBudgetMs = 20_000;
  const ms = Number(setting);
  if (!/^\d+$/.test(setting) || !Number.isInteger(ms) || ms < 1 || ms > 2_147_483_647) {
    throw new Error("ASK_BUDGET_MS must be a positive whole number of milliseconds within the timer range.");
  }
  return cachedBudgetMs = ms;
}
const MAX_TOKENS = 16_000;

const definitions: ToolSpec[] = tools.map(tool => ({ name: tool.name, description: tool.description, schema: toolInputSchema(tool) }));

/** The stable part is the same for every household and day, so a provider can cache it; what varies comes after it. */
function systemPrompt(today: string, currency: string, memory: string) {
  const stable = `You are the money assistant inside Personal Economy Saver, for one household.

${MODEL_RULES.split("\n")[0]}
Answer in one or two plain sentences, in the language of the person's latest message.
${MODEL_RULES.split("\n").slice(1).join("\n")}
${ASK_RULES}`;
  return { stable, full: `${stable}\n\nToday is ${today} and the household's home currency is ${currency}.${memory ? `\n\n${memory}` : ""}` };
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
  if (error instanceof ModelError) return new AgentError(modelFailureWords(error, fail.budget), "api_error");
  return new AgentError("Couldn't reach the AI service. Try again.", "api_error");
}

/** What the one log line is built from; filled in as the Ask runs. */
type Trace = { kind?: string; canvas?: boolean; briefDropped?: BriefDropReason; stop: string; turns: number; tools: ToolLog[]; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; protocol?: string; own?: boolean };

type AskOptions = {
  db: Db; householdId: string; question: string; askId: string; appUrl: URL; source?: "voice" | "manual";
  connection: () => Promise<Connection>; fetch?: typeof globalThis.fetch; now?: () => number;
  /** Quoted data that goes into the user turn after the question (earlier turns, the canvas on screen). Never an amount source. */
  context?: string;
  assembled?: { systemData: string; memoryForAmounts: string[]; earlierQuestions?: string[]; memory: MemoryItem[] };
  spaceId?: string;
  deviceHistory?: ContextTurn[];
  incognito?: boolean;
  /** D59: when the household keeps its memory on one device, the list the question carried. It is used for this question only; `remember` and `forget` change it in place and record `changes` for the reply. Without it, memory is read from the cloud. */
  deviceMemory?: DeviceMemory;
  /** Progress for the person waiting: fixed words when a model call starts and when a tool turn starts (words.ts). Never an amount, an argument or a result. */
  onStep?: (step: string) => void;
  /** D59: called once, right after the first write that left something on the server, so a retry of this question can be told it already wrote. */
  onWrote?: () => Promise<void>;
};
export type AskResult = {
  kind: ReplyKind; answer: string; wording?: Wording; choices: string[] | null; recipe: Recipe | null; sources: Source[];
  links: { label: string; href: string }[]; pending: boolean; offers: KeepOffer[]; brief?: Brief; memoryChanged?: boolean; openSpace?: { name: string };
};

export async function runAgent(opts: AskOptions): Promise<AskResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const trace: Trace = { stop: "none", turns: 0, tools: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
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
      ...(trace.briefDropped && { briefDropped: trace.briefDropped }),
      stop: trace.stop, turns: trace.turns, tools: trace.tools, outcome, ms: now() - started,
      inputTokens: trace.inputTokens, outputTokens: trace.outputTokens,
      cacheReadTokens: trace.cacheReadTokens, cacheWriteTokens: trace.cacheWriteTokens,
      ...(trace.protocol && { protocol: trace.protocol, own: trace.own }),
    });
  }
}

async function converse(opts: AskOptions, trace: Trace): Promise<AskResult> {
  const now = opts.now ?? Date.now;
  const deadline = now() + askBudgetMs();
  const hid = requireHousehold(opts.householdId);

  const links: { label: string; href: string }[] = [];
  const offers = new Map<string, { offer: KeepOffer; value: number | null }>();
  let pending = false;
  let brief: Brief | undefined;
  let openSpace: { name: string } | undefined;
  // The engine facts of this Ask's tool results (D79): the only thing that confirms a number (D56).
  // A fact tagged by:"person" (the amount a picture tests) is not kept: the model chose that argument, so it could be invented. What the person really said is in `person` below.
  const toolFacts: CheckFact[] = [];
  const keep = (facts: readonly CheckFact[]) => { toolFacts.push(...facts.filter(known => known.by !== "person")); };
  const readings: Reading[] = [];
  const citedIds = new Set<string>();
  const readIds = new Set<string>();
  // The person’s question, rather than the model’s reformulation, determines the scope.
  const always = /\b(?:always|from now on|every time)\b|いつも|今後|これからは/i.test(opts.question);
  const memorySpaceId = always ? undefined : opts.spaceId;
  const wantsMemory = /\b(?:remember|keep (?:this|that|it) in mind|(?:save|add) .{1,60} to (?:my |your )?memory)\b|覚えて|記憶して|記録して/i.test(opts.question)
    && !/\b(?:do not|don't|never) remember\b|覚えないで|記憶しないで|記録しないで/i.test(opts.question);
  let recipe: Recipe | null = null;
  const drawn: Recipe[] = [];
  const shown: ViewBlock[] = [];
  // The answer's canvas: the last make_canvas recipe with the views `show` drew after it (D77); a title from the first view when there is no recipe.
  const answerRecipe = (): Recipe | null => {
    if (shown.length === 0) return recipe;
    const blocks = [...(recipe?.blocks ?? []).slice(0, 12 - shown.length), ...shown] as unknown as Recipe["blocks"];
    return { version: 1, title: recipe?.title ?? VIEW_META[shown[0].view].question, ...(recipe?.scenario && { scenario: recipe.scenario }), blocks };
  };
  let clarify: { question: string; choices: string[] } | null = null;
  let outOfScope: OutOfScopeReason | null = null;
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
    onCanvas: next => { recipe = next; drawn.push(next); },
    onView: reading => {
      if (shown.length >= MAX_SHOWN) throw new InputError("Show at most four views in one answer.");
      shown.push(reading.block);
      readings.push(reading);
    },
    onClarify: next => { clarify = next; },
    onOutOfScope: next => { outOfScope = next; },
    onOffer: offer => {
      const value = offerValue(offer, homeCurrency);
      const key = offerKey(offer);
      if (offers.has(key)) return;
      if (offers.size >= MAX_KEEP_OFFERS) throw new InputError(`Offer at most ${MAX_KEEP_OFFERS} different things to keep.`);
      offers.set(key, { offer, value });
    },
    deviceMemory: opts.deviceMemory, deviceHistory: opts.deviceHistory, spaceId: opts.spaceId, memorySpaceId, canRemember: wantsMemory,
    onMemoryRead: id => { readIds.add(id); },
    incognito: opts.incognito,
    onOpenSpace: next => { openSpace ??= next; },
    onBrief: opts.spaceId ? next => {
      brief = next;
      trace.briefDropped = "no_answer";
    } : undefined,
    onPending: () => { pending = true; ctx.addLink?.({ label: "Open To check", href: new URL("/to-check", opts.appUrl).href }); },
  };
  const memory = memoryBlock(initialMemory.filter(item => !item.spaceId));
  const incognitoRule = opts.incognito
    ? "This question is Incognito. You can read. If asked to make a change, say the person can switch off Incognito to do that."
    : "";
  const system = systemPrompt(today, homeCurrency, [incognitoRule, opts.assembled?.systemData ?? memory].filter(Boolean).join("\n\n"));
  const availableTools = definitions.filter((_, index) => toolAvailable(ctx, tools[index]));
  const turns: Turn[] = [{ role: "user", parts: [{ type: "text", text: opts.context ? `${opts.question}\n\n${opts.context}` : opts.question }] }];
  // Every number in the answer must be an engine fact of this Ask, or one the person said and is quoted back (D56, D79). The household
  // snapshot, the model's own drafts and any earlier reply confirm nothing. No document is given in an Ask: a document is its own turn.
  const person = [opts.question, ...(opts.assembled?.earlierQuestions ?? []), ...(opts.assembled?.memoryForAmounts ?? (memory ? [memory] : []))];
  const checked = (text: string, facts: readonly CheckFact[] = toolFacts) => unconfirmedNumbers(text, facts, { today, person }).length === 0;

  try {
    for (let toolTurns = 0; ;) {
      const remaining = deadline - now();
      if (remaining <= 0) throw failure("budget");
      opts.onStep?.(THINKING_WORDS);
      const connection = await opts.connection();
      trace.protocol = connection.protocol; trace.own = connection.own;
      if (!connection.textModel) { logSettingProblem("ask_not_set_up", "AI_TEXT_MODEL is not set", opts.householdId); throw new AgentError("Ask has no model to use. Choose one in Settings → Your AI model.", "no_model"); }
      let reply;
      try {
        reply = await callModel({
          connection, model: connection.textModel, system: system.full, systemStable: system.stable, turns, tools: availableTools, maxTokens: MAX_TOKENS,
          timeoutMs: remaining, fetch: opts.fetch, appUrl: opts.appUrl,
        });
      } catch (error) { trace.stop = "api_error"; throw apiFailure(error); }
      trace.stop = reply.stop;
      trace.turns++;
      trace.inputTokens += reply.inputTokens;
      trace.outputTokens += reply.outputTokens;
      trace.cacheReadTokens += reply.cacheReadTokens;
      trace.cacheWriteTokens += reply.cacheWriteTokens;

      if (reply.stop === "end") {
        const answer = reply.text.replace(/[ \t]*\[\[memory:([0-9a-f-]+)\]\]/gi, (_, id: string) => {
          citedIds.add(id.toLowerCase());
          return "";
        }).trim();
        if (!answer) throw failure("empty");
        return await finish(chooseReply({ clarify, outOfScope, text: answer, tools: used, called, recipe: answerRecipe(), facts: toolFacts, person, today, readings }));
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
        if (clarify !== null || outOfScope !== null) return await finish(chooseReply({ clarify, outOfScope, text: "", tools: used, called, recipe: answerRecipe(), facts: toolFacts, person, today, readings }));
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
    // `show`'s facts came with its reading; every other tool's are in its result.
    if (!result.isError && !NOT_SOURCES.has(result.name) && result.name !== "show") keep(factsIn(result.content));
    if (!result.isError && result.name === "make_canvas") {
      const engineFilled = withoutModelWords(result.content, drawn);
      if (engineFilled !== null) keep(factsIn(engineFilled));
    }
    if (!result.isError && result.name === "show") keep(readings.flatMap(reading => reading.facts).filter(known => !toolFacts.includes(known)));
    const tool = tools.find(candidate => candidate.name === result.name);
    if (tool && toolAvailable(ctx, tool) && result.name !== "update_brief" && result.name !== "clarify" && result.name !== "out_of_scope") called = true;
    if (result.isError) return;
    used.push(result.name);
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
        return !memoryNow.some(item => (item.spaceId ?? undefined) === memorySpaceId && item.kind === offer.memoryKind && normalise(item.text) === normalise(offer.text))
          && checked(offer.text);
      }
      if (offer.kind === "goal") {
        return value !== null && !initialState.pots.some(pot => normalise(pot.name) === normalise(offer.name))
          && checked(`${offer.name} ${minorMoney(value, homeCurrency)}`);
      }
      const current = standingRules?.[offer.ruleKind];
      if (current?.enabled === offer.enabled && (current.threshold === value || !offer.enabled && value === null)
        && (!opts.spaceId || current.spaceId === opts.spaceId)) return false;
      return offer.ruleKind !== "safe_below" || value === null || checked(minorMoney(value, homeCurrency));
    }).map(({ offer }) => {
      const spaceId = offer.kind === "memory" ? memorySpaceId : offer.kind === "rule" ? opts.spaceId : undefined;
      return spaceId ? { ...offer, spaceId } : offer;
    });
    let checkedBrief: Brief | undefined;
    if (brief && chosen.kind === "answer") {
      const validSources = new Set([
        ...tools.map(tool => tool.name),
        ...initialMemory.filter(item => !item.spaceId || item.spaceId === opts.spaceId).map(item => item.id),
        ...readIds,
      ]);
      if (!brief.state.every(line => validSources.has(line.source))) trace.briefDropped = "invalid_source";
      else if (unconfirmedNumbers(briefWords(brief).join("\n"), toolFacts, { today }).length) trace.briefDropped = "unconfirmed_amount";
      else {
        delete trace.briefDropped;
        checkedBrief = brief;
      }
    }
    const memorySources: MemorySource[] = [];
    if (chosen.kind === "answer") {
      for (const id of citedIds) {
        const item = memoryNow.find(item => item.id === id);
        const quoted = (opts.assembled?.memoryForAmounts ?? [memory]).some(block => block.includes(JSON.stringify(id)));
        if (!item || !(readIds.has(id) || quoted)) continue;
        memorySources.push({ kind: "memory", id, label: memorySourceLabel(item.text) });
      }
    }
    if (chosen.kind === "answer" && readings.length) {
      // What next (D80): read once, here, so a reload shows the same buttons (they are saved links).
      const findings = await openSuggestions(opts.db, hid);
      const clientOf = new Map(initialState.invoices.map(invoice => [invoice.id, invoice.clientId]));
      for (const step of nextSteps({ facts: readings.flatMap(reading => reading.facts), suggestions: findings, options: fundingOptions(initialState), clientOfInvoice: id => clientOf.get(id) })) {
        if (!links.some(known => known.href === step.href)) links.push(step);
      }
    }
    return { ...(checkedBrief && { brief: checkedBrief }), ...(wroteMemory && { memoryChanged: true }), kind: chosen.kind, answer: chosen.text,
      ...(chosen.kind === "answer" && { wording: chosen.wording ?? "model" }),
      choices: chosen.choices, recipe: chosen.recipe, sources: [...chosen.sources, ...memorySources], links, pending, offers: available,
      ...(chosen.kind === "answer" && openSpace && checked(openSpace.name) && { openSpace }) };
  }
}

/**
 * A canvas result with every string the model wrote on the canvas (title, labels, notes, letters) blanked out, so what is left
 * is what the engine filled in. `null` when blanking leaves something that is no longer JSON: a non-JSON source would confirm any number.
 */
function withoutModelWords(content: string, recipes: Recipe[]): string | null {
  const words = recipes.flatMap(canvasWords).map(word => JSON.stringify(word).slice(1, -1)).filter(Boolean).sort((a, b) => b.length - a.length);
  let clean = content;
  for (const word of new Set(words)) clean = clean.split(word).join("");
  let parsed: { blocks?: Record<string, unknown>[] };
  try { parsed = JSON.parse(clean); } catch { return null; }
  // A single progress block's target is the one amount a recipe carries (D57): the model wrote it, so it confirms nothing.
  for (const block of parsed.blocks ?? []) if (block.type === "progress" && !("rows" in block)) delete block.target;
  return JSON.stringify(parsed);
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

function toolAvailable(ctx: ScopedToolContext, tool: (typeof tools)[number]): boolean {
  if (ctx.incognito && tool.scope !== "read" && tool.name !== "clarify" && tool.name !== "out_of_scope") return false;
  return tool.name !== "update_brief" || ctx.onBrief !== undefined;
}

async function executeTool(ctx: ScopedToolContext, call: Call): Promise<ToolResult> {
  const error = (message: string): ToolResult => ({ id: call.id, name: call.name, content: message, isError: true });
  const tool = tools.find(candidate => candidate.name === call.name);
  if (!tool) return error("Unknown tool.");
  if (!toolAvailable(ctx, tool)) return error(ctx.incognito ? "This tool is unavailable in Incognito." : "Unknown tool.");
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

/** The facts a tool result carries: every `facts` list in it, at any depth (a canvas summary has one per block), when the result is JSON; else the JSON after "Facts:" that a text result ends with. */
function factsIn(content: string): CheckFact[] {
  let json: unknown;
  try { json = JSON.parse(content); } catch {
    const at = content.lastIndexOf("\n\nFacts: ");
    if (at < 0) return [];
    try { json = JSON.parse(content.slice(at + "\n\nFacts: ".length)); } catch { return []; }
  }
  const found: CheckFact[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "facts" && Array.isArray(item)) found.push(...item.filter((fact): fact is CheckFact => fact !== null && typeof fact === "object" && "unit" in fact && "value" in fact));
      else walk(item);
    }
  };
  walk(json);
  return found;
}
