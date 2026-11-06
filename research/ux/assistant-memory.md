# How assistants remember, and how memory stays fresh

Research date: 2026-11-06. Web research plus a reading of our own code. It adds to [assistant-scope-and-conversation.md](assistant-scope-and-conversation.md) (scope, the three kinds of reply) and [missing-data.md](missing-data.md) (unknown amounts and dates).

Evidence key: **[V]** read on the vendor's or author's own page or paper. **[S]** secondary source (press, blog, third-party guide). **(unverified)** weak source or a page that would not load. **[our note]** our own reading.

## Summary

1. Every product keeps two things apart: a short list of saved items the person can read, edit and delete, and a looser recall of past chats. The saved list is what goes into every prompt. [V][S]
2. Products write memory both when told ("remember this") and on their own; none of the consumer products asks before saving. They tell the person afterwards (ChatGPT's "Memory updated" notice) and rely on a page where items can be edited or deleted. [V][S]
3. Libraries keep memory consistent at write time: a new fact is compared with the most similar existing items and a model chooses add, update, delete or nothing (Mem0). Without that step, collections fill with duplicates and contradictions. [V]
4. Time is handled in three ways: replace the old item (Mem0, Claude's files), mark the old fact invalid from a date and keep it (Zep/Graphiti, Mem0's graph), or give an item an end date after which it stops being used (Mem0's expiration_date). [V]
5. An expired item is hidden from what the model reads, not deleted; it can still be read by id or shown on request. [V]
6. Consumer products publish almost nothing on staleness. Their answer is the person's own edit, plus deletion of items nobody touches for a long time. [V]
7. A money app that published how its memory works (Cleo) filters out remembered things that conflict with live data such as a current balance: the account record wins over memory. [S]
8. Small lists go into the prompt whole (ChatGPT saved memories, Letta's memory blocks with a size limit); large stores are searched (Letta archival, Zep, Mem0). [V][S]

## 1. ChatGPT

- **Two parts.** "Saved memories" are short items the person asked for or ChatGPT chose to keep; "reference chat history" draws on past chats with no fixed list and no separate limit. Turning off saved memories also turns off chat history. (search snippets of OpenAI's Memory FAQ; the page returned 403) [S](https://help.openai.com/en/articles/8590148-memory-faq)
- **Writing.** The person can ask it to remember something, or it picks up details itself; since September 2024 the chat shows "Memory updated", and hovering it leads to "Manage memories". [S](https://openai.com/blog/memory-and-new-controls-for-chatgpt) (OpenAI's page, read through search; direct fetch returned 403)
- **Uncertainty.** It saves without asking first and tells the person after; users report the notice appearing when nothing was saved. [S](https://community.openai.com/t/memory-not-updating-in-chatgpt-4o-issue-persists-across-conversations/1105721?page=2)
- **Limits and freshness.** Saved memories used to fill up ("memory full"); a 2025 change has ChatGPT manage them itself, keeping what was mentioned recently and often "top of mind", with search and sort in settings. [S](https://www.techradar.com/ai-platforms-assistants/chatgpt/chatgpt-is-smarter-now-that-its-learned-to-forget-a-huge-memory-upgrade-is-coming)
- **Deleting.** Deleting a chat does not delete a memory made from it; deleted memories may stay in logs up to 30 days. Temporary chat neither uses nor writes memory. [S](https://help.openai.com/en/articles/8590148-memory-faq)

## 2. Claude

- **claude.ai memory.** Saved as separate topics while the person chats (role, projects, people, preferences), "rather than summarizing conversations after they end"; an older version wrote one summary refreshed every 24 hours. [V](https://support.claude.com/en/articles/11817273-how-does-claude-s-memory-work)
- **Scope.** Each project has its own memory; project chats also read account memory unless that is switched off. Incognito chats are not saved or searched. Pause keeps memory but stops using and writing it; reset deletes everything. [V](https://support.claude.com/en/articles/11817273-how-does-claude-s-memory-work)
- **Control.** Settings lists every topic to read, edit or delete; in chat the person can say remember, change or forget. Health, politics and similar topics are left out unless the person opts in; account numbers and government IDs are never saved. [V](https://support.claude.com/en/articles/11817273-how-does-claude-s-memory-work)
- **Freshness.** Deleting a chat does not remove memory from it; with an organisation's retention period, entries not updated within it are deleted. [V](https://support.claude.com/en/articles/11817273-how-does-claude-s-memory-work)
- **Uncertainty.** Saves on its own; searching past chats shows as a tool call in the chat. No published step that asks before saving. [V](https://support.claude.com/en/articles/11817273-use-claudes-chat-search-and-memory-to-build-on-previous-context)
- **API memory tool.** A directory of files under `/memories` that the app stores; the model calls `view`, `create`, `str_replace`, `insert`, `delete`, `rename`. The model decides what to write, checks the directory before each task, and is told to keep it up to date and delete what is no longer relevant. [V](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- **The app's job.** Cap file size, cap what `view` returns, strip sensitive data before writing, reject paths outside `/memories`, and "periodically delete memory files that haven't been accessed in a long time". [V](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)

## 3. Gemini and Microsoft Copilot

- **Gemini saved info.** Added on the settings page or by asking Gemini to remember during a chat; each item can be edited or deleted; one switch turns it off; nothing is saved when a policy check flags it. Past chats are a separate, gradual feature. [V](https://support.google.com/gemini/answer/16413516)
- **Gemini, freshness and uncertainty.** Not on the page. Secondary guides say past-chat memory needs activity history on and that the person can ask "Did you use any info from past chats?". [S](https://9to5google.com/2025/08/13/gemini-personal-context/)
- **Microsoft Copilot.** Saves key details from chats automatically when memory is on; the person asks "What do you know about me", asks it to forget something, deletes items in settings, or uses a temporary chat that neither reads nor saves memory. Nothing on how stale items are updated. [V](https://support.microsoft.com/Microsoft-365-Copilot/personalize-what-microsoft-365-copilot-remembers)
- **Copilot, uncertainty.** "Remember that…" adds an item and "Forget that…" removes it; the person checks by asking again. No confirm step. [V](https://support.microsoft.com/en-us/microsoft-copilot/microsoft-copilot-privacy-controls)

## 4. Mem0

- **Write path.** Extraction: a model reads the new message pair with a conversation summary and the last 10 messages, and lists candidate facts. Update: for each fact the 10 most similar memories are fetched and a model picks ADD (new), UPDATE (add detail to an existing one), DELETE (remove one the fact contradicts) or NOOP. [V](https://arxiv.org/html/2504.19413)
- **Graph variant.** Entities and relations; on a conflict the old relation is marked invalid "rather than physically removing them", so time can be reasoned about. [V](https://arxiv.org/html/2504.19413)
- **Size.** About 7k tokens of memory per conversation against about 26k for the full history, p95 latency 1.44 s against 17.1 s. [V](https://arxiv.org/html/2504.19413)
- **Expiry.** An optional `expiration_date` (YYYY-MM-DD) per memory; after it, search and list skip the item, reading by id still works, clearing the date brings it back. Examples given: a trial that ends, a seasonal preference. [V](https://docs.mem0.ai/platform/features/memory-expiration)
- **Uncertainty.** The model decides silently; there is no ask step. Each memory has created and updated times. [V](https://docs.mem0.ai/platform/features/expiration-date)

## 5. Zep and Graphiti

- **Shape.** Raw episodes (messages, JSON) are kept; entities and facts are extracted from them; each fact is an edge with four times: when it became true and stopped being true, and when the system learned and retired it. [V](https://arxiv.org/html/2501.13956)
- **Contradictions.** A model compares a new fact with related ones; if they overlap in time and conflict, the old fact's end is set to the new fact's start. History is kept, so "what was true in March" can be answered. [V](https://arxiv.org/html/2501.13956)
- **Dates.** Relative dates ("two weeks ago") are turned into ISO dates from the message's own time. [V](https://arxiv.org/html/2501.13956)
- **Reading.** Hybrid search (embeddings, keyword, graph distance), then rerank; the prompt gets facts with their valid dates. "When information changes, old facts are invalidated — not deleted." [V](https://github.com/getzep/graphiti)
- **Uncertainty.** Resolved by the model at ingest, silently. [V](https://arxiv.org/html/2501.13956)

## 6. Letta (MemGPT), LangMem and LangGraph

- **MemGPT.** The prompt has fixed instructions, a small working context the model edits through function calls, and a queue of recent messages; at about 70% of the window the system warns the model, at 100% it evicts half and writes a running summary. Everything else is in searchable recall and archival storage. [V](https://arxiv.org/html/2310.08560)
- **Letta memory blocks.** Each block has a label, a description that tells the agent what belongs in it, a value, a character limit, and an optional read-only flag; blocks are always in the prompt. [V](https://docs.letta.com/guides/agents/memory-blocks)
- **Letta archival memory.** A vector store with tags, searched on demand; agents find it hard to change or delete entries there. Blocks are for what must always be seen or changes often. [V](https://docs.letta.com/guides/agents/archival-memory)
- **LangMem.** Semantic (facts), episodic (past examples), procedural (the agent's own rules). Facts are either a collection of small items, which must be reconciled with each write, or one profile document updated in place for current state. [V](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- **Hot path or background.** Writing during the chat is immediate and can be shown to the person, at the cost of delay; writing afterwards adds no delay but lags. No expiry; recency and use count weigh what is recalled. [V](https://docs.langchain.com/oss/python/langgraph/memory)
- **Uncertainty.** Left to the developer; the hot path is where a person can see and correct a write. [V](https://docs.langchain.com/oss/python/langgraph/memory)

## 7. Money apps

- **Cleo 3.0 (July 2025).** Keeps summaries, topics and sentiment, not transcripts, as a graph of the person, goals and stressors; memory is filtered so an old recollection does not contradict live data such as the current balance; editable history is named as a later step. Read on mirror domains of Cleo's blog. [S](https://meetcleo.vercel.app/blog/memory-as-a-step-toward-more-human-ai), [S](https://thenextweb.com/news/cleo-launches-ai-money-coach-fix-spending-habits)
- **Monarch, Copilot Money, banks.** Nothing published on assistant memory; Monarch's assistant answers from imported transactions. (not found) [S](https://getfinny.app/blog/monarch-money-ai-assistant-2026)

## 8. What we have today [our note]

- Memory items: kind (fact, preference, goal, instruction, correction), text up to 400 characters, who made it, the question, created and updated times; 200 a household; `remember`, `forget`, `recall`; an exact repeat is refused ("The assistant already knows that."). No update tool, no dates of validity.
- The whole list goes into every question, ranked instructions first, up to 6,000 characters, the rest through `recall`. This matches ChatGPT's saved memories and Letta's blocks; at 200 short items retrieval is not needed.
- The record: bills with a due date, `repeat` month or year, a next amount, `cancel_by` (information only), amount or date may be unknown (D55). A repeating bill has no end date and a bill has no paid flag: the engine assumes it leaves the bank on its due date. Bills the agent adds wait in To check until confirmed.
- D58 already says patterns the engine works out stay in the engine. What is missing is a rule for facts that have a date or an amount.

## What this means for our app [our note]

**The rule: if it can change a number, it is a record; memory holds words.**

- A bill, a card purchase, a balance, an invoice, a pot, a bill's last date, an amount that changes: the record, through the draft tools and To check. The engine counts it, Activity traces it, export carries it.
- Memory holds what shapes how the agent talks and what it offers: preferences, standing instructions, goals in the person's words, corrections, and facts with no amount or date the engine needs ("the gym is shared", "I'm thinking about dropping the gym").
- Like Cleo, the record wins: memory never restates an amount or date that a record holds. `remember` refuses a text that names an amount or a date the engine would need and offers the bill instead ("That sounds like a bill. Add it?").

**Ben's example, in the record.**

- A one-off bill due Dec 31 is a bill with `repeat` null. After its due date the engine already counts it as gone; nothing goes into memory.
- "It may or may not come again": the agent asks (below). "Just this once" saves a one-off. "Not sure" also saves a one-off; if the same name comes back (reader, CSV), the regular-costs engine (D54) already notices and offers a repeat. Memory is never the reminder.
- "The gym ends after December": a repeating bill with a last date. Add `repeat_until` (last occurrence, nullable) to bills: `repeat.ts` stops there, Coming up says "last one Dec 27", the form, the reader card and `add_bill` take it.
- A bill that did not leave on its due date (late, skipped) is a record change too (a new date, or skip this occurrence), never a memory.

**One update path.**

- Add `update_memory` (id, new text, optional kind), the same function as the Memory page's edit. This is Mem0's UPDATE and Claude's `str_replace`.
- On `remember`, code first finds similar items (same kind, or shared name words through `nameKey`) and returns them with the tool result. The model then chooses: NOOP (already known, the current message), UPDATE (`update_memory`), ADD, or, on a contradiction, ask.
- No history is kept: the new text replaces the old (D23, D58: an event records that memory changed, never the text). We do not need Graphiti's "what was true in March".

**Time.**

- Add an optional `valid_until` date to a memory item, set when the person's words carry one ("I'm in Osaka until the 20th", "skip the tax pot this month").
- After the date: left out of the prompt (Mem0's rule), kept on the Memory page under "Out of date" with Renew and Delete, marked in `recall`. The agent does not ask about it unprompted.
- The prompt carries each item's updated date, so the agent can say "you told me in March" and ask when an old item meets a question it changes.

**When the agent asks, drafts, or just remembers.** Uses `clarify` (D60): one question, two to four choices.

- **Just remember, and say so:** the person said "remember", or stated a lasting preference, instruction, goal or correction; no amount or date the engine needs; nothing similar already held. The answer names what was kept (as ChatGPT's notice), with a link to Memory.
- **Draft for Confirm:** anything that is or changes a record, including a bill's repeat, last date, or a skipped occurrence. Always To check, never memory.
- **Ask first (clarify):**
  - memory or record is unclear (an amount or a date the person did not call a bill): "Bill / Just remember / Neither";
  - a bill's repeat is unknown: "Just this once / Every month / Every year / Not sure";
  - a repeating bill is ending and the last date is unknown: "Dec is the last / Later / Not sure yet";
  - the new words contradict a remembered item or a record: "Replace it / Keep both / Leave it".
- Never ask what code can decide (an exact repeat is NOOP). One question per reply; after the tap the agent writes and says what it wrote.

**Before Nov 10, smallest first.**

1. Rules only: the memory-or-record rule and the ask rule in `ASK_RULES` and the `remember` description, with eval cases (a bill told as a memory, an unknown repeat, a contradiction).
2. `update_memory`, on the existing Memory page functions (cloud and device lists).
3. `remember` returns similar items, and refuses an amount or date the engine needs with the bill offer.

**After Nov 10.**

4. `repeat_until` on bills (migration, `repeat.ts`, form, reader card, `add_bill`, Coming up words).
5. `valid_until` on memory items (migration, schema `memory.v2`, export and device store, the "Out of date" group).
6. Skip or move one occurrence of a bill, for a bill that did not leave on its date.
7. A small "Remembered" line under the answer that links to the item on the Memory page.
