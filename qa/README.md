# QA scenarios

One scenario is one user action with one expected outcome, so a failure points to one behaviour. A testing agent runs the scenarios and records results, and a fixing agent fixes the failures. The automated checks (`npm run db:test` and `economy-saver/scripts/frontend-check.mjs`) are the record of how the app behaves. A scenario is written only for what a script can't see in a browser: dialogs and focus, look and layout, the chat feel, voice, and real email, PayPal or model round trips that need the owner.

## Files

- `scenarios/*.json` — the checklist, one file per area. Each file is a JSON array of scenarios.
- `results-scripted.json` (the `suite` and `http` scenarios) and `results-browser.json` (the `browser` scenarios) — the latest run, one entry per scenario run. A full run overwrites its file; a partial run updates only the entries it ran. `results-live.json` (the deployed Worker) and `results-worker-local.json` (the local Worker preview) hold one entry per scenario run in that environment, kept separate from the main run.
- `evidence/` (git-ignored) — a screenshot for each browser fail (`<id>.png`) and a screen recording per area (`<area>.mov`).
- `node economy-saver/scripts/qa-report.mjs` — checks the scenario files, merges the results files, then prints the counts and the failures. `--failures` prints the failing and blocked entries as JSON (what the fixing run reads). `--check` only checks the scenario files.

## How to run

- Run the app on http://127.0.0.1:3123 (always 127.0.0.1, not localhost): `npm run dev -- -p 3123` in `economy-saver/`. Restart it after any change in `src/db/`, the schema or `next.config.ts`, and keep one browser tab open. For scenarios that need a model, run the dev model bridge on http://127.0.0.1:3130 (`npm run codex:bridge`); it reads images but refuses PDFs.
- Start from a fresh Try it household: Reset in the top banner beside Sample household → Reset (or a private window, then Try it). Try it and Start with my numbers have no hourly limit.
- Run in file order; a scenario whose preconditions name an earlier one assumes it ran.
- Do every screen at 1440px (judges use a computer). Steps and lines written for 375px are phone checks, run only when the owner asks. In a phone run every button, link, input and select is at least 44px tall; nothing overlaps and a long unbroken word wraps.
- A scenario fails if a number differs, the screen errors, a button does nothing, or anything scrolls sideways or overlaps.
- A scenario whose `needs` are missing here is `skipped`, never `pass`.
- `npm run cf:preview` (port 8787) runs the Worker locally. It cannot reach the dev model bridge (the Worker refuses private addresses), so model scenarios are `skipped` there.
- The Codex bridge is not a judge. A bridge timeout or a wrong Ask answer is not an app bug: record it `skipped` with "bridge" in `actual`, and judge Ask only on a real provider key.

## Live Ask check

`qa/ask-live/cases.json` holds 40 questions for Ask, grouped into conversations over three Try it households. `economy-saver/scripts/ask-live-check.mjs` runs them against a running app on its real model and grades what a script can: the kind of reply (answer, clarifying question, decline), required and forbidden words and amounts, key-like text, canvas block types, Japanese, and whether a write waits in To check. A case is PASS, FAIL, or REVIEW when its machine checks hold but a person must judge the wording; the `review` line says what to judge. The latest run is `results-ask.json` (git-ignored, not read by `qa-report.mjs`). Browser-only behaviour (panel, canvas drawing, pinning, thumbs, links) stays in the scenarios above.

It calls the real model, so a run costs the owner about $1-2 and runs only with the owner's OK, never inside `db:test` or `qa:check`. Run it before the submission and after any change to Ask's rules, tools or model, on a fresh app (each run starts new Try it households, and a household has a daily question allowance).

```
cd economy-saver
npm run qa:ask-live -- http://127.0.0.1:3123 --confirm-cost
```

The base URL is required, and without `--confirm-cost` it refuses. Read every REVIEW and FAIL in `results-ask.json`; a FAIL is either an app fault or an expectation in `cases.json` that is wrong, so fix whichever it is.

## Expected numbers on a fresh Try it household

The demo date is Sat Nov 14, 2026; Ben alone; $1 = ¥150.


| Where | Expected |
|---|---|
| Home sentence | "You're fine if Acme and Northwind pay as usual. If they're late, you're ¥18,780 short on the 27th." |
| Fix button | Invoice Beacon $400 |
| Safe to spend | ¥0, "Includes ¥61,000 on Card B not yet billed" |
| Bank balance | ¥67,000 |
| Card A | ¥86,450 owed now · ¥413,550 limit left · Statement ¥58,000 due Nov 26 · Covered ✓ |
| Card B | ¥61,000 owed now · ¥239,000 limit left · So far ¥61,000 due Dec 10 · Covered ✓ |
| To check | 1: Hikari Denki ¥11,220, due Nov 27 |
| Coming up | CloudBox Plus ¥1,980 Nov 18 and Mobaile Tsushin ¥4,800 Nov 20 (every month); Acme +$1,200 Nov 22 (if late Dec 3); Northwind +$800 Nov 25 (if late Nov 29); Card A statement ¥58,000 Nov 26; Rent ¥82,000 Nov 27 (every month, "Short by ¥18,780 if clients pay late") |
| Saving | "The next 30 days leave about ¥92,220 if clients pay as usual. That's what you could put aside." No pots. |
| Options | "Cover ¥18,780 by Nov 27."; first option Invoice Beacon Studio, ¥0 extra cost |
| Clients | Acme $1,200 outstanding; Beacon Studio nothing outstanding; Northwind $800 outstanding |
| Spending → This month → Look at it by | November: Business ¥32,830, Personal ¥119,400, total ¥152,230; the sentence "Business ¥32,830 of ¥152,230 this month". Person is not offered with one person |
| Own categories (Spending → Your categories) | Food: Coffee · 3 items. Other: Books & films · 2 items, Gear · 2 items. None has a default share |
| Own categories in November | Food ¥10,700 = Coffee ¥1,880 + Everything else in Food ¥8,820. Other ¥48,900 = Gear ¥24,600 + Books & films ¥0 (¥7,480 in October) + Everything else in Other ¥24,300. Totals and the sentence do not change |
| Coffee in October | ¥2,800 in October (2 items), ¥1,880 in November (1 item) |

## Reference figures

Scenarios cite these blocks by name. The old check letters stay in the headings so a reader can match them.

### M1. Where the month goes, November (and M2, after Hikari Denki is confirmed)

- Spending → This month, in Table, shows "Where the month goes · November" and the line "Business ¥32,830 of ¥152,230 this month" (a household with no business share this month reads "All personal this month" instead), then these rows in this order (each has a dark › chevron that turns down when the row opens to its items):

| Row | Total | Split | Items |
|---|---|---|---|
| Housing | ¥82,000 | business ¥24,600 · personal ¥57,400 | Rent, Nov 27 |
| Phone & internet | ¥4,800 | business ¥2,400 · personal ¥2,400 | Mobaile Tsushin, Nov 20 |
| Subscriptions | ¥1,980 | just the total (all business) | CloudBox Plus, Nov 18 |
| Food | ¥10,700 | just the total (all personal) | Minato Fresh Market Nov 8 ¥7,420 and Nov 13 ¥1,400; Kissa Midori café Nov 12 ¥1,880 |
| Business tools | ¥3,850 | just the total | Sora Cloud Hosting, Nov 4 |
| Other | ¥48,900 | just the total | Kumo Goods Online Nov 2 ¥24,300; Tsuki Electronics Nov 9 ¥18,200; Yamabiko Outdoor Nov 12 ¥6,400 |


- Confirm Hikari Denki in To check → Spending gains Utilities ¥11,220 (business ¥3,366 · personal ¥7,854) after Housing, and the business line becomes "Business ¥36,196 of ¥163,450 this month". The Home shortfall becomes ¥30,000 and Saving's room line falls from ¥92,220 to ¥81,000 (the bill now counts); the other category rows do not move.

### S-A. The month by whose, with two people

The month by whose (D52). Spending → This month → Where the month goes shows "Together ¥88,780 · Ben ¥63,450 · Wife ¥0 this month" on top; Housing reads ¥82,000 with "Shared ¥82,000" under it, Food ¥10,700 with "Ben ¥10,700" (no "Shared ¥0"); opening a category marks each item Shared, Ben or Wife. Ben alone (Reset) shows no Together line and no whose lines. At 375px the amount stays on the category's row and nothing scrolls sideways.

### T-A. October and September

Spending → This month has "‹ October" (no "›" on the current month). October: heading "Where October went", "‹ September" and "November ›", "Business ¥31,986 of ¥132,060 in October"; Housing ¥82,000, Utilities ¥10,020 (Hikari Denki Oct 25), Phone & internet ¥4,800, Subscriptions ¥1,980, Food ¥11,440 (Kissa Midori Oct 10 ¥1,320, Minato Fresh Market Oct 17 ¥8,640, Kissa Midori Oct 25 ¥1,480), Transport ¥14,340, Other ¥7,480. September totals ¥150,380 (business ¥31,572) with Utilities ¥8,640 and Travel ¥47,000 (Kumokaze Air flight Sep 21 ¥18,400, Hotel Kazemachi Hakone Sep 22 ¥28,600). `?month=2020-01` says "Spending shows the last 12 months, December 2025 to November 2026. Here is November." The current month is unchanged: ¥152,230, business ¥32,830.

### T-B. Search on Spending

Search on Spending (`/spending?q=…`): the field "Search spending: hotel, food, a shop name" and a Search button on one row at 375px; no search results without a query. "hotel" → `"hotel": ¥28,600 in September (1 item); nothing in the other 11 months. ¥28,600 in all.` with the Hakone row; "travel" → `Travel: ¥47,000 in September (2 items); nothing in the other 11 months. ¥47,000 in all.`; "food" → `Food: ¥10,700 in November (3 items), ¥11,440 in October (3 items), ¥5,960 in September (1 item); nothing in the other 9 months. ¥28,100 in all.` with November's three rows first; "rent" → `"rent": ¥82,000 in October (1 item), ¥82,000 in September (1 item), ¥82,000 in August (1 item); nothing in the other 9 months. ¥246,000 in all.` (Nov 27 is after today); "hikari" → ¥10,020 in October and ¥8,640 in September, ¥18,660 in all; "zzz" → "Nothing matches “zzz” in the last 12 months." Nothing scrolls sideways at 375px.

### U-A. Regular costs

Spending → Over time → Regular costs (under the months), before confirming Hikari Denki: "Kissa Midori café down ¥920 so far · Minato Fresh Market up ¥180 so far" on top; rows Kissa Midori café Food ¥1,880 so far (Last month ¥2,800 · down ¥920; Sep ¥0 · Oct ¥2,800 · Nov ¥1,880), Minato Fresh Market ¥8,820 so far (up ¥180), Rent ¥82,000 (same), Mobaile Tsushin ¥4,800, CloudBox Plus ¥1,980, and Hikari Denki Utilities "not in yet" (Last month ¥10,020 · usually on the 25th; Sep ¥8,640 · Oct ¥10,020 · Nov not in yet). Up reads in red, down in green, the words carry it too. At 375px each amount stays on its label's line.

### AA1. Your data, fresh counts

"Your data" says "What the app keeps about you, where it is kept, and how to delete it. A question you ask goes to the household’s AI model." Its seven rows show "In our cloud, Tokyo." and these fresh Try it counts: "Your numbers · 46 items", "What the assistant remembers · 0 things", "Canvases pinned to Home · 0 canvases", "Ask conversations · 0 items", "Reminder history · 0 deliveries", "Push subscriptions · 0 devices", and "Uploaded documents · 0 documents". Your numbers says "Deleted only with everything else." and has no Delete. Export my data, Import and Delete everything follow the rows. A row with nothing in it has no Delete.

### AE. What foreign money costs

A fresh Try it household (today Nov 14). Card A's owed now is ¥86,450.

- Add "Fontly Cloud", amount ¥3,710, dated today, Card A, Paid in another currency USD $24.00 → the charge appears in Recent charges, and Card A's owed now rises by ¥3,710, from ¥86,450 to ¥90,160. Leaving the section empty saves a plain charge as before (nothing is sent for the empty fields).

- Ask (needs a model): "What do my PayPal payouts cost me?" → the reply quotes ¥111,637 as the twelve-month cost (the tool's own words: 16 paid invoices cost ¥111,637 to receive and convert through PayPal: ¥65,913 in fees to receive and ¥45,724 in the conversion rate, out of ¥1,590,000; ¥1,478,363 reached your bank), names no provider other than PayPal and never says to leave PayPal; "Based on" shows Clients. Per client, if asked: Acme Corp ¥52,545, Northwind ¥36,850, Beacon Studio ¥22,242. After adding a foreign-currency charge such as Fontly Cloud, "What did paying in another currency cost me?" → ¥110 above the reference rate on 1 purchase (Fontly Cloud $24.00 billed ¥3,710 against ¥3,600 at ¥150/$). In a fresh household with no USD invoices and no foreign charge, the tool answers that there is nothing to report and the assistant says so without guidance.

- The canvas (needs a model; after the Fontly Cloud charge is added, for the last part): ask "What did foreign payments cost me?" → a table with a row per client and per card and a Total, and a number block; Acme Corp ¥52,545, Northwind ¥36,850, Beacon Studio ¥22,242, total ¥111,637 ("about" before the number when part is estimated); "Pin to Home" saves it and Home draws it with no model call, with the same numbers. After that charge the Card A row shows ¥110 (Fontly Cloud) and the total is unchanged.

## Model settings run

Settings → Your AI model tab. Start with a fresh Try it household. For the browser saves, the owner starts an isolated dev process from `economy-saver/` using its usual app settings. Use a free port and make `APP_URL` match it. This example uses 3124.

```sh
PES_MODEL_SETTINGS_QA=1 NODE_OPTIONS="--require=tsx/cjs --require=./scripts/model-settings-qa.ts" APP_URL=http://127.0.0.1:3124 npm run dev -- -p 3124
```

Use only the exact fictional keys below for saves. The preload simulates Anthropic’s model list and save checks. Use the separate in-tab interception for the cross-provider paste and tested-label checks. Leave the shared app and bridge running; stop only this isolated dev process after the run. Run the first save (paste `sk-ant-fictional-stage34-good`, choose `fictional-questions` for questions and `fictional-documents` for documents) first, then the reload and empty-key save, then the refusals below, and finish with Use this app’s default. Save attempts, including failures and Use this app’s default, share a six-per-minute limit: wait a minute, or use a fresh Try it household and repeat the first save.

After the first save, try Save and check with each exact replacement key below, keeping both model IDs in the form. Read the refusal under Save and check, then reload Settings: the earlier models, result and `…good` key hint are still there. Reload between attempts to clear the unsaved key. A short key (under 20 characters) that saves shows "(hidden)" instead of a last-four hint.

| Fictional key | Save message |
|---|---|
| `sk-ant-fictional-stage34-refused` | The key was refused by Anthropic. |
| `sk-ant-fictional-stage34-missing` | Anthropic has no model called fictional-documents. |
| `sk-ant-fictional-stage34-credit` | Anthropic says the key is over its limit or out of credit. |
| `sk-ant-fictional-stage34-unreachable` | Couldn’t reach Anthropic. |
| `sk-ant-fictional-stage34-noimages` | This document model can't be used: It did not read the total from the bill image. Choose a model that reads images. |

For the provider-prefix, model-list and cross-provider paste scenarios, install the interception below in the browser console on the Settings page before entering the fictional key. It answers the app’s catalogue POST in the tab and keeps it from reaching the server. Reinstall after reloading; reload after the checks to remove it. The fixture supplies a marked entry while the app’s tested list is empty.

```js
const fetchBeforeModelQA = window.fetch;
window.fetch = async (input, init) => {
  if (input !== "/api/settings/ai-model/models" || init?.method !== "POST") {
    return fetchBeforeModelQA.call(window, input, init);
  }
  console.count("Fictional model-list POST");
  await new Promise(resolve => setTimeout(resolve, 800));
  if (window.qaModelListRefused) {
    return new Response("The key was refused by Anthropic.", { status: 502 });
  }
  return Response.json({ models: [
    { id: "fictional-tested", tools: true, images: true, tested: true },
    { id: "fictional-unknown", tested: false },
    { id: "fictional-text", tools: true, images: false, tested: false },
    { id: "fictional-image", tools: false, images: true, tested: false },
  ] });
};
```

## Advancing the Try it date

Start the isolated QA app with `NEXT_PUBLIC_QA_TOOLS=1` and open a fresh Ben Try it household. Use a disposable household because the date only moves forward.

For HTTP scenarios, send a URL-encoded or multipart `POST /api/try/date` with `date=YYYY-MM-DD`, using the session cookie and same-origin headers from `economy-saver/scripts/frontend-check.mjs`. Success returns 200 with `{"today":"YYYY-MM-DD"}`. Reload Home and check Coming up and From your assistant; the suggestion pass runs for the new date in the same transaction. An invalid or non-forward date returns 400, a missing session 401, a cross-origin request or a blank or signed-in household 403, and the route is 404 when the QA setting is off.

Ben starts on Nov 14, 2026. Advancing to `2026-11-15` brings the Nov 18 CloudBox Plus bill into the default three-day suggestion window. Use a fresh Try it and `2026-11-23` for these fixtures:

- On a disposable Nov 23 copy of Ben's household, run the pass. Card A statement due Nov 26 reads "¥58,000, covered even if clients pay late." Review statement opens Card A.
- On that Nov 23 copy, Copy link again on "Send Acme Corp the link again" opens invoice 1042. Its reason says how long it has been since the link was made.

## A scenario

```json
{
  "id": "ASK-004",
  "area": "Ask",
  "action": "Ask whether a purchase fits tonight",
  "user_goal": "I want to know if I can spend ¥4,000 tonight without missing rent",
  "type": "happy",
  "priority": "P1",
  "needs": ["model"],
  "how": "browser",
  "preconditions": ["Fresh Try it household (Ben)", "Ask open at /canvas"],
  "steps": ["Type \"Can I afford ¥4,000 tonight?\"", "Press Enter"],
  "expected": [
    "A progress line names the step while it works",
    "The answer quotes safe to spend (¥0) and says ¥4,000 does not fit before the 27th",
    "\"Based on\" lists the source",
    "Nothing is sent or marked paid"
  ],
  "refs": ["D60"]
}
```

| Field | Values |
|---|---|
| `id` | `<AREA>-<three digits>`, unique across all files |
| `area` | the screen or part of the app |
| `action` | what the person does, a short verb phrase |
| `user_goal` | why they do it, in their words |
| `type` | `happy` (it works as meant), `negative` (wrong input or a refused request), `edge` (limits, empty, long, odd dates or currencies), `security` (another household, sending without a tap, injection, secrets), `agent` (the model's tool choice and wording) |
| `priority` | `P1` the demo loop or money shown wrong; `P2` a main screen or action; `P3` polish |
| `needs` | what must exist before it can run: `none`, `model` (a working AI model: the server's or the dev model bridge), `deploy` (the Worker on Cloudflare), `paypal_webhook` (a registered sandbox webhook), `email` (the magic link or Email Routing), `microphone`, `owner` (the owner's account or keys). A scenario whose needs are missing here is recorded `skipped`, never `pass` |
| `how` | `browser` (the browser pane, at 1440px; 375px only in a phone run the owner asks for), `http` (a request against the dev server, like `scripts/frontend-check.mjs`), `suite` (an existing `npm run db:*` suite already proves it: `refs` names the suite), `eval` (`npm run model:eval`) |
| `preconditions`, `steps`, `expected` | short sentences; every `expected` line is something you can see or measure |
| `refs` | decisions (D…), the reference figures above, suites (`db:…-test`) |

## A result

```json
{
  "run_at": "2026-11-07T10:00:00+09:00",
  "app_url": "http://127.0.0.1:3123",
  "model": "codex-bridge",
  "results": [
    {
      "id": "ASK-004",
      "status": "fail",
      "width": "1440",
      "actual": "The answer said ¥4,000 fits; safe to spend on Home is ¥0",
      "evidence": "screenshot or the response text, short",
      "ran_at": "2026-11-07T10:12:00+09:00"
    }
  ]
}
```

`status` is `pass`, `fail` (it ran and an `expected` line is wrong: `actual` says which), `skipped` (not run here: a need this machine lacks, such as the owner's keys or accounts, a sign-in, the deploy, email, a microphone or a PDF on the dev model bridge, or a rule forbids it, such as `/api/cron`; `actual` says which) or `blocked` (it should have run here but something in the app stopped it first, such as an earlier step failing; `actual` says what). `width` is `375`, `1024`, `1280`, `1440`, `both` or `n/a` (`1024` checks the Ask panel as an overlay, `1280` the docked panel).

## Running the suite and HTTP scenarios (prompt for the testing agent)

> Read `AGENTS.md`, then `qa/README.md` ("How to run", "Expected numbers"). Run every scenario in `qa/scenarios/*.json` whose `how` is `suite` or `http` against the dev server at http://127.0.0.1:3123 (always 127.0.0.1, not localhost). Don't start, stop or restart the servers. For `suite`, run each named suite once from `economy-saver/` (`npm run db:test` runs every `db:*` suite; `npm run mcp:demo`; `node scripts/frontend-check.mjs --run|--extra|--guards http://127.0.0.1:3123`, with `--run` last) and record every scenario it covers; when a suite fails, mark only the scenarios its failing assertion concerns. For `http`, make the requests with node `fetch` or curl from scratch scripts under /private/tmp (never in the repo), getting a household cookie and same-origin headers the way `scripts/frontend-check.mjs` does. Record one entry per scenario in `qa/results-scripted.json` as you go (`width` `n/a`), with a concrete `actual` and short `evidence` for anything not `pass`. A scenario whose `needs` includes `owner`, `deploy`, `email` or `paypal_webhook` is `skipped` unless it truly can run here, with the reason in `actual`. Do not fix anything or edit any other file. Never read or print `.env.local` or `.dev.vars`, never call `/api/cron`, never deploy or log in. When done, run `node economy-saver/scripts/qa-report.mjs` and give me its summary.

## Running the browser scenarios (prompt for the testing agent)

> Read `AGENTS.md`, then `qa/README.md` ("How to run", "Expected numbers"). You are the testing agent. Drive any browser you can control, with its window 1440px wide. Run every scenario whose `how` is `browser`, in this order of files: `qa/scenarios/home-money.json`, `start-account.json`, `documents-safety.json`, `ask-agent.json` (about 400). Only the areas I name, if I name some.
>
> **Setup.** The app runs at http://127.0.0.1:3123 (always 127.0.0.1, not localhost) and its AI model is the dev model bridge on 127.0.0.1:3130; don't start, stop or restart either. Use one browser window with one tab for the app. Start from Ben's Try it household: open http://127.0.0.1:3123 and click Try it (opening /api/try directly is refused). When a scenario needs a fresh household again, use Reset in the top banner beside Sample household → Reset, or a new Try it. Follow each scenario's preconditions; when one names an earlier scenario, run them in order.
>
> **Width.** Run at 1440px (device toolbar off): judges use a computer. Skip steps and expected lines that apply only at 375px unless I ask for a phone run. Record `width` as `1440` (or `375` in a phone run).
>
> **Judging.** A scenario passes only if every `expected` line is true. It fails if any expected line is wrong, a number differs from "Expected numbers" in qa/README.md, a button does nothing, the page shows an error, or anything scrolls sideways or overlaps. A scenario whose `needs` includes `owner`, `deploy`, `email`, `paypal_webhook` or `microphone` is `skipped` unless it truly can run here; say what is missing. A model scenario that needs a PDF read is `skipped` (the bridge refuses PDFs); use an image instead where the scenario allows it. Use `blocked` only when the app itself stopped a scenario that should have run. Scenarios that need a model use the app's Ask, which can take 10–20 s an answer: wait for it.
>
> **Recording.** Write one entry per scenario to `qa/results-browser.json` in the README's result format (`"model": "codex-bridge"`), adding entries every few scenarios so nothing is lost. For every non-pass, `actual` says exactly what you saw (the real text or number on screen) and `evidence` names the screenshot. Save a screenshot of each fail as `qa/evidence/<id>.png`. Record the screen while you run each area: start `screencapture -v -C -k qa/evidence/<area>.mov` in the background before the area's first scenario and stop it (Ctrl+C or kill the process) after its last; if screen recording isn't possible, say so once in your summary and carry on with screenshots.
>
> **Rules.** Do not fix anything or edit any file other than `qa/results-browser.json` and `qa/evidence/`. Approve may make a payment link and a PayPal sandbox order; that is allowed. Pay a link only with a PayPal sandbox buyer account the owner gives you. Never type real personal data; use the scenario's fictional names and amounts. Never read or print `.env.local` or `.dev.vars`, never call `/api/cron`, never deploy, never sign in to a real account, and don't touch other browser tabs. When done, run `node economy-saver/scripts/qa-report.mjs` and give me its summary and one line per fail.

## Fixing the failures (prompt for the fixing agent)

> Read `AGENTS.md`, then `qa/README.md`. Run `node economy-saver/scripts/qa-report.mjs --failures`. For each `fail`, find the cause in the code and fix it the way `AGENTS.md` and `DECISIONS.md` say the app works; if the scenario's `expected` is what is wrong, say so and change the scenario instead of the code. Leave `skipped` entries alone; look at `blocked` ones, since the app stopped them. After each fix, run the scenario again and update its entry in its results file; before finishing, `tsc`, `lint` and `db:test` pass. Do not commit.
