# US catalogue selection

Built from `research/wealth-moves/united-states.md`, `universal-and-cross-border.md` and `research/users/`; every figure re-checked against primary sources on Nov 1, 2026 (see `verification-us.md`). Files: `economy-saver/src/data/catalogue/us.json` (words and sources), `src/lib/catalogue/formulas/us.ts` (maths), `src/lib/sample/maya.ts` (persona and `mayaContext(moment)`, owned by the lead).

**Maya:** freelance illustrator, Austin, 31, paid through PayPal. $70,000 revenue, $10,000 expenses, $60,000 net profit, Schedule C, marketplace plan, no Solo 401(k), no Roth, no card balance, 9-month buffer on $3,000 of essentials. The tax helper in `us.ts` returns SE tax $8,478, AGI/MAGI $55,761, taxable income $31,729, federal tax $12,037 (2026 single-filer brackets and $16,100 standard deduction, both confirmed in Rev. Proc. 2025-32).

## The 16 moves

10 insider, 6 baseline (the medical-bill check is baseline so a card balance never blocks it). "Value" is what the engine returns for Maya with `mayaContext` (today = 2026-11-14). "Kind": gain counts toward Found for you; protected and timing do not (D8). "Ill." = `illustrative: true` (the value uses an example figure).

| id | Title | Tier | Kind | Maya's value | Deadline | Confidence | Ill. |
|---|---|---|---|---|---|---|---|
| us-ptc-cliff | Keep your health-insurance credit under the 400% line | insider | protected | $1,646/yr at stake ($6,839 under the $62,600 line; example premium $7,200) | 2026-12-15 (last day to pick a 2027 plan for Jan 1 cover; open enrolment runs to Jan 15) | verified_primary | yes |
| us-solo-401k-or-sep | Open a Solo 401(k) or SEP, and pick Roth or pre-tax | insider | gain | $960/yr ($10,000 pre-tax x 12% x 0.8; room $35,652) | 2026-12-31 (safest date) | verified_primary | yes |
| us-qbi-deduction | Check you are getting the 20% business-income deduction | insider | gain | $952/yr | Apr 15 | verified_primary | no |
| us-se-health-insurance-deduction | Deduct your own health insurance premiums | insider | gain | $480/yr (on a $5,000 example premium) | Apr 15 | verified_primary | yes |
| us-hsa-bronze-plan | Use an HSA now that bronze marketplace plans qualify | insider | gain | $422/yr (only if her plan is HSA-eligible) | 2027-04-15 | verified_primary | yes |
| us-1099k-no-form-still-taxed | No 1099-K from PayPal does not mean no tax | insider | gain | $7 to $23 once (interest forgone on 24% backup withholding) | none | verified_primary | yes |
| us-bank-signup-bonus | Bank and brokerage sign-up bonuses, with the exit date | insider | gain | $264 once (one typical $300 bonus, 12% tax) | none | anecdotal | yes |
| us-card-signup-bonus | Card sign-up bonuses, only if you pay in full | insider | gain | $655 once (75,000 pts at 1 cent, less $95 fee) | none | secondary | yes |
| us-unclaimed-refunds-and-property | Check for refunds the IRS and states are holding for you | insider | gain | $686 once (2022 median; only if 2023 was skipped) | 2027-04-15 | verified_primary | yes |
| us-free-file | File your taxes free from the IRS site, not the ads | insider | gain | $120/yr (low end of an anecdotal $120-$200) | 2027-04-15 | secondary | yes |
| us-estimated-tax-quarterly | Pay estimated tax each quarter and skip the penalty | baseline | protected | $52/yr (penalty on the one 2026 payment still ahead; $3,009 a quarter) | 2027-01-15 | verified_primary | yes |
| us-tax-set-aside | Set aside tax from every payment, in its own pot | baseline | protected | $8 once; the card's job is "move $450 of this $1,800" | none | secondary | yes |
| us-roth-ira-prior-year | Fund last year's Roth IRA until April 15 | baseline | gain | $63/yr first-year tax-free growth ($7,500 at 7%, 12%); 40-year example about $112,000 | Apr 15 | verified_primary | yes |
| us-hysa-cash | Move idle cash out of PayPal and a 0.38% account | baseline | gain | $977 to $1,195/yr ($27,000 to $33,000 above one month of essentials, x 3.62 points) | none | secondary | yes |
| us-card-interest | See what your card balance costs you each year | baseline | gain | not eligible (no balance). With a $5,000 balance: $1,118/yr | none | verified_primary | no |
| us-medical-bill-check | Check a medical bill before you pay it | baseline | protected | the bill amount, shown as "worth checking", not a saving; only when the bill event is medical | none (the 30-day dispute window comes from the user's own notice) | verified_primary | no |

## Why these

The product is the moves a sensible 30-year-old with a normal job does not know, so ten of the sixteen rows are insider and name the world that holds them (CPAs, navigators, churners, deal-hunters). The biggest dollar item is the marketplace credit cliff: for 2026 coverage a single filer loses the whole credit above $62,600 (400% of the $15,650 line), the excess advance credit is repaid in full from tax year 2026, and Maya sits $6,839 below the line. The two moves that lower MAGI (Solo 401(k), HSA) are on the same page, so the catalogue tells one story. Next come the deduction stack (QBI, SE health insurance, HSA), the Solo 401(k) with the Roth-or-pre-tax choice, then the two quick-money genres (bank and card bonuses) with their freeze, free-cash floor, exit and tax notes. PayPal-specific: the 1099-K row, because many PayPal-paid freelancers get no form and the app should say the income is still taxable. The baselines are what the r/personalfinance flowchart already covers (estimated tax, tax pot, Roth deadline, high-yield cash, card interest) plus the medical-bill check, the one new row for the `bill_arrived` moment.

## Left out, and why

| Move | Why |
|---|---|
| State unclaimed property as its own row | Free and surprising, but there is no per-person amount. The engine hides a move whose value is 0, so it is a step inside `us-unclaimed-refunds-and-property`. |
| A statement row beyond the card bonus and card interest | Subscriptions ($540/yr in the research) is an example, not Maya's data, and no primary source gives a typical figure. Late fees do not apply to someone paying in full. Add the subscriptions row once PayPal transactions are read. |
| Treasury bills and I bonds as their own row | Maya's state is Texas, so the state-tax exemption is worth nothing. For the record, on Oct 30, 2026 T-bill yields were 3.98% (4 weeks) to 4.36% (52 weeks); I bonds issued Nov 2026 to Apr 2027 pay 5.51% (fixed 1.40%), with a 12-month lock and a $10,000 yearly limit. Both are in the high-yield row's traps. |
| Saver's Credit | Maya's AGI ($55,761) is far over the $40,250 single limit (IR-2025-111). |
| EITC | Over the limit for a single filer with no children. |
| Home office deduction | Needs square footage the profile does not hold. |
| Employer 401(k) match | Maya has no W-2 job. |
| Low-cost index funds | Fee arithmetic only; naming or sizing funds is personalised securities advice. |
| 529 for yourself | Needs a state-deduction figure; secondary only. |
| SNAP, LIHEAP, Lifeline | Maya's income is too high; amounts unknown. |
| OBBBA tips, overtime, car-loan and senior deductions | Do not apply to Maya. |
| Overdraft, payday, BNPL, rent-to-own | Need transaction data the profile does not hold, or no per-user figure. |
| Deposits, milestone invoicing and late fees | Real, but it is contract design, which edges into legal advice; value needs invoice data. |
| Class-action refunds | Per-claim payouts are anecdotal ($5 to $100). |

## Engine output for Maya (today 2026-11-14)

Top 3 from `suggest()` with `mayaContext(moment)`:

| Moment | Top 3 |
|---|---|
| setup | us-hysa-cash $977, us-estimated-tax-quarterly $52, us-roth-ira-prior-year $63 |
| client_paid ("Harbor & Co paid $1,800") | us-tax-set-aside $8 (pinned), us-solo-401k-or-sep $960, us-1099k-no-form-still-taxed $7 |
| bill_arrived (Zilker Valley Power $142) | none: the only US bill move is the medical-bill check, and this event is a utility bill |
| statement_arrived | us-card-signup-bonus $655 (Maya carries no balance, so `us-card-interest` is not eligible) |
| deadline_near | us-ptc-cliff $1,646 (31 days), us-solo-401k-or-sep $960 (47 days), us-unclaimed-refunds-and-property $686 (152 days) |
| surplus_month | us-solo-401k-or-sep $960, us-hysa-cash $1,195, us-card-signup-bonus $655 |
| life_event | us-qbi-deduction $952, us-ptc-cliff $1,646, us-se-health-insurance-deduction $480 |
| windfall | us-ptc-cliff $1,646, us-solo-401k-or-sep $960, us-hysa-cash $1,151 |

With a medical bill event (`kind: "bill"` and a label such as "Lone Star Clinic $480", or `kind: "medical_bill"`), `bill_arrived` returns `us-medical-bill-check` at the bill amount, also with a $5,000 card balance. With a $5,000 balance and a card statement, insider moves are blocked and `us-card-interest` shows $1,118 a year. With `loanPending`, the bank and card bonuses are dropped.

Yearly total from `yearlyTotal(allFor())`: **$5,602** at setup ($5,820 in a surplus month). It counts only gains: recurring $3,974 (QBI $952, Solo 401(k) $960, SE health $480, HSA $422, high-yield cash $977, Free File $120, Roth $63) plus four one-offs worth $1,628 (IRS refund check $686, card bonus $655, one bank bonus $264, 1099-K interest $23). The credit at stake ($1,646), the estimated-tax penalty ($52) and the medical bill are protected and left out. The $686 refund applies only if Maya skipped a 2023 return, which the profile cannot say.

## Illustrative figures and assumptions to know about

- Benchmark premium $7,200 (a research example for age about 40; Maya is 31 and her real one is unknown). Moves the credit by hundreds of dollars.
- SE health premium $5,000 (research example). Pre-tax contribution $10,000 (the research's "realistic" figure).
- HYSA value assumes the cash sits at the 0.38% national average now and uses 4.0%, cautious against the 4.27% to 4.40% the best online accounts listed on Oct 26.
- Bank bonus: $300 is the middle of 20 bonuses in one blogger's 2025 tally (range $100 to $900). PayPal payouts may not count as direct deposit, which matters for Maya.
- Tax set-aside rate 25% is the low end of a community 25% to 30% guide; Maya's federal estimate is 17% of revenue.
- Free File: $89,000 was the 2026-season cap (IRS newsroom); the IRS page, closed until January 2027, now shows $95,000. The $120 price of a paid Schedule C tier is anecdotal.
- Estimated tax: the value counts only the 2026 payment still ahead (Jan 15, 2027); earlier quarters are past.
- 2027: the 400% line is $63,840 and the top applicable percentage 10.22% (Rev. Proc. 2026-26); the enhanced subsidies were not restored. The formulas stay on tax year 2026 because that is the return Maya's Dec 31 contribution changes. The 2027 income-tax brackets and standard deduction are not yet published.

## Notes for the lead

1. `suggest()` and `allFor()` drop any move with `value.amount <= 0`, so "value unknown" moves (state unclaimed property, class actions) cannot appear. The medical-bill check uses the bill amount as a "protected" figure to get around this.
2. The tax set-aside and 1099-K moves are protective: their honest dollar value is a few dollars. The card should lead with the amount to move ($450), not the value.
3. Maya's `bill_arrived` demo event is a utility bill, so the medical-bill check never shows for her. To demo it, give her a second bill with `kind: "medical_bill"` (preferred) or a label that names a clinic or hospital. At `statement_arrived` Maya has only the card bonus; no honest statement row with a real figure exists yet.
4. `yearlyTotal` adds one-off and recurring gains together. Label it "found for you", not "new money". The unclaimed-refund $686 is a hypothetical for a profile that cannot say whether a year was skipped; consider showing it as "check" rather than counting it.
5. Dates inside the formulas (Apr 15, 2027; due dates of the 2026 estimated payments) are for tax year 2026.
