# QA scenarios

What a person does in Personal Economy Saver, what they expect, and whether it works today. One scenario is one user action with one expected outcome, so a failure points to one behaviour. An agent runs them all, writes `results.json`, and a second agent fixes the failures.

- `scenarios/*.json` — the checklist, one file per area. Each file is a JSON array of scenarios.
- `results.json` — the latest run: one entry per scenario run. It is overwritten by each full run; a partial run updates only the entries it ran.
- `node economy-saver/scripts/qa-report.mjs` — checks the scenario files, then prints the counts and the failures. `--failures` prints the failing and blocked entries as JSON (what the fixing agent reads). `--check` only checks the scenario files.

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
| `needs` | what must exist before it can run: `none`, `model` (a working AI model: the server's or the Codex bridge), `deploy` (the Worker on Cloudflare), `paypal_webhook` (a registered sandbox webhook), `email` (the magic link or Email Routing), `microphone`, `owner` (the owner's account or keys). A scenario whose needs are missing is recorded `blocked`, never `pass` |
| `how` | `browser` (the browser pane, at 375px and 1440px), `http` (a request against the dev server, like `scripts/frontend-check.mjs`), `suite` (an existing `npm run db:*` suite already proves it: `refs` names the suite), `eval` (`npm run model:eval`) |
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
      "width": "375",
      "actual": "The answer said ¥4,000 fits; safe to spend on Home is ¥0",
      "evidence": "screenshot or the response text, short",
      "ran_at": "2026-11-07T10:12:00+09:00"
    }
  ]
}
```

`status` is `pass`, `fail` (it ran and an `expected` line is wrong: `actual` says which), `blocked` (a need is missing, or something earlier broke it: `actual` says what) or `skipped` (not run this time, with the reason). `width` is `375`, `1440`, `both` or `n/a`.

## Running the scenarios (prompt for the testing agent)

> Read `AGENTS.md`, then `qa/README.md`. Run every scenario in `qa/scenarios/` (or only the areas I name) against the dev server at http://127.0.0.1:3123, started with `preview_start` (`economy-saver`, and `codex-bridge` for scenarios that need a model). Start each area from a fresh Try it household. Follow each scenario's steps; for `browser` scenarios use the browser pane at 375px and 1440px; for `suite` scenarios run the named suite once and record every scenario it covers. Record one entry per scenario in `qa/results.json` as you go, with `actual` and short `evidence` for anything not `pass`. Do not fix anything. Never send real data, never call `/api/cron`, never deploy or log in. When done, run `node economy-saver/scripts/qa-report.mjs` and give me its summary.

## Fixing the failures (prompt for the fixing agent)

> Read `AGENTS.md`, then `qa/README.md`. Run `node economy-saver/scripts/qa-report.mjs --failures`. For each `fail`, find the cause in the code and fix it the way `AGENTS.md`, `DECISIONS.md` and `PLAN.md` say the app works; if the scenario's `expected` is what is wrong, say so and change the scenario instead of the code. Leave `blocked` entries alone unless the block is in our code. After each fix, run the scenario again and update its entry in `qa/results.json`; before finishing, `tsc`, `lint` and `db:test` pass. Do not commit.
