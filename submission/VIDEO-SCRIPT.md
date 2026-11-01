# Video script: Personal Economy Saver (draft)

Draft written Nov 1, 2026. Record Nov 10 on the deployed URL (PLAN.md). Total runtime 2:50, under the 2:55 target. Rules: under 3 minutes, YouTube, English, no third-party trademarks, no music. Voice-over is about 340 words, so each shot has a little room for the screen to breathe.

Style: calm, plain, one fact per sentence. Say the number, then the reason. Say "sample" where the figure is a sample.

## Shot list

| Time | On screen | Voice-over | Caption |
|---|---|---|---|
| 0:00-0:09 | Title card for 2 seconds, then the app's home screen with the runway chart. Healthy and green. | "Most people don't lose money by being careless. They lose it by not knowing, at the moment it matters." | Personal Economy Saver. PayPal sandbox. Fictional data. |
| 0:09-0:20 | Inbox log: a bill forwarded to the app's address. The "here is what I understood" card opens: Hikari Denki, ¥11,220, due Nov 27, 12% more than last month. Ben taps Confirm. | "Ben is a designer in Tokyo. His clients pay in dollars. A bill just arrived, in Japanese. The app reads it, and Ben checks it before anything counts." | Bill forwarded by email. Nothing counts until you confirm. |
| 0:20-0:31 | Runway chart: expected line and worst-case line. The status turns red: "¥30,000 short on Nov 27". Cursor rests on the dip. Balance header shows the PayPal balance. | "Now he can see the month. In the worst case, Ben is thirty thousand yen short on November 27." | Worst case: ¥30,000 short on Nov 27. Sample data. |
| 0:31-0:47 | The "Ways to cover it, costed in yen" list: invoice Beacon, ¥0 extra; remind Acme and Northwind, may be too late; card cash advance, about ¥250; 2% early discount, ¥3,600. The first row is highlighted. | "Next, the ways out, priced in yen. Invoice finished work: nothing. Remind slow clients: nothing, but maybe too late. A cash advance: about two hundred fifty yen. A discount for paying early: thirty-six hundred. The free one wins." | Costs for the exact days needed. Not the APR. |
| 0:47-0:55 | The bill moment card for the home share of electricity. Zoom on the "Known by: tax accountants" tag and the "sample" flag. | "On the same bill, a rule his accountant would know. The home share of his electricity is an expense. The card says who already knows it." | Known by: tax accountants. |
| 0:55-1:10 | The approval card: To Beacon Studio, $400, due on receipt, note. Label "Draft in PayPal". Hover over "drafted by create_invoice, sends with send_invoice". Ben taps Approve and send. Toast: sent. | "The agent drafts the invoice in PayPal. It can only draft. Ben reads it and taps Approve. Only then does PayPal send it." | The agent drafts. You send. |
| 1:10-1:30 | Split screen. Left: the sandbox client (US personal account) opens the PayPal invoice and pays. Right: the activity log shows "Webhook verified: INVOICING.INVOICE.PAID". The invoice flips to Paid. The red gap closes: "Nov 27 is covered." | "Now the client pays, in the PayPal sandbox. PayPal calls the app back. The app checks PayPal's signature before it believes anything. The invoice turns paid, and the red gap closes." | Verified webhook. Sandbox only. |
| 1:30-1:52 | The client-paid moment card: tax pot pinned first (about ¥15,500 of the ¥60,000 payout, "protected, not counted"). Then the payout cost: about ¥4,230, ¥55,770 reaches the bank at ¥150 per dollar. Then "price the fee into the next invoice". Hover on "Not now" and "Never for this". | "That payment is the next moment. First, the tax pot: about a quarter of this payout is already owed. Then what the payout cost in PayPal fees, and how to price it into the next invoice. Ben can say not now, or never." | Tax pot first. Sample rate ¥150 per $. |
| 1:52-2:16 | The deadline strip, then the consumption-tax election card: "Election form due Dec 31", "Known by: tax accountants", two-year lock-in line, about ¥90,900 per ¥1M of Japanese spending. Tap "Why": the official tax agency page opens in the source list with its date. | "A date is close. If Ben elects to be a consumption-tax payer by December 31, he can claim back the ten percent he pays on Japanese expenses. About ninety thousand yen on each million yen of spending, on sample numbers. One tap shows the official source. The app files nothing." | Form due Dec 31. Two-year lock-in. Source behind a tap. |
| 2:16-2:34 | Tap the persona switch to Maya. The screen reloads with dollars. Client-paid card for Harbor & Co, $1,800: tax set-aside pinned first ($450 to move), then a US move with a US date and source. | "Same engine, different catalogue. Maya is an illustrator in Austin. A client paid her. Her tax pot comes first, then the moves that fit her, with US dates and sources." | Same engine. US catalogue. |
| 2:34-2:50 | The "Found for you" panel, then the home screen. End card with the project name, the repo link and the live URL. | "Every PayPal action runs through the Agent Toolkit, in the sandbox only. Next: bills from photos, and catalogues for more countries. Personal Economy Saver. The right move, when it matters." | Built with the PayPal Agent Toolkit and Claude. Repo and live URL below. |

## What each shot needs built

The script is the target. Today (Nov 1) the screen runs on sample data. Dates are from PLAN.md.

| Shot | Needs | Status today |
|---|---|---|
| Home, runway, red gap, ladder, home-share card, approval card, tax pot card, deadline card | M1 screen on sample data | Built |
| Bill arrives by email and the "here is what I understood" card | Claude reads the bill and the forwarding inbox (planned for Nov 6-7). Fallback: pre-extracted JSON per sample bill, shown the same way | Card is built; reading is planned |
| Live PayPal balance in the header | Balances call (planned for Nov 4-5; permission check pending) | Sample balance |
| Approve and send, client pays, verified webhook, gap closes | Real create, send and webhook on the deployed URL (planned for Nov 4-5) | Wired in code; not run end to end |
| Persona switch to Maya | Planned for Nov 2-3 | Maya's data and catalogue exist; the switch is not on screen |
| Source behind a tap | Built; confirm each source link opens | Built |

## Before recording checklist

- [ ] Sandbox accounts ready: the app on the Japan Business account (Ben) and the US Personal account (the paying client). Log the client in once and keep the browser window ready.
- [ ] `npm run smoke` passes. Invoicing and Transaction search show on the app, and a fresh token has been issued since they were saved (PayPal serves a cached token for about 9 hours).
- [ ] Webhook registered against the deployed URL, and `PAYPAL_WEBHOOK_ID` set in the Render environment.
- [ ] Demo reset: run the reset so the Hikari Denki bill is pending, the Beacon milestone is unbilled, and the Acme and Northwind invoices are sent. Check the runway shows ¥30,000 short on Nov 27 after the bill.
- [ ] Do a full dry run twice. Time it. Delete or cancel any stray sandbox invoices from the dry runs.
- [ ] Browser zoom set so text is readable at 1080p (125% or more). Window at 1920 by 1080. Hide bookmarks and extensions.
- [ ] Notifications off: do not disturb on, chat and email apps closed, system clock hidden (the app's sample date is Nov 14).
- [ ] Fictional data only. No real bills, names, addresses or account numbers anywhere on screen or in browser history. Fictional billers and clients only (Hikari Denki, Beacon Studio, Northwind, Acme Corp).
- [ ] No third-party logos or marks on screen other than PayPal's own sandbox pages. No music. Use voice-over only.
- [ ] Check the consumption-tax wording against the V2 conflict (export versus cross-border digital service for design work). If it is not settled by Nov 9, keep the "if he elects" wording, add the caption "Check with your tax office", and consider trimming that shot to the Dec 31 date and the source.
- [ ] Every sample figure that appears on camera carries its "sample" flag.
- [ ] Record the voice-over separately in a quiet room. Export at 1080p. Add English captions. Upload to YouTube as public or unlisted, and check the length shows under 3:00.

## Fallback

If the sandbox payer flow misbehaves while recording (the client page fails to load or the payment does not post), use the toolkit's `record_payment_for_invoice` to mark the invoice paid through PayPal. It still fires the `INVOICING.INVOICE.PAID` webhook, so the verified-webhook beat stays real. Say "the client pays" over the shot and do not claim the payer page ran. If PayPal is slow, cut to the log entry after the webhook lands and keep the shot at 1:10-1:30 shorter.

If the bill reader is not ready, show the pre-extracted bill and say "the app reads it" only if the live read ran at least once on camera. Otherwise say "the app shows what it understood".

## If it runs long

Trim in this order: the home-share shot (0:47-0:55), the Maya shot to 12 seconds, the second half of the client-paid shot. The never-cut beats are: bill, red gap, costed options, approve, paid with verified webhook, gap closes, and one deadline card.
