# QA scenarios

What a person does in Personal Economy Saver, what they expect, and whether it works today. One scenario is one user action with one expected outcome, so a failure points to one behaviour. Codex runs them (two runs, one with scripts and one in Chrome with computer use), writes the results files, and a second Codex run fixes the failures.

- `scenarios/*.json` — the checklist, one file per area. Each file is a JSON array of scenarios.
- `results-scripted.json` (the `suite` and `http` scenarios) and `results-browser.json` (the `browser` scenarios) — the latest run, one entry per scenario run. A full run overwrites its file; a partial run updates only the entries it ran.
- `evidence/` (git-ignored) — a screenshot for each browser fail (`<id>.png`) and a screen recording per area (`<area>.mov`).
- `node economy-saver/scripts/qa-report.mjs` — checks the scenario files, merges the results files, then prints the counts and the failures. `--failures` prints the failing and blocked entries as JSON (what the fixing run reads). `--check` only checks the scenario files.

The expected numbers for a fresh Try it household are in [BROWSER-CHECKS.md](../BROWSER-CHECKS.md) ("Expected numbers"); scenarios cite them by section instead of copying them.

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
  "refs": ["BROWSER-CHECKS K", "D60"]
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
| `needs` | what must exist before it can run: `none`, `model` (a working AI model: the server's or the Codex bridge), `deploy` (the Worker on Cloudflare), `paypal_webhook` (a registered sandbox webhook), `email` (the magic link or Email Routing), `microphone`, `owner` (the owner's account or keys). A scenario whose needs are missing here is recorded `skipped`, never `pass` |
| `how` | `browser` (the browser pane, at 1440px; 375px only in a phone run the owner asks for), `http` (a request against the dev server, like `scripts/frontend-check.mjs`), `suite` (an existing `npm run db:*` suite already proves it: `refs` names the suite), `eval` (`npm run model:eval`) |
| `preconditions`, `steps`, `expected` | short sentences; every `expected` line is something you can see or measure |
| `refs` | BROWSER-CHECKS sections, decisions (D…), suites (`db:…-test`) |

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

`status` is `pass`, `fail` (it ran and an `expected` line is wrong: `actual` says which), `skipped` (not run here: a need this machine lacks, such as the owner's keys or accounts, a sign-in, the deploy, email, a microphone or a PDF on the Codex bridge, or a rule forbids it, such as `/api/cron`; `actual` says which) or `blocked` (it should have run here but something in the app stopped it first, such as an earlier step failing; `actual` says what). `width` is `375`, `1440`, `both` or `n/a`.

## Before a run

- The app on http://127.0.0.1:3123 (`npm run dev -- -p 3123` in `economy-saver/`) and, for scenarios that need a model, the Codex bridge on http://127.0.0.1:3130 (`npm run codex:bridge`). The bridge reads images but refuses PDFs.
- Try it and Start with my numbers have no hourly limit, so both runs can make as many households as they need.
- `npm run cf:preview` (the `worker-preview` launch entry, port 8787) runs the Worker locally for the scenarios that read its request log. It cannot reach the Codex bridge (the Worker refuses private addresses), so scenarios that need a model are `skipped` there, not failed.

## Advancing the Try it date

Start the isolated QA app with `NEXT_PUBLIC_QA_TOOLS=1` and open a fresh Ben Try it household. Use a disposable household because the date only moves forward. The QA route is available for a same-origin Try it session while the setting is enabled.

For HTTP scenarios, send a URL-encoded or multipart `POST /api/try/date` with `date=YYYY-MM-DD`. Use the session cookie and same-origin request headers from the Try it setup in `economy-saver/scripts/frontend-check.mjs`. Keep the cookie in the test process. Success returns HTTP 200 with `{"today":"YYYY-MM-DD"}`. Reload Home and check Coming up and From your assistant. The suggestion pass runs for the new date in the same transaction and uses the household’s stored exchange rate.

Ben starts on Nov 14, 2026. Advancing to `2026-11-15` brings the Nov 18 CloudBox Plus bill into the default three-day suggestion window. Use a fresh Try it and `2026-11-23` for the Card A statement and the late Acme invoice fixtures in BROWSER-CHECKS AG6–AG7. Use the normal sandbox and form actions when a scenario needs a paid invoice. For the guarded route, an invalid or non-forward date returns 400. A missing session returns 401. Cross-origin requests and sessions for blank or signed-in households return 403. The route returns 404 when the QA setting is off.

## Running the suite and HTTP scenarios (prompt for Codex)

> Read `AGENTS.md`, then `qa/README.md` and `BROWSER-CHECKS.md` ("How to run", "Expected numbers"). Run every scenario in `qa/scenarios/*.json` whose `how` is `suite` or `http` against the dev server at http://127.0.0.1:3123 (always 127.0.0.1, not localhost). Don't start, stop or restart the servers. For `suite`, run each named suite once from `economy-saver/` (`npm run db:test` runs every `db:*` suite; `npm run mcp:demo`; `node scripts/frontend-check.mjs --run|--extra|--guards http://127.0.0.1:3123`, with `--run` last) and record every scenario it covers; when a suite fails, mark only the scenarios its failing assertion concerns. For `http`, make the requests with node `fetch` or curl from scratch scripts under /private/tmp (never in the repo), getting a household cookie and same-origin headers the way `scripts/frontend-check.mjs` does. Record one entry per scenario in `qa/results-scripted.json` as you go (`width` `n/a`), with a concrete `actual` and short `evidence` for anything not `pass`. A scenario whose `needs` includes `owner`, `deploy`, `email` or `paypal_webhook` is `skipped` unless it truly can run here, with the reason in `actual`. Do not fix anything or edit any other file. Never read or print `.env.local` or `.dev.vars`, never call `/api/cron`, never deploy or log in. When done, run `node economy-saver/scripts/qa-report.mjs` and give me its summary.

## Running the browser scenarios in Chrome (prompt for Codex, with computer use)

> Read `AGENTS.md`, then `qa/README.md` and `BROWSER-CHECKS.md` ("How to run", "Expected numbers"). You are testing the app in Google Chrome with computer use. Run every scenario whose `how` is `browser`, in this order of files: `qa/scenarios/home-money.json`, `start-account.json`, `documents-safety.json`, `ask-agent.json` (about 400). Only the areas I name, if I name some.
>
> **Setup.** The app runs at http://127.0.0.1:3123 (always 127.0.0.1, not localhost) and its AI model is the Codex bridge on 127.0.0.1:3130; don't start, stop or restart either. Use one Chrome window with one tab for the app. Start from Ben's Try it household: open http://127.0.0.1:3123 and click Try it (opening /api/try directly is refused). When a scenario needs a fresh household again, use Settings → Account → Reset to Ben's starting numbers → Reset, or a new Try it. Follow each scenario's preconditions; when one names an earlier scenario, run them in order.
>
> **Width.** Run at 1440px (device toolbar off, window maximised): judges use a computer. Skip steps and expected lines that apply only at 375px unless I ask for a phone run. Record `width` as `1440` (or `375` in a phone run).
>
> **Judging.** A scenario passes only if every `expected` line is true. It fails if any expected line is wrong, a number differs from BROWSER-CHECKS "Expected numbers", a button does nothing, the page shows an error, or anything scrolls sideways or overlaps. A scenario whose `needs` includes `owner`, `deploy`, `email`, `paypal_webhook` or `microphone` is `skipped` unless it truly can run here; say what is missing. A model scenario that needs a PDF read is `skipped` (the bridge refuses PDFs); use an image instead where the scenario allows it. Use `blocked` only when the app itself stopped a scenario that should have run. Scenarios that need a model use the app's Ask, which can take 10–20 s an answer: wait for it.
>
> **Recording.** Write one entry per scenario to `qa/results-browser.json` in the README's result format (`"model": "codex-bridge"`), adding entries every few scenarios so nothing is lost. For every non-pass, `actual` says exactly what you saw (the real text or number on screen) and `evidence` names the screenshot. Save a screenshot of each fail as `qa/evidence/<id>.png`. Record the screen while you run each area: start `screencapture -v -C -k qa/evidence/<area>.mov` in the background before the area's first scenario and stop it (Ctrl+C or kill the process) after its last; if screen recording isn't permitted, say so once in your summary and carry on with screenshots.
>
> **Rules.** Do not fix anything or edit any file other than `qa/results-browser.json` and `qa/evidence/`. Approve may send a PayPal sandbox invoice to the sandbox client; that is allowed. Never type real personal data; use the scenario's fictional names and amounts. Never read or print `.env.local` or `.dev.vars`, never call `/api/cron`, never deploy, never sign in to a real account, and don't touch other Chrome tabs. When done, run `node economy-saver/scripts/qa-report.mjs` and give me its summary and one line per fail.

## Fixing the failures (prompt for Codex)

> Read `AGENTS.md`, then `qa/README.md`. Run `node economy-saver/scripts/qa-report.mjs --failures`. For each `fail`, find the cause in the code and fix it the way `AGENTS.md`, `DECISIONS.md` and `PLAN.md` say the app works; if the scenario's `expected` is what is wrong, say so and change the scenario instead of the code. Leave `skipped` entries alone; look at `blocked` ones, since the app stopped them. After each fix, run the scenario again and update its entry in its results file; before finishing, `tsc`, `lint` and `db:test` pass. Do not commit.
