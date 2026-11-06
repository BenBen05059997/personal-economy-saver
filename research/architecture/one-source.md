# One source of truth: the map

What owns each fact in the app, what is duplicated on purpose, and what is left to unify. Written from the Nov 5 structure review (four read-only inventories, a consolidator and a skeptic in debate, every claim checked against the code). Rewrite in place when the code changes; this file describes the current state, not a history.

## Owners

| Fact | Owner | Everyone else |
|---|---|---|
| The forecast (series, low, safe to spend, room per card) | `src/lib/money/runway.ts` on `MoneyState` (major units) | Pages, the agent, MCP and the webhook read the same functions; no second forecast exists |
| The sentence | `homeSentence` in `sentence.ts` returns its parts (lead, emphasis and their link parts, clients, the day, short) and the joined `text` | `Sentence.tsx` renders the parts; Ask, the runway events and the LINE message use `text`; nothing parses the string |
| The occurrence of a repeating bill (dates, the amount that applies, D48 changes, D54 estimates) | `repeat.ts`: `occurrenceDates`, `nextOccurrenceAfter`, `amountOn`, `nextAmountOf`, `datesIn`, `variesOccurrences`; `resolveBills` and `expandBills` are where a stored bill (`StoredBill`) becomes an engine bill | `expandBills` (runway), `spendingItems` (month, search, regular costs), `splitBalance` and the two screens call them; none rebuilds the next-amount object |
| A dated spend item for any range, with category, whose and `estimated` | `spendingItems` in `spending.ts` (minor units) | `monthByCategory`, `searchSpending`, `regularCosts`, the family view and the tools build on it |
| A gap (what is missing, the estimate and its basis, urgency) and its words | `openGaps`, `gapEstimate` and the `gap*Words` functions in `gaps.ts` (D55); the word constants `NOT_KNOWN`, `NOT_KNOWN_YET`, `AMOUNT_NOT_KNOWN`, `DATE_NOT_KNOWN`, `AMOUNT_NOT_KNOWN_YET`, `DATE_NOT_KNOWN_YET` are the single definition | To check → Missing, Coming up, the sentence note, the month view and search, the family view and the `open_gaps` tool; `series` and `timeline` count a bill through `billCounts` |
| A name, for matching | `normalise` and `nameKey` in `name-key.ts` (re-exported by `spending.ts`) | Search, regular costs, varies linking, the CSV import's duplicate key, categorise's words |
| Whose an item is (D52) | `spendingItems`; a bill is shared when it has no owner, a charge when marked shared or on an owner-less card | `loadSplitState` asks a different question on purpose (D45: who is owed needs a payer), so it filters payer-less bills out; the two agree for bills because `bills.member_id` is a set-null composite FK |
| Minor units per currency | `minorPerUnit` in `format.ts` | `amount.ts`, `db/money.ts`, the engine modules, the tools and the components point at it; no inline `USD ? 100 : 1` |
| Money words: `minorMoney` (exact, the ledger), `money` (whole units, the forecast), `aboutMoney`, `ordinal`, `repeatWords` | `format.ts` | Two formatters stay, named by meaning: the forecast rounds, the ledger does not |
| The category list and the business share | `categories.ts` | zod, the JSON schema, the UI selects, the reader schema and the DB checks all derive from it (the applied migration SQL keeps a frozen copy by nature) |
| Rule constants | `FAMILY_LINK_DAYS` / `MAX_LIVE_FAMILY_LINKS` in `src/lib/family-links.ts`; `SEARCH_QUERY_MAX` (80) and `HISTORY_MONTHS` (12) in `spending.ts`; `REGULAR_MONTHS` (3) in `regular.ts`; `GAP_HISTORY` (3) and `URGENT_DAYS` (3) in `gaps.ts`; `WINDOW_DAYS` (30) in `runway.ts`; `AMOUNT_LIMIT` in `amount.ts`; the two-year horizon in `horizon.ts`; the family view's own maths in `family.ts` | The client components and the tools import the constant; no typed copies |
| The after-write steps (baseline, event, observe) | `beginMoneyChange` in `db/runway-events.ts` | Settings, approval, PayPal import/refresh and the webhook use it; the other thirteen writers repeat it by hand (after the deadline) |
| The household read per page | one read-only transaction per loader, each with its own window (`loadMoneyState` 62 days of charges for the runway; `loadSpending` any range for history) | Not merged: the pool is `max 3, max_pipeline 1`, so one big read would not be faster and light pages would pay more CPU under the 10 ms Workers budget |

## Duplicated on purpose

- The split reads charges only up to today; the runway counts future ones (D45).
- `money()` drops USD cents on Home; `minorMoney` keeps them on Plan: forecast versus ledger.
- "Needs checking" is counted by SQL on light pages and from the state on heavy ones; the same rows either way.
- Raw `fetch` beside `ApiForm` where a form is not a form: once-only tokens, JSON batches, file upload, the chat, the export download.
- The catalogue (`src/lib/catalogue`, `src/data/catalogue`) is secondary (D6) and imports nothing from the product; it stays.

## Shown in more than one place, from the same source

- The estimate flag (`estimated`) travels with the item: Coming up, the month, the family page, regular costs, the `timeline` and `month_by_category` tools all say "about".
- The client's pace (`paceLine` in `pace.ts`, "9 days usual · 21 slowest"): the client panel, the invoice review, the client list rows and the nudge action.
- The gap words ("about ¥9,330 (¥8,640–¥10,020, from your last 3 bills)", "amount not known", "date not known, counted as due now", "Due soon", "Could change your forecast"): To check, Coming up, the sentence note, the month view, the family view and the `open_gaps` tool all use the functions in `gaps.ts`; the form labels (`labels.ts`), the Activity titles (`src/db/bills.ts`), Ask and the daily message (`src/db/daily.ts`) use the same word constants.
- Cancel-by: set when adding a bill and changed in Edit.

## Left for after Nov 12

`MoneyState` in minor units with one `occurrences()` returning minor amounts (it reopens the yen rounding behind the demo sentence); a `dates.ts` for the six last-day-of-month and seven "add the year" copies; `beginMoneyChange` in every writer; the `Currency` type out of the catalogue (23 importers); `ApiForm` for ResetDemo, McpTokens and FamilyShare; `ConfirmRemove` for every confirm; one snapshot read for `/plan`.
