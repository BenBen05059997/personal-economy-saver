# Personal Economy Saver — private rehearsal plan

This is a short local implementation preview, not the final hackathon video. The exported movie is silent and contains no music. It labels the rehearsal and the simulated sandbox delivery on the opening card.

## 24-second sequence

| Time | Frame | Evidence and on-screen text |
|---|---|---|
| 0:00–0:04 | Title card | “Local rehearsal · simulated sandbox delivery.” Fictional seeded data; no real payment sent. |
| 0:04–0:08 | Captured Home screen | Initial PGlite seed: “¥18,780 short on the 27th.” The pending Hikari Denki bill is visible in To check. |
| 0:08–0:12 | Data-state card | `confirmPending` changed the seeded bill to confirmed. The engine recomputed Home to “¥30,000 short on the 27th.” |
| 0:12–0:16 | Captured invoice review screen | Beacon Studio, fictional $400 design milestone, on receipt, ≈¥60,000 at the seed FX rate. The frame shows the actual InvoiceReview component. |
| 0:16–0:20 | Data-state card | `approveInvoice` ran with the test-only PayPal transport; the invoice row is `sent`. The transport is simulated; nothing was sent to PayPal or a client. |
| 0:20–0:24 | Data-state card | The PGlite test applied an already-verified paid event once. The household balance changed from ¥61,000 to ¥121,000, and the runway sentence now says the lowest point is ¥30,000 on the 27th. |

## Recording evidence

The Home and invoice frames were previously captured from the current screen components. The state cards are generated from the isolated PGlite rehearsal script, which seeds the household, confirms Hikari, runs the approval logic through an injected simulated transport, then applies the verified-delivery handler and reads the updated database state. The recording uses fictional identifiers and values only.

Before the final submission video, record the approved golden path against a Try it household and a configured PayPal Sandbox. Show a real sandbox send only after it has actually run, and show the paid transition only after PayPal's signature has been verified by the live webhook route. Keep this rehearsal private; it has no live URL or public video link.

## Final owner recording script · target 2:45

Record this after the owner-side Supabase, Worker, PayPal Sandbox, and webhook checks in `PLAN.md` are complete. Use the real Try it flow and show the live send and signed paid webhook only if they complete during the recording. Fictional seeded names and amounts remain on screen. English captions, no music, and no account details in view.

| Time | What to show | Narration |
|---|---|---|
| 0:00–0:10 | Title card, then Home. | “Personal Economy Saver is a money assistant for freelancers paid across borders. This demo uses fictional data and PayPal Sandbox.” |
| 0:10–0:30 | Start a fresh Try it household; settle on Home and the date. | “Ben is a fictional designer in Tokyo. His clients pay in dollars, while his bills are in yen. The Home sentence puts the late-payment risk on a date: if his clients pay as usual, he is fine; if they are late, the seeded forecast is ¥18,780 short on November 27.” |
| 0:30–0:48 | Show Hikari Denki in To check, confirm it, return attention to the sentence and runway dip. | “A Hikari Denki bill is waiting for Ben to check. He confirms the ¥11,220 bill. The app recalculates from the household records, and the possible shortfall changes to ¥30,000 on November 27.” |
| 0:48–1:04 | Show safe-to-spend, the runway line, To check, Cards and Coming up. | “The same Home view shows safe to spend, card spending that has not been billed yet, what needs checking, and the dates ahead. These figures come from the stored household data and the runway engine.” |
| 1:04–1:18 | Click the leading Invoice Beacon action. | “The next move is to invoice finished work. Ben opens the review before anything is sent.” |
| 1:18–1:38 | Invoice review: Beacon Studio, Brand refresh milestone 2, on receipt, $400, about ¥60,000 at the demo rate. Pause over the approval button. | “He checks the client, the work, the terms and the amount. The invoice is four hundred US dollars, about sixty thousand yen at the example rate. The agent can prepare it, but only Ben can approve the send.” |
| 1:38–1:52 | Tap Approve and send. Show the returned sent state or PayPal Sandbox invoice details. | “Ben approves. The server sends this invoice through PayPal Sandbox. The invoice is now awaiting payment.” |
| 1:52–2:09 | Show the sandbox client paying the invoice, then the Worker’s successful verified webhook handling or resulting Activity event. Hide email, account and transaction identifiers. | “The sandbox client pays. PayPal calls the app back. The webhook signature is verified before the invoice or balance changes.” |
| 2:09–2:28 | Return to Home after the database update; show the changed sentence and paid invoice. | “The paid event is recorded once. Four hundred dollars adds sixty thousand yen at the stored demo rate. Home recalculates: Ben is fine over the next thirty days, with a lowest point of thirty thousand yen on November 27.” |
| 2:28–2:45 | Briefly show Activity, then return to the updated Home and end card. | “The loop connects the forecast, the action and the payment update. Ben reviews the action, PayPal Sandbox carries it out, and a verified webhook closes the loop. Personal Economy Saver.” |

If the signed webhook or resulting Home state does not complete on camera, stop and resolve the live issue before recording the submission cut. Do not replace the live step with the local rehearsal and describe it as a real PayPal delivery. The final video target is 2:40–2:55; this timed narration is designed for about 2:45 with brief pauses for each visible state.
