# Plan

Open work and the owner's gates, nothing else. A line goes the moment it is done. Why things are as they are: [DECISIONS.md](DECISIONS.md).

## Owner gates

Only Ben can do these. Agents carry on with anything that doesn't wait on them.

- Supabase Authentication → Redirect URLs: list the deployed URL's sign-in callback, then sign in once and verify a real magic link, onboarding and session refresh (V9).
- On the live site, paste a real AI key, ask one question, then remove the key: the first live model call on a household's own model (D33, D56).
- `EVAL_API_KEY` in `.env.local` for each provider the model eval runs on (O6).
- Settings still unset: the forwarding domain and its two keys, then Email Routing on the domain with delivery checked through the live Worker; reminders by email (the sender address and API key) and by push (`npm run push:keys`, the push subject).
- Voice with a microphone in his own Chrome or Safari, in English and Japanese (D26).
- Supabase's Security Advisor; an uptime monitor and Worker error alerting; a manual encrypted database dump before demo day.
- Say when the contract migration may run: it drops the unused AI-cap columns and table, the old nudge column (D66) and the columns PayPal invoices, reminders and the import left behind, and it lets the same PayPal payment be recorded once per household rather than once overall, so a PayPal account that moves to another household keeps its history; it runs only once no running Worker reads the old shape.
- Say when to give every invoice sent before payment links existed its link: a one-off run on the shared database (D12).
- Add the denied-payment event to fipa's PayPal webhook subscription, in his PayPal dashboard or by telling an agent to run the registration (D15).
- Decide what a refund or a reversed payment does; nothing in fipa reacts to one today (D15).
- Decide whether a payment whose payer address fipa cannot keep should still be recorded; it is skipped today and the balance stays right (D37).
- Answer O2, O5 and O10 in DECISIONS.md.
- Set the two new partner settings and the new PayPal app's keys and webhook id on the Worker (D13, D76).
- Sandbox sign-ins: the seller account to connect, and the US Personal client to pay a test link (D17).
- Devpost: tick the Terms box and press Submit project before it closes, Nov 13 05:00 Tokyo (D1).
- Approve the canvas concept; then it is saved under `design/`.

## Open work

- Zod 4. The 7 high audit findings that remain need the upgrade; expect type errors at every schema boundary.
- Owner gate (D12, D76), not on the judges' path, done after the Try it payment test: connect a sandbox seller account by signing in on PayPal's page ("Already have an account? Sign in") with an existing sandbox business account that is not fipa's own, never creating one there because accounts created on that page are not saved, and pay a $1 test link as the sandbox client, to confirm PayPal delivers the client-paid webhook for a connected account's orders; with Ben's sandbox accounts, also what PayPal's events carry for a seller's order, what a declined payment looks like, and how long an approved order can still be taken.
- The live PayPal round trip from the Worker (V1): a payment link made, paid as the sandbox client, the verified webhook received and the sentence flipped.
- Run the model eval on at least two real providers and add the passing pairs to the tested list (D56, O6). Waits on `EVAL_API_KEY`.
- Live checks that wait on a real model, sign-in or deploy: answers, canvases and memory on a real model; document reading, including a bill's month; member sign-in, invite, permissions and leave (D68); MCP token issue, use and revoke; the family link copy with a real clipboard (D52); the full scripted and browser run on the deployed Worker.
- Browser check at 1440 of the judges' path after the latest Ask changes: Try it, Home, the Ask panel, a canvas drawn, Pin to Home, Approve, Pay as the client.
- The daily-allowance line under Ask and Upload, and the limit message, seen in the app on fipa's model (D33).
- Speed targets: Try it to Home within 1.5 s (the deployed median was 2.45 s), an answer within 8 s on a real model, a To check row within 30 s of an upload, "Sent" in Activity within 2 s. Use the request log on the deployed Worker to separate connection setup from SQL before changing anything.
- V4: replace the placeholder US cash-advance terms in Options with verified references (D7).
- The contract migration, after the owner's word (above).
- Before real users: a production Supabase project separate from development, a secret-rotation procedure and Pro-plan backups (D38).

## Later

Each with its evidence in [research/users/money-chores-worldwide.md](research/users/money-chores-worldwide.md): held PayPal money shown as expected on a date, never as cash; each client's pay run, so a reminder lands before it; one warning the day before a known debit when the forecast is short; the dispute clock; a recurring remittance with its fee; the agent proposing categories for unknown names; per-country calendars as content tables, never code. Also: income other than invoices (D28), the catalogue as an agent tool once households have a profile (D6), moving money between pots, an agent-led start (D47).
