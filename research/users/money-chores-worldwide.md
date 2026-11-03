# The money chores people everywhere want taken off them (synthesis)

Researched Nov 3, 2026 by four parallel research agents, one theme each; this file is the lead's reading of the four. Raw files, each with a source URL and a year on every claim and the tags [measured] / [community] / [vendor] / [inference]:

| File | Theme | Strongest sources | Weak spots the agent flagged |
|---|---|---|---|
| [money-calendar-worldwide.md](money-calendar-worldwide.md) | When people do money things in 14 countries: pay cycles, rent day, 13th-month pay, festival seasons, renewal and government-payment dates | statutes, BLS, regulators, NRF, CAIT | no Google Trends series; "rent on the 1st" in US/UK/CA is inference |
| [money-chores-people-hate.md](money-chores-people-hate.md) | The admin burden: subscriptions, loyalty penalties, late fees, splitting, remittances, rate resets, unclaimed money | gov.uk consultation, CPRC, CFPB, CMA, FCA, UK Finance, ASIC, World Bank | mostly UK/US/AU; Germany, India, Nigeria thin; little community evidence |
| [money-apps-by-region.md](money-apps-by-region.md) | What apps in each region are actually used for, with App Store reviews from Oct–Nov 2026 | Chime S-1, Monzo annual report, KUBRA and PYMNTS autopay surveys, Trolley 2026 | no adoption numbers for pots, Salary Sorter, Caixinhas; several figures seen only in search summaries |
| [paypal-earners.md](paypal-earners.md) | The PayPal earner's life: holds, spread, late clients, country access, yearly letters, under-used features | PayPal 8-K and developer docs, IPSE, Remote 2025, UK Financial Ombudsman, national press | Reddit unreadable; several PayPal pages returned 403; many [vendor] competitor blogs |

Not repeated here: the Japan-specific moments (住民税, 国保, 予定納税, ふるさと納税) in `questions-people-ask.md` and `../wealth-moves/japan-tax-freelancer.md`, and the freelancer feelings in `what-freelancers-want.md`.

## The finding in one line

Almost every chore people hate is a **future-dated obligation** (a debit, a renewal, a rent day, a client's pay run, a dispute deadline) or a **missed deadline** (a trial that rolled over, a fix that ended, a deposit never disputed). That is the shape of a 30-day runway. No mainstream app joins them in one dated list with a cash forecast; Rocket Money, Splitwise, Starling's Bills Manager, CRED and Remitly each own one piece. [inference from all four files]

## Where the four lists agree

Each agent ranked 12 jobs independently. These appear in three or four of the four lists:

| Job, in the user's words | In how many lists | The evidence that carries it | What it is in our product |
|---|---|---|---|
| "Will this clear before I'm paid again?" | 4 | 37% of US adults paid a late fee in a year (NerdWallet 2024); $5.83bn US overdraft/NSF fees (CFPB 2023); autopay only half trusted: 59% use it for some bills, 67% of non-users want to review first (KUBRA 2025); India's UPI AutoPay sees mass revocations for low balance (headline only) | The sentence and the runway. Already built. Missing: a warning the day before a known debit when the forecast is short |
| "Chase the late client, at the right moment" | 4 | 85% of freelancers paid late at least sometimes, 21% more than half the time (Remote 2025, secondary); 20% of UK self-employed had no money for basics after a late payment (IPSE); 29% of invoices late by ~18.5 days; clients pay on their own run (month-end, 15th/30th, 25th, Brazil's 5th business day) | The Approve action. Already built. Missing: timing the reminder to the client's pay run, and the what-if per client from their own history |
| "Which subscriptions, trials and renewals hit in the next 30 days?" | 3 | 9.7M unwanted contracts, £1.6bn a year, 3.6M from rolled-over trials (gov.uk); 75% of Australians had a bad cancellation and 1 in 10 gave up and kept paying (CPRC 2024); 42% of US adults forgot a service (C+R 2022); Rocket Money's top complaint is false detection | Monthly bills exist (D41). Missing: yearly repeats, trial-ends and cancel-by dates, and the "if you do nothing you pay X" line. Never auto-cancel |
| "Set money aside the moment income lands" | 3 | Monzo Salary Sorter, Qapital payday rules, Toss, Nubank Caixinhas are the loved pattern (no adoption figures); 63% of US full-time freelancers dipped into savings monthly | Pots with a fill rule (D43). Missing: "reserve rent and the bills before payday first", for lumpy income |
| "Who owes whom, and settle" | 3 | Monzo: 8.8M splits in FY2025; Tricount £20.2bn split in 2025; 16% of UK couples' money arguments are about contributions; people delete Splitwise over notifications | The split (D45). Keep it quiet. Possible: settle through a PayPal request, since that is "getting paid" |
| "Money that is mine but not available yet" | 2, but the strongest PayPal-specific pain | Holds of 21 days (new accounts), 7 days after "completed" (services), 180 days on limited accounts; a UK Ombudsman decision upheld a 180-day hold; the Balances API returns total, available and withheld per currency | Not built. The runway counts the PayPal balance as cash; withheld money should be a dated "expected" item, not cash |
| "The real value in my currency, after fees" | 3 | 3–4% spread plus 1.5% on international commercial payments; India, the Philippines, Argentina, Mexico forced-convert; 93% of cross-border earners would take less pay for a 24-hour payment guarantee (Trolley 2026, n=450) | D16 fee framing exists. Missing: the net landing amount per invoice, and a monthly "lost to spread and refund fees" line from Transaction Search |

Jobs that appeared once but are cheap because they are just another dated item on the timeline: the dispute clock (`seller_response_due_date` from the Disputes API); a rate reset or rent increase (the bill's amount changes on a date; `previous_amount_minor` exists); the monthly remittance home (46% of US remittance-app users send at least monthly; a recurring outflow with a fee); the 13th-month or bonus month and the January hangover (card statements and subscriptions landing after December); the German car-insurance cancel-by of Nov 30, US open enrolment Oct 15–Dec 7, the UK energy fix ending (a 42–49 day switch window).

## What did not win anywhere

Budgets that need manual categorising; insight-only dashboards; bill negotiation as a headline job; round-ups for irregular earners; notification volume (the top deletion reason for Splitwise, Emma, CRED); auto-categorisation errors (Emma, Rocket Money: "shows my car payment 50x in a single month"). Credit bridges (Chime SpotMe 49% of monthly actives, Dave $2.0bn a quarter, Fuliza 9.1M customers) are the largest revenue jobs and stay information-only for us (D7).

## What this changes in the product

1. **The timeline gets new kinds of dated item, not new screens.** Trial-ends and renewals with a cancel-by date; held PayPal money with an expected release date; disputes with a response deadline; a bill whose amount changes on a date; a recurring remittance with its fee. Each is one row in Coming up and one term in the runway. The sentence does not change shape.
2. **Cash splits into available and expected.** `availableCash` should count only the available PayPal balance; withheld money joins invoices as expected-in with a date. This is the one place the engine's maths changes.
3. **The client chase gets a clock.** Each client's days-to-pay history already exists; add their pay run (month-end, the 15th/30th, the 25th, the 5th business day) so the reminder lands before it, within PayPal's cap of two manual reminders per 24 hours.
4. **Yearly repeats and amount changes** in the bill model (D41 is monthly only) cover subscriptions, insurance, domains, rent increases and rate resets in one stroke.
5. **The country layer is content, not code**: pay-cycle patterns, renewal seasons, festival dates and government-payment calendars per country, like the catalogue's Japan and US data (D6). The engine does not know about countries.
6. **Business vs personal** stays a tag on each item (D46 candidate): it serves the US Schedule C, the UK self-assessment and Japan's 青色 alike, and the AI drafts it from the merchant name.

## Rules the research adds

- Never auto-cancel, auto-move or auto-pay anything; show the dated item and one action behind a confirm (the autopay surveys and the Rocket Money reviews both say people want to review first).
- One notice per real event; the day before a known debit when the forecast is short, nothing otherwise (notification volume is the top deletion reason).
- Held, pending and late money is never shown as cash.
- A detection the app is unsure of says so ("looks like a yearly renewal; is it?") rather than guessing, because false detections are the top complaint of the apps that tried.
