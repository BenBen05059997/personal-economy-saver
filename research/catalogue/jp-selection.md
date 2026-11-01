# Japan catalogue: the selected moves

Selected from research/wealth-moves (the three Japan files, plus the Japan-relevant rows of universal-and-cross-border.md) and research/users, then re-checked row by row against primary pages on Nov 1, 2026 (see research/catalogue/verification-jp.md for every figure, source and status). Files: `economy-saver/src/data/catalogue/jp.json` (words, sources), `economy-saver/src/lib/catalogue/formulas/jp.ts` (maths). 20 moves: 15 insider, 5 baseline. Where a formula needs an assumption the row is `illustrative: true` and the formula comment says what was assumed.

## The moves

Ben's value is the engine's output for the demo profile (Tokyo designer, age 29, ¥6M revenue, ¥1M expenses, white filer, no iDeCo/共済, 国保, `today` 2026-11-14). "once" values are one-off; the rest are per year. The two life-event rows apply to someone leaving a job, so they show "not eligible" for Ben unless the context carries a `left_job` or `laid_off` event.

| id | title | tier | knownBy | moments | Ben's value | deadline | confidence |
|---|---|---|---|---|---|---|---|
| jp-payout-cost | Know what each USD payout costs, and price it in | insider | cross-border freelancers | client_paid | ¥419,200 / yr | none | verified_primary |
| jp-blue-return-65 | File blue, not white, and keep ¥650k more | insider | tax accountants and experienced freelancers | bill_arrived, life_event, deadline_near | ¥200,100 / yr | yearly Mar 15 (承認申請) | verified_primary |
| jp-ideco | Put up to ¥75,000 a month into iDeCo | baseline | anyone with a normal job | setup, life_event, deadline_near | ¥169,800 / yr | 2026-12-01 (new cap), remind 30 | verified_primary |
| jp-jizokuka-subsidy | Apply for a small-business subsidy by Dec 15 | insider | subsidy consultants and 商工会 members | deadline_near, surplus_month | ¥200,000 once (example ¥300k spend at 2/3; approval by screening) | 2026-12-15, remind 45 | verified_primary, illustrative |
| jp-kyosai | Small-business mutual aid: deductible and borrowable | insider | tax accountants and 商工会 members | surplus_month, windfall, life_event, deadline_near | ¥126,900 / yr (stacked on a maxed iDeCo) | yearly Dec 31, remind 45 | verified_primary |
| jp-home-share | Count your home's share of rent and utilities | insider | tax accountants and experienced freelancers | bill_arrived | ¥101,500 / yr (illustrative share; a 25% share needs a blue return) | none | verified_primary, illustrative |
| jp-yotei-nozei-reduction | Ask to pay less of your November tax instalment | insider | tax accountants | deadline_near | ¥97,100 once (the most cash kept; timing, not counted) | 2026-11-16 (Nov 15 is a Sunday), remind 14 | verified_primary, illustrative |
| jp-consumption-tax-election | Get the 10% back on your Japanese expenses | insider | tax accountants | deadline_near, client_paid | ¥90,900 / yr | yearly Dec 31, remind 60 | verified_primary, illustrative |
| jp-amended-return | Claim back tax from past returns | insider | tax accountants | windfall, deadline_near | ¥80,800 once (example miss of ¥200k a year) | 2027-03-15 (2021 return), remind 90 | verified_primary, illustrative |
| jp-furusato | Hometown tax donation before Dec 31 | baseline | anyone with a normal job | deadline_near, setup, windfall | ¥22,800 / yr (limit ≈ ¥83k) | yearly Dec 31, remind 60 | verified_primary |
| jp-self-back | Get paid for signing up yourself (self-back) | insider | affiliate bloggers and point hunters | surplus_month | ¥18,090 once (before tax) | none (offers expire) | verified_primary, illustrative |
| jp-nenkin-prepay | Prepay two years of national pension | insider | pension office regulars and money bloggers | deadline_near, surplus_month | ¥17,370 once (needs about ¥420k free) | yearly Feb 28, remind 45 | verified_primary, illustrative |
| jp-tax-pot | Set aside the tax from each payout | baseline | anyone who has freelanced for a year | client_paid | ¥15,500 once on the $400 payout (protected, not earned) | none | secondary, illustrative |
| jp-card-signup-bonus | Take a card's own sign-up bonus once | insider | point hunters (ポイ活) | surplus_month | ¥5,000 once | none | verified_primary, illustrative |
| jp-fuka-nenkin | Add ¥400 a month to your national pension | insider | pension office regulars and money bloggers | life_event, surplus_month | ¥2,400 / yr of pension for each year paid | none | verified_primary |
| jp-park-cash | Move idle cash to a higher rate | baseline | anyone with a normal job | surplus_month, windfall, setup | ¥2,200 / yr on a ¥400k surplus | none | secondary |
| jp-revolving-check | Check your card for revolving payments | baseline | anyone with a normal job | statement_arrived | ¥0 for Ben (no revolving balance); ¥52,900 / yr on ¥300k | none | verified_primary |
| jp-nenkin-exemption | Pause national pension when income is low | insider | municipal pension desks and 社労士 | life_event | not eligible (income above the ¥670k line); ¥215,040 / yr for someone who is | none | verified_primary |
| jp-ninin-keizoku | Pick your health insurance within 20 days of leaving a job | insider | HR departments and 社労士 | life_event | not eligible for Ben; for a 29-year-old leaving a ¥350k/month job: 任意継続 ≈ ¥387k vs 国保 ≈ ¥331k for the first 12 months (gap ¥56,600), or 国保 ≈ ¥114k after an involuntary exit | none (20 days from the day after leaving) | verified_primary, illustrative |
| jp-saishushoku-teate | Get 再就職手当 if you start a business on unemployment benefit | insider | ハローワーク counters and 社労士 | life_event | not eligible for Ben; ¥278,460 once for the same ¥350k/month leaver (floor-style example) | none (claim due 1 month after the start date) | verified_primary, illustrative |

Recurring gains for Ben across the moves that apply: **¥1,135,800 a year**; one-off gains add **¥321,260** (¥80,800 and ¥200,000 are example-based, ¥17,370 needs about ¥420k of cash on the day). The counted total is **¥1,457,060** (¥1,472,760 when the worst case is ¥2M and the park-cash row grows). The 予定納税 instalment (¥97,100) and the tax pot are shown but not counted (timing and protected money, D8). The research's own ceiling for the recurring items is ¥0.8M to ¥1.1M; the difference is the iDeCo and 共済 rows stacking at the caps (¥297k against the research's ¥284k) and the PayPal row counted in full.

## Why these

The owner's test is "does a sensible 30-year-old with a normal job already know it?". iDeCo, ふるさと納税, a better savings rate and the リボ warning are the baseline rows, shown once. Everything that lives with tax accountants, cross-border freelancers, point hunters, 商工会 members, subsidy consultants, HR departments and Hello Work counters is insider: the consumption-tax election, home-share, the 予定納税 request, 共済, 青色 with its 国保 side effect, the PayPal stack priced into invoices, self-back and the card bonus, the 更正の請求 and the subsidy, and for the life_event moment the 任意継続 vs 国保 comparison and 再就職手当. Each attaches to a moment where it is true for Ben: the electricity bill (home-share, 青色 via the 国保 bill), the $400 payout (what it cost, the export election, the tax pot), a surplus month (共済, the subsidy, self-back), Nov 14 (予定納税 due in two days, the Dec 31 election). Insider moves that touch credit files carry `freezeWhenLoanPending`; those that need cash carry `minFreeCash` (the 2-year pension prepayment needs about ¥417k, so it stays hidden from moment cards until Ben's worst case is above that).

## Left out, and why

- **IPO lotteries and 優待クロス (both insider genres).** The research has no usable figures: one outlier family (32 wins, ¥1,587,345 in 2025), no per-person median, no capital requirement, no 逆日歩 amounts. A value row would be invented, and both sit close to 投資助言.
- **NISA (新NISA).** Verified and baseline, but its value is a 30-year figure (≈ ¥2.9M of tax avoided over 30 years at 5%, an illustration). The engine has no way to show a long-horizon value without distorting the yearly total. Best as a setup-checklist line, not a ranked row.
- **Leave PayPal / Wise USD account details / Sony Bank wire (¥300–400k).** Excluded by the product framing ("never leave PayPal") and because it overlaps with `jp-payout-cost`; the row mentions other routes only as options.
- **¥4.89M 合計所得 line, 経費の漏れ and the ¥400k write-off.** The first is folded into the 青色 row (not counted). The write-off is blue-filer only and Ben files white; PayPal fees as expenses is the 更正の請求 and payout-cost story.
- **個人事業税 planning, 住民税 instalments, 経営セーフティ共済, 法人成り, インボイス, W-8BEN.** Budgeting or compliance, not a priced gain (個人事業税 ≈ ¥105k is a cost), or the research is unverified (法人成り breakeven). W-8BEN is prevention with no value for a user who already has it.
- **Paying tax by card.** The NTA fee is ¥99 (tax included) per ¥10,000, about 1%; whether card points beat that depends on the card, so there is no computable gain.
- **FX self-back, securities and bank account bonuses, everyday point-site routing.** FX self-back is market risk plus 投資助言 territory; account bonuses would need named brokers and overlap the self-back row; routing is ¥300 a month with an unknown rebate.
- **Phone plan, subscriptions, ATM fees, BNPL, insurance, dormant accounts, ねんきんネット, DC 自動移換, 018サポート.** Valid but need data the profile does not hold (carrier, subscriptions, children) or have no computable value for Ben.

## Judgement calls to check

- **更正の請求 window.** Two clocks: a 更正の請求 on a filed return runs 5 years from the statutory deadline (the 2021 return: Mar 15, 2027); a 還付申告 for a year never filed runs 5 years from Jan 1 of the following year (2021: Dec 31, 2026). The row uses the first for its deadline and names the second. Ben has only 2 filed years, so the formula hides the card at `deadline_near` for anyone freelancing under 5 years.
- **家事按分 amount and the white-filer rule.** The profile has no rent field, so housing and utilities are assumed at 45% of monthly essentials and the work share at 25% (the research example's work room). For a white filer 施行令96条 allows only a cost whose main part is for work, so the 25% share is allowed from a blue return; the value uses the blue profile's saving rate and the basis line says so for white filers.
- **予定納税.** The value is the November instalment (a third of last year's income tax, assuming last year looked like this year, with the 2026-27 basic deduction as a stand-in). It is the most cash the request can keep, not a gain. Nov 15, 2026 is a Sunday, so the request deadline is Nov 16.
- **Subsidy.** ¥200,000 is an example (¥300k of spend × 2/3). It is a reimbursement of spending the user chooses to make, and approval is by screening, so it is not guaranteed.
- **Life-event rows.** The formulas read the context event: kind `left_job` (resigned) or `laid_off` (involuntary), amount = last monthly pay in yen. With no event they fall back to `healthInsurance: "jp_employer"` and annualRevenue ÷ 12. 任意継続 uses 協会けんぽ Tokyo FY2026 rates and 国保 uses Setagaya FY2026 rates; bonuses and dependants are ignored, and only the first 12 months are compared. 再就職手当 assumes the 90-day minimum entitlement with two thirds left.
- **Tax model.** `formulas/jp.ts` rebuilds the research's worked example (青色 ¥650k, ¥1.04M basic deduction, 国保 10.58% with the age-based cap, 個人事業税 5% above ¥2.9M) and scales by income band. Savings moves assume a blue return, so a white filer's true band is higher (conservative). The ¥4.89M cliff is not counted.

## Engine output for Ben

Script: `/private/tmp/claude-501/-Users-ben-Downloads-paypal-hackerton/93baa575-de83-4d79-a0d1-0da16f74aca0/scratchpad/verify-jp/check.ts` (run from `economy-saver/` with `npx tsx`). Contexts: today 2026-11-14, cashToday 128000, bufferTarget 1,890,000; worstLow -30000 (bill_arrived), 30000 (client_paid, deadline_near, statement_arrived), 400000 (surplus_month, life_event, windfall, setup), plus a 600000 deadline_near run. `catalogue("JP")` parses (20 moves), every id has a formula and every formula an id.

```
Top suggestions for Ben by moment
  bill_arrived       jp-home-share 101,500/yr; jp-blue-return-65 200,100/yr
  client_paid        jp-tax-pot 15,500 once (pinned); jp-payout-cost 419,200/yr; jp-consumption-tax-election 90,900/yr
  surplus_month      jp-kyosai 126,900/yr; jp-jizokuka-subsidy 200,000 once; jp-self-back 18,090 once
  deadline_near      jp-yotei-nozei-reduction 97,100 once (due in 2 days); jp-consumption-tax-election 90,900/yr
  deadline_near (¥600k)  + jp-jizokuka-subsidy 200,000 once (due in 31 days)
  statement_arrived  none (no revolving balance)
  life_event         jp-kyosai; jp-blue-return-65; jp-ideco 169,800/yr
  windfall           jp-kyosai; jp-amended-return 80,800 once; jp-furusato 22,800/yr
  setup              jp-ideco; jp-furusato; jp-park-cash 2,200/yr

allFor (surplus context)  yearlyTotal 1,457,060  (recurring gains 1,135,800 + one-off gains 321,260)
allFor (worstLow ¥2M)     yearlyTotal 1,472,760

Not eligible for Ben: jp-tax-pot (needs a payout), jp-revolving-check (no balance), jp-nenkin-exemption (income above ¥670k),
jp-ninin-keizoku and jp-saishushoku-teate (no job-exit event)

Leaver examples (life_event with an event)
  29, left_job ¥350k/month   再就職手当 278,460; 任意継続 387k vs 国保 331k, gap 56,600 (国保 cheaper)
  29, laid_off ¥350k/month   任意継続 387k vs 国保 114k (30% rule), gap 272,800; 再就職手当 278,460
  42, left_job ¥500k/month   再就職手当 347,340; 任意継続 449k vs 国保 596k, gap 146,900 (任意継続 cheaper)
```
