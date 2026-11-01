# Personal Economy Saver: plan

**Submit the evening of Nov 12, Tokyo** (closes Nov 13 05:00 Tokyo). That is the only date. Decisions: [DECISIONS.md](DECISIONS.md).

## What we are building

A daily money assistant for freelancers paid across borders, built on PayPal. It reads what arrives in the inbox (bills, card charges, receipts, client payments), shows where you stand today and over the next 30 days, reminds you what's due and whether it's covered, and gets your money in through PayPal when you approve.

It answers three questions with the user's real numbers:
1. **Where am I?** Cash, card spend and statements, bills, what's coming in.
2. **Can I proceed, or should I hold off?**
3. **If I use credit, how do I pay it back** from what's coming in?

## The daily loop

| Something happens | The app shows | The app can do |
|---|---|---|
| A bill arrives (email or photo) | What it is, when it's due, where it lands on the runway | Confirm it |
| A card charge arrives (at home or travelling) | Running total on that card, statement date, due date, covered or not | Remind before the due date |
| A client pays into PayPal | Balance updated, what's now covered, the tax share to set aside | Set it aside |
| A card statement arrives | The real total, the due date, pay in full from where | Remind; invoice first if short |
| The runway shows a shortfall | The cheapest way to cover it | Draft the invoice or reminder; you approve; PayPal sends; webhook confirms |
| A date is near | Only dates tied to his money | One action |

## What must exist by Nov 12, in order (agreed Nov 1)

| # | Item | State |
|---|---|---|
| 0 | **Backend foundation** (D31–D33): Supabase schema and seed through Drizzle, the deploy spike of health and webhook on Cloudflare Workers, Email Routing, BYOK settings | Not started; the screen rebuild sits on these tables, so it comes first |
| 1 | **The one-sentence screen** (D25): mockup first, then rebuilt on the existing maths | Mockup published: https://claude.ai/artifact/D34WYjT1ELFgoVShxsn5va (file `design/one-screen.html`, phone and desktop views, screenshots beside it). Phone view approved by the owner; both views approved by the owner Nov 1; rebuild waits on item 0 |
| 2 | **The PayPal loop running for real on Cloudflare:** nudge a late client or invoice finished work → approve → PayPal sends → client pays in the sandbox → verified webhook → the sentence changes | Smoke test 7/7 locally. Needs item 0, then the owner's OK for the public repo and the deploy |
| 3 | **The reader:** forwarded bill, card-use email, receipt photo, each with a confirmation row showing the source next to what was read | Sample files in `economy-saver/samples/bills/`; not started |
| 4 | **Voice** (D26): ask and log by speaking; typed fallback | Not started |
| 5 | **MCP server** (D27) with a token, demoed from a terminal | Not started |
| 6 | **Options when short** ranked by cost, including verified low-rate borrowing (D7, V5) | Ladder exists (nudge, invoice, cash advance, discount); borrowing types and rates to add |
| 7 | **Household in the data model** (D28); one person shown | Not started |
| 8 | **Video and submission:** first version on Devpost by Nov 5 for the early check; final Nov 12. 2:40–2:55 screen recording with voiceover, one named person in the first 15 seconds, the real sandbox invoice page on screen | Script and text drafted in `submission/`; both to be rewritten for the new screen |

Anything after item 5 is cut first if days run out.

## What exists now

- The screen on sample data, in five tabs (D25): Today (safe to spend with Go / Go easy / Hold off, "Can I afford…?" for cash and card, needs you, next 7 days), Plan (runway, timeline with balances, who pays when, ways to cover a gap), Cards (statements, covered or not, pays back from, abroad filter, Taipei trip), Get paid (owed, drafts, sent, paid, days to pay), Activity (to check, all activity). Bill → invoice → approve → paid flow, Ben ↔ Maya switch, demo reset, phone layout with a bottom tab bar.
- PayPal plumbing: sandbox guard, token and REST client, toolkit split (agent drafts, server sends), verified webhook route, smoke test.
- Catalogue engine with Japan (20 moves) and US (16 moves), both checked on primary pages Nov 1; now secondary.
- Sample bills, a card-statement email, a 国保 slip and Maya's US bill.
- Devpost text and video script drafts.

## Running now

| Work | Owner | Files |
|---|---|---|
| Nothing | | |

## Owner's tasks

- Join the hackathon on Devpost (not confirmed yet). First submission by Nov 5 for the early check.
- Anthropic API key into `.env.local`; a Supabase project (URL, anon key and service key into `.env.local`); `wrangler login` on this machine; Email Routing on the domain when asked; `git config user.name / user.email`.
- Answer the open questions in DECISIONS.md (O1, O2, O5, O8).
- When asked: OK for the public GitHub repo and the Cloudflare deploy; record the video; submit.

## Rules we keep

Sandbox only. Claude never creates accounts or handles credentials. Commits only when asked. Public repo and deploy only with the owner's OK. Fictional companies; no trademarks or copyrighted music in the video; no real bills or personal data. Suggestions are information with the user's numbers, never a named product to buy; anything paid is labelled.
