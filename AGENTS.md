# Agent instructions

Start with [HANDOFF.md](HANDOFF.md): the product, the hard rules, the codebase map and current state. Then work from the checklist in [PLAN.md](PLAN.md).

The rules that matter most, in short: PayPal sandbox only; never print or commit secret values; never create accounts, log in or deploy; commit only when the owner asks; every database query scoped by `household_id`; no fallbacks (one database, one way to do each thing, a clear error when a setting is missing); fictional data only; update `PLAN.md` and `DECISIONS.md` in place, with no backup copies or changelogs; never touch `reference/`.

The app lives in `economy-saver/` and uses Next.js 16: read `economy-saver/AGENTS.md` before writing Next.js code.
