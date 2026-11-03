# What people want when they want financial help: research index

Researched Oct 31, 2026 by three parallel research agents. Raw files:

| File | What it covers | Lines |
|---|---|---|
| [what-people-want-from-advice.md](what-people-want-from-advice.md) | Surveys and studies, US and Japan: what people want, why they don't ask, what they trust, why education fades, what makes them act | 179 |
| [questions-people-ask.md](questions-people-ask.md) | Reddit wikis and top posts (via Wayback), Yahoo!知恵袋, Google Trends for 19 terms, a table of 20 moments, "wish I knew" items split obvious vs non-obvious, the insider genres | 292 |
| [moment-based-suggestions-in-apps.md](moment-based-suggestions-in-apps.md) | How Copilot, Monarch, Cleo, Monzo, Credit Karma, Money Forward, Olive and others attach advice to a moment; notification trials with effect sizes; AI-assistant failures; trust and disclosure rules | 150 |

Every claim in the files carries a source, a year and a "checked" date, and is tagged measured / community / secondary.

Researched Nov 3, 2026 by four more agents, on what people everywhere (not only Japan) want taken off them, beyond tax; the lead's synthesis is [money-chores-worldwide.md](money-chores-worldwide.md):

| File | What it covers | Lines |
|---|---|---|
| [money-chores-worldwide.md](money-chores-worldwide.md) | The synthesis: the jobs all four lists agree on, what did not win anywhere, what it changes in the product | 52 |
| [money-calendar-worldwide.md](money-calendar-worldwide.md) | When people do money things in 14 countries: pay cycles, rent day, 13th-month pay, festival seasons, renewal and government-payment dates | 138 |
| [money-chores-people-hate.md](money-chores-people-hate.md) | Subscriptions, loyalty penalties, late fees, splitting, remittances, rate resets, unclaimed money, with regulator figures | 132 |
| [money-apps-by-region.md](money-apps-by-region.md) | What apps in each region are used for (UK/EU, Americas, India/SE Asia, Africa, cross-border), with Oct–Nov 2026 App Store reviews | 132 |
| [paypal-earners.md](paypal-earners.md) | PayPal earners worldwide: holds, spread, late clients, country access, yearly letters, under-used PayPal features, and which PayPal APIs expose the data | 141 |

## The ten findings that decide the design

1. **Help at the decision is what survives; lessons fade.** Financial education explains about 0.1% of behaviour and is near zero after 20 months (Fernandes, Lynch & Netemeyer 2014). The authors' own recommendation is one fact at the moment it matters.
2. **People ask about the document in front of them.** Live Yahoo!知恵袋 questions on Oct 31 were about 年末調整 forms, リボ statements that don't add up, and the insurance gap after quitting. Search peaks line up with documents landing: 年末調整 ×5.5 in November, ふるさと納税 いつまで ×5.3 in December (and still ×1.2 in January, after it's too late), 確定申告 フリーランス ×2.6 in February, 住民税 高い ×3 in June; US "estimated tax payments" ×2 on each quarterly date.
3. **Reminders tied to a dated obligation are the strongest nudge measured.** An SMS three days before a loan instalment worked about as well as a 25% interest cut (Cadena & Schoar 2011). Auto-enabled overdraft alerts cut charges 21–25% (FCA 2018). Making balances visible cut insufficient-funds fees 38% (Carlin, Olafsson & Pagel 2023).
4. **Specific, short, single, and only while the user can still act.** Messages naming the user's goal and the amount worked best; extra late reminders added nothing (Karlan et al.). Early low-balance warnings had weak effects (FCA). Real-world nudges average +1.4 points, not the +8.7 of published studies (DellaVigna & Linos 2022): expect modest effects, so pick high-value moments.
5. **Nudges have side effects.** Card-payment reminders cut late fees 14% but raised overdraft fees 9% (Medina 2021). Any "pay now" suggestion checks the cash buffer first. That is exactly what the runway chart is for.
6. **Freelancers' problem is timing, not knowledge of products.** 58% of US self-employed have income that varies monthly and 22% struggled to pay bills because of it (Fed SHED 2025). 32.4% of Japanese freelancers had a ¥0 month last year (Mynavi 2025). Among US 1099 workers, 47% set nothing aside for tax and 49% skip quarterly payments (IEC 2022). In Japan the worst surprises are 住民税 and 国保 billed on last year's income, and 予定納税 in year two.
7. **The young want help and don't ask.** 82% of Gen Z say they need advice; 76% haven't sought it; 38% don't know where to look; 33% think they don't have enough money to deserve it (intelliflo/Harris 2023). 40% of Americans are embarrassed about their finances (CFP Board 2026). Japan: 8.7% have ever had financial education; the literacy score fell to 53.8% while 18–29s rated themselves higher (J-FLEC 2025). People avoid looking when things are bad (Olafsson & Pagel): logins rise on payday, fall when overdrawn.
8. **AI is used but not trusted, and the failures are documented.** About a quarter of under-45s who sought advice used AI; 3 in 10 adults have confidence in it vs 8 in 10 for a human (Gallup/Edward Jones 2026). 93% check before acting; 57% regret acting on bad online advice (CFP Board 2025). Monarch's AI drew a backlash and an admission of inaccuracy; tax bots were wrong up to half the time (WaPo 2024); Klarna reversed its all-AI support. Apps people trust are read-only or ask before acting (Copilot: "never acts without your approval").
9. **Paid product recommendations are where trust breaks.** Credit Karma paid $3M (false "pre-approved"), Cleo $17M (misleading advances); the CFPB called paid steering potentially "abusive". In Japan an unlabelled affiliate recommendation is illegal stealth marketing since Oct 2023. Sources, a visible "why", and a label on anything paid are not optional.
10. **Nobody in Japan pairs a bill with an action.** Money Forward and Olive warn before a debit when the balance is short (Money Forward only on the paid tier); nobody shows the bill, the cheapest way to cover it, and a button. That gap is ours.

## The moments, and what the app says at each

From the 20-row moment table in questions-people-ask.md, the ones worth building, in order of value and frequency:

| Moment (trigger) | User's question, in their words | The one fact they didn't know to ask | Action on the card |
|---|---|---|---|
| **A bill arrives** (email or upload) | "Can I pay this?" / "Why is it higher?" | Where it lands on the runway; what changed vs last time; the cheapest way to cover a gap (the ladder) | Confirm the bill; approve the fix |
| **住民税 / 国保 bill, June (JP)** | 「住民税 高い」「国保 高い」 | It's based on *last year's* income; first freelance year is the worst; 任意継続 vs 国保; exemption if income dropped | Compare; set the pots |
| **Card statement arrives** | 「リボ…含まれていない?」 "36K in cc debt, how?" | What the リボ/minimum balance costs over time; utilisation is read on the statement date | Pay in full from the right account; switch auto-リボ off |
| **A client pays (USD → JPY)** | "What do I do with this?" | Book it at TTM on a fixed date; set aside tax (25–30%); this month vs the ¥0-month buffer; what the payout cost in fees and how to price it in | Move X to the tax pot; log the FX receipt |
| **Tax deadline nears** (Feb–Mar JP; quarterly US) | 「確定申告 フリーランス」 "estimated tax payments" | 青色 election dates; the consumption-tax election by Dec 31 for exporters; US: quarterly if you'll owe ≥$1,000; IRA until Apr 15 | Checklist with dates |
| **Year-end (Nov–Dec)** | 「ふるさと納税 いつまで」 | Counts by payment date, cap depends on income after iDeCo/共済; January is too late | Show headroom; remind before Dec 31 |
| **Year two as a freelancer (Jul, Nov JP)** | "What is this notice?" | 予定納税: a third in July, a third in November; reduction request if income fell (Nov 1–15) | File the request |
| **Quitting to freelance / job change** | 「数日の空白で国保は?」 | No uninsured month; lump-sum 住民税; 再就職手当 if starting a business; 教育訓練給付 | Gap checklist |
| **Windfall / "I have ¥X"** | 「臨時収入で20万」 "I have $X, what do I do" | The order: buffer (9–12 months for lumpy income), then high-interest debt, then NISA/iDeCo or IRA/Solo 401(k) | Split it |
| **About to apply for a loan or mortgage** | (nobody asks; they find out later) | Freeze all card, bank-bonus and MNP moves; no new credit before the application | Pause insider suggestions |
| **A quiet month with surplus above the buffer** | (nobody asks) | This is when the insider moves pay: self-back, bank bonuses, IPO lotteries, 優待クロス, each with a cancel-by date and a tax note | One at a time, with an exit date |

The same table transfers to the US with the content swapped: 1099-K (income is taxable even without the form), estimated taxes, Roth deadline, HSA, bank and card bonuses, unclaimed property, medical-bill validation before paying a collector.

## Rules for every suggestion (from the trials and the failures)

1. One suggestion per real event, not per calendar day. Finance apps get the highest push opt-in of any category and lose it at 2–5 pushes a week.
2. Open with the user's own question, then the one fact.
3. The user's own number, in their currency, with a date.
4. A one-line "why", and the source behind a tap. 93% check before acting; let them.
5. One action, behind a confirm step. Never act unasked. This is also the PayPal approval gate.
6. "Not now" and "never for this" on every card.
7. Check the buffer before any "pay now"; never suggest リボ, minimum payments or a loan as a fix.
8. Insider moves only after the basics, only in surplus months, never during a credit application, each with an exit date and a tax note.
9. Nothing paid without a label; prefer nothing paid.
10. Plain statements, because the overconfident young reader and the ashamed older reader both need the fact said once, kindly, without a lecture.

## What this changes in the product

- **The unit of the product is the moment, not the dashboard.** Bills, statements, payouts, notices and dates are the triggers; the catalogue (research/wealth-moves) is what gets attached. That makes "a US version" a content swap: same triggers, different catalogue rows and deadlines.
- **Today's bill flow is already the first and best moment.** The runway, the ladder and the approval card are the evidence-backed shape: visible balance, dated obligation, cheapest fix, one action behind approval.
- **The "paid" moment is the second.** A USD payout landing in PayPal is where tax set-aside, buffer and fee-awareness attach, and it is PayPal data by definition.
- **Deadlines carry the wealth moves.** Dec 31 (消費税 election, ふるさと納税, expenses), Nov 1–15 (予定納税 reduction), Dec 1 (iDeCo cap), Mar 15 (青色) are what make a suggestion personal in November.
- **Insider moves are a mode, not a feed.** Surplus month, basics done, no loan pending: then one card at a time with an exit date.
