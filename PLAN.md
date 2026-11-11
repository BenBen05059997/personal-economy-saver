# Plan

Open work and the owner's gates, nothing else. A line goes the moment it is done. Why things are as they are: [DECISIONS.md](DECISIONS.md).

## Owner gates

Only Ben can do these. Agents carry on with anything that doesn't wait on them.

- Supabase Authentication → Redirect URLs: list the deployed URL's sign-in callback, then sign in once and verify a real magic link, onboarding and session refresh (V9).
- On the live site, paste a real AI key, ask one question, then remove the key: the first live model call on a household's own model (D33, D56).
- `EVAL_API_KEY` in `.env.local` for each provider the model eval runs on (O6).
- Settings still unset: the forwarding domain and its two keys, then Email Routing on the domain with delivery checked through the live Worker; reminders by email (the sender address and API key) and by push (`npm run push:keys`, the push subject); the household for the live PayPal history import; optionally a server default AI connection for development.
- Voice with a microphone in his own Chrome or Safari, in English and Japanese (D26).
- Supabase's Security Advisor; an uptime monitor and Worker error alerting; a manual encrypted database dump before demo day.
- Say when the contract migration may run: it drops the unused AI-cap columns and table and the old nudge column (D66).
- Answer O2, O5, O10 and O11 in DECISIONS.md.
- Devpost: join the hackathon; the early eligibility check (D30); the OK to make the repo public; the final video on a Try it household on the deployed URL; submit by the evening of Nov 12, Tokyo (D1).
- Approve the canvas concept; then it is saved under `design/`.

## Open work

- Zod 4. The PayPal toolkit pins zod 3, and the 7 high audit findings that remain need the upgrade; expect type errors at every schema boundary.
- The live PayPal round trip from the Worker (V1): a sandbox invoice sent, paid, the verified webhook received and the sentence flipped.
- Run the model eval on at least two real providers and add the passing pairs to the tested list (D56, O6). Waits on `EVAL_API_KEY`.
- Live checks that wait on a real model, sign-in or deploy: answers, canvases and memory on a real model; document reading, including a bill's month; member sign-in, invite, permissions and leave (D68); MCP token issue, use and revoke; the family link copy with a real clipboard (D52); the full scripted and browser run on the deployed Worker.
- Speed targets: Try it to Home within 1.5 s (the deployed median was 2.45 s), an answer within 8 s on a real model, a To check row within 30 s of an upload, "Sent" in Activity within 2 s. Use the request log on the deployed Worker to separate connection setup from SQL before changing anything.
- V4: replace the placeholder US cash-advance terms in Options with verified references (D7).
- The contract migration, after the owner's word (above).
- Before real users: a production Supabase project separate from development, a secret-rotation procedure and Pro-plan backups (D38).

## Later

Each with its evidence in [research/users/money-chores-worldwide.md](research/users/money-chores-worldwide.md): held PayPal money shown as expected on a date, never as cash; each client's pay run, so a reminder lands before it; one warning the day before a known debit when the forecast is short; the dispute clock; a recurring remittance with its fee; the agent proposing categories for unknown names; per-country calendars as content tables, never code. Also: income other than invoices (D28), the catalogue as an agent tool once households have a profile (D6), moving money between pots, an agent-led start (D47).
