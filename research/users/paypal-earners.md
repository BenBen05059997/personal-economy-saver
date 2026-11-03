# The PayPal earner's life: what people struggle with, worldwide (research, 2026-11-03)

Labels: [measured] survey or dataset, [community] forum or news-comment post, [vendor] company claim (including competitor blogs that sell Wise, Payoneer, Skydo and similar), [inference] my reading.
Quotes are kept under 15 words. Years are the publication year of the source where known.
Method note: 45 searches and fetches. Reddit could not be read directly. The r/paypal mirror and the sentinel mirror gave one usable thread, and the Hacker News API returned nothing relevant. Community evidence therefore comes mainly from PayPal Community, Upwork Community, Etsy Community, Trustpilot, the UK Financial Ombudsman and African/Asian press. Treat "how often" as qualitative unless a number is given. Many "survey" pages found were SEO blogs; I used only figures that trace to a named study or an official page, and flagged the rest.

## Summary (10 lines)

1. PayPal still has about 440M active accounts and $487B quarterly volume (Q3 2026), but account growth is 0.6% a year; the earners that matter here are small, cross-border and often outside the US. [vendor] https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000086/pypl3q-26earningsrelease.htm (2026)
2. The most repeated pain is not a missing feature but a surprise: money shows as received, then sits on hold (up to 21 days for new or higher-risk sellers; 7 days after "completed" for services) or the account is limited for up to 180 days. [vendor + community] PayPal help (2025); Business Today Kenya (2021); Financial Ombudsman DRN-3453093.
3. Second pain: the quiet currency cost. PayPal lists a 3% to 4% conversion spread plus 1.5% on international commercial payments; India, the Philippines, Argentina and Mexico forced-convert to local currency. [vendor] https://www.paypal.com/us/webapps/mpp/merchant-fees (2026)
4. Third: late client payment is normal, not an exception. 85% of freelancers are paid late at least sometimes; about 21% are paid late or not at all more than half the time. [measured] Remote 2025.
5. Late payment hits living costs: 20% of UK self-employed had no money for basic costs after a late payment; 63% of US full-time freelancers dipped into savings monthly (2017). [measured] IPSE; Freelancing in America 2017.
6. Income swings are large: 68% report significant month-to-month variation and 34% have a month below half their average (Upwork 2024, via a secondary page). [measured, secondary]
7. Country access is uneven and changing: Nigeria regained receiving via Paga in Jan 2026; Pakistan and Bangladesh still have no normal PayPal; Ukraine was send-only for years. [community + news] TechCabal, Dawn, Daily Star.
8. Fee traps: Friends and Family has no protection; refunds never return the fixed fee; chargebacks cost a fee; Pay Later on an invoice costs 4.99% (US). [vendor] PayPal fees page; Invoice Simple.
9. Reporting letters arrive yearly (US 1099-K at $20,000 and 200 transactions again; EU/UK platform reporting at 30 sales or EUR 2,000 for goods, services reportable from the first sale; India purpose codes/FIRA). Users want "what do I do", not tax law. [secondary + gov.uk]
10. [inference] The product gap is a calm, dated answer to "what can I spend until the money lands?" that counts held, late and pending money separately from available money. PayPal's Balances API exposes that split (total, available, withheld).

## Table of recurring pains

| pain | who | how often | what they say | source |
|---|---|---|---|---|
| Payment on hold ("pending proof of delivery") after a client pays | New PayPal receivers, freelancers invoicing services, digital sellers | Very common for new accounts; PayPal says up to 21 days | "waiting 21 days for my money is almost a month to live hungry" (forum quote) | https://www.paypal.com/us/cshelp/article/how-can-i-release-my-payments-on-hold-help129 (2025); paypal-community.com threads (2023-2025) [community] |
| Account permanently limited, funds held up to 180 days (sometimes more) | Freelancers in Kenya, Philippines, Nigeria; small sellers | Frequent anecdotes, no rate published | Freelancer got $280 client payment, then "permanently limited" notice | https://www.paypal-community.com/t5/Security-and-Fraud/Permanently-Limited-PayPal-Account-with-Funds-on-Hold/td-p/3173359 (2024) [community]; FOS DRN-3453093 [measured case] |
| Currency spread and forced conversion | India, Philippines, Argentina, Mexico, Pakistan-adjacent, any non-US earner | Every withdrawal | $100 withdrawal got rate 43 vs bank 45 (Philippines thread) | https://yugatech.com/the-internet/the-mysterious-php200-paypal-withdrawal-fee [community]; https://www.paypal.com/us/webapps/mpp/merchant-fees [vendor] |
| Receiving fee plus international fee | Freelancers with foreign clients | Every payment | 4.4% + $0.30 plus 18% GST on the fee (India) | https://www.winvesta.in/blog/businesses/the-real-cost-of-paypal-for-indian-freelancers-in-2026 (2026) [vendor] |
| Client pays late | Freelancers everywhere | 85% at least sometimes | n/a (survey) | Remote 2025 report via https://remote.com/blog/reversing-late-payment-culture [measured] |
| Client does not pay at all | Southeast Asia, UK, global | 58% of PH/SE Asia freelancers once not paid (2018) | n/a | https://newsbytes.ph/2018/03/11/58-of-freelancers-in-ph-se-asia-markets-have-experienced-not-being-paid/ [measured, old] |
| Friends and Family used to dodge fees | Freelancers, one-off sellers | Common request from clients | "treat the 2.99% as part of selling" (advice) | https://wise.com/us/blog/paypal-friends-and-family-vs-goods-and-services [vendor] |
| Disputes and chargebacks on services; fees lost | Digital/service sellers | Anecdotal | "sided with buyer on digital service, ignored evidence" (1-star review) | Trustpilot paypalsucks page [community]; PayPal user agreement [vendor] |
| PayPal unavailable or receive-limited | Pakistan, Bangladesh, Ukraine (past), Nigeria (until 2026) | Entire countries | Pakistan: remittances via a third-party wallet announced March 2024 | https://www.arabnews.pk/pakistan/paypal-remittances-available-to-pakistani-freelancers-from-international-clients-starting-this-month-minister-2469926 [news] |
| Marketplace payout holds that are not PayPal's | eBay, Etsy, Depop sellers | Common for new shops | Etsy new-shop holds 14 days, reserves, 90 or 180 days | https://community.etsy.com/t5/Technical-Issues/14-day-hold-on-funds-even-though-more-than-180-days-have-passed/m-p/148915808 [community] |
| Creator payout minimums and conversion | Ko-fi, Patreon, Twitch creators | Every payout | Patreon lists 2.5% currency conversion when currencies differ | https://support.patreon.com/hc/en-us/articles/208656246 [vendor] |
| Feast and famine months | All | 68% report big month-to-month swings | n/a | Upwork Freelance Forward 2024 (secondary) [measured] |
| Yearly letters (1099-K, DAC7, FIRA) | US, EU, UK, India sellers/freelancers | Once a year, in January or tax season | Confusion about "do I owe tax because I got a form" | gov.uk reporting-rules page [vendor/gov] |

## 1. Who earns through PayPal, with numbers

- PayPal Q3 2026: 440M active accounts (+0.6% year on year), total payment volume $487.1B (+6%), 6.8B payment transactions. No merchant count or invoicing figure is in the release. [vendor] https://www.sec.gov/Archives/edgar/data/0001633917/000163391726000086/pypl3q-26earningsrelease.htm (2026)
- Payoneer 2023 Freelancer Insights (2,000+ freelancers, 122 countries): 55% took on more work for cost of living, 73% say finding new clients is hard, women earned about 92% of men's hourly rate ($22 vs $24). [measured] https://blog.payoneer.com/freelancers/the-payoneer-2023-freelancer-insights-report (2023). I found no 2024-2026 Payoneer edition.
- Payoneer 2020: 7,000+ freelancers in 150 countries; nearly 70% under 35. [measured] https://www.payoneer.com/resources/business/2020-freelancer-income-report/ (2020)
- Upwork: bank/PayPal/Payoneer withdrawal choices differ by country; third-party pages disagree on whether PayPal is still offered, so a helper should not assume Upwork pays out through PayPal. [vendor, conflicting] https://www.skydo.com/people-ask/does-upwork-support-paypal-withdrawal-2024
- eBay sellers no longer receive PayPal payouts: eBay pays them into a bank account; buyers can still check out with PayPal. [vendor] https://export.ebay.com/en/fees-and-payments/payments/introducing-managed-payments (2025). [inference] The "PayPal seller" for this app is mainly direct-invoice freelancers, small online shops using PayPal Checkout, and creators on Ko-fi style tools where PayPal is the payout rail (Ko-fi sends the supporter's money straight to the creator's PayPal with no holding period). https://help.ko-fi.com/hc/en-us/articles/360013140633 (2025)
- Not found: a global count of how many people receive income through PayPal. Do not quote one.

## 2. Recurring pains

### 2a. Holds, reserves and limitations
- PayPal says new sellers' first payments can be held up to 21 days; a service or intangible item is released 7 days after the order is marked Completed; "Know your options" shows the actions. Many help pages are marked old, so timings may have changed. [vendor] https://www.paypal.com/us/cshelp/article/new-paypal-account-%E2%80%93-payments-on-hold-and-accessing-your-money-quicker-help848 (2025)
- Even after the steps, PayPal can still hold up to 21 days on "unusual change in selling patterns". [vendor] same page.
- Freelancers on PayPal Community say proof of delivery is hard for services and the buyer clicking confirm receipt is the fastest release; the button appears after 48 hours and is not always offered. [community] https://www.paypal-community.com/t5/Transactions-Archives/Payment-for-consultation-services-placed-on-hold-without/td-p/2944450 (2023-2024)
- Invoicing for services can make PayPal treat you as a "seller", which triggers the hold regime. [community] https://www.paypal-community.com/t5/About-Protections/I-am-not-a-Seller-I-am-a-freelancer/td-p/1150490
- Kenya: freelancers reported holds up to 180 days, locked accounts after ordinary client payments, and ID/utility-bill demands they could not meet because addresses are not standardised. One commenter said a colleague was evicted over a held $570. Comments are unverified. PayPal replied that funds are typically released within 21 days if there are no problems. [community/news] https://businesstoday.co.ke/paypal-nightmare-experiences-leave-kenyan-writers-online-freelancers-broke-distressed/ (2021)
- The only neutral adjudicated source: a UK Financial Ombudsman decision found PayPal not unfair to hold funds about 180 days after a limitation, citing the user agreement allowing reserves longer than 180 days. [measured case] https://www.financial-ombudsman.org.uk/decision/DRN-3453093.pdf
- r/paypal, July 2024 (mirror): freelancer finished a project, client had trouble paying, account restricted; notice said funds may be held up to 180 days. [community] https://redlib.belloworld.it/r/paypal/comments/1eeft62/permanent_limiting_your_account_final_post_cant
- Etsy new shops: 14-day payout hold, reserves, and posts saying holds lasted past 180 days. [community] https://community.etsy.com/t5/Technical-Issues/14-day-hold-on-funds-even-though-more-than-180-days-have-passed/m-p/148915808

### 2b. Disputes, chargebacks, refunds
- Refunds are free to issue but the original fees are not returned; the fixed per-transaction fee is never refunded; partial refunds return fees pro rata. [vendor] https://www.paypal.com/us/business/paypal-business-fees and API docs (2025-2026).
- Card chargebacks carry a settlement fee (amount not confirmed); India fee list shows a Rs 580 dispute fee. [vendor] Winvesta (2026).
- Disputes API: stages INQUIRY, CHARGEBACK, PRE_ARBITRATION, ARBITRATION; inquiry stage up to 20 days; response deadline is `seller_response_due_date`. [vendor] https://developer.paypal.com/docs/disputes/disputes-reference/

### 2c. Currency and withdrawal
- PayPal's fee page: currency conversion spread 4.00% when paying/receiving in a currency other than the item's, 3.00% otherwise; international commercial and invoicing transactions add 1.50%; standard bank withdrawal free when no conversion; instant withdrawal 1.50%. [vendor] https://www.paypal.com/us/webapps/mpp/merchant-fees (2026)
- Independent comparisons put the real cost at 3% to 4.5% over mid-market and Wise at 0.3% to 1.5%, but most of those pages sell Wise or Skydo. [vendor] https://feeprobe.pages.dev/compare/paypal-vs-wise/ ; https://www.jobbers.io/the-global-freelance-payment-methods-report-2026-how-freelancers-get-paid-in-50-countries/ (not readable, 403).
- India: USD cannot be held; conversion to INR is automatic; daily sweep to the bank. [vendor] Winvesta (2026); XFlow (2026).
- Philippines: no withdrawal fee when no conversion above PHP 7,000; PHP 50 below (low-quality source); users complain the rate is "0.70 to 0.80 lower" than the bank's. [community] Yugatech thread.
- Argentina: PayPal allows USD withdrawal to a local account but all transfers are "subject to review"; local press mentions withholding rates on sales. [news] iProUP (2025-2026). Mexico: business fee table cited as 3.65% + MXN 4 at higher monthly volumes. [vendor] ArqFinance.
- Holding foreign currency: business accounts can accept up to about 21 to 24 currencies without converting, but you may withdraw only in USD (US accounts) and non-USD balances convert on withdrawal. [vendor] https://www.paypal.com/us/brc/article/how-to-accept-foreign-currency-with-your-business-account

### 2d. Access by country
- Nigeria: PayPal "returned" for receiving on 27 Jan 2026 through the Paga wallet, with naira payout or dollar balance; some boycott calls. [news] https://allafrica.com/stories/202601270689.html ; https://nairametrics.com/2026/01/27/paypal-return-sparks-boycott-calls-and-mixed-reactions-in-nigeria
- Pakistan: Minister Umar Saif said in March 2024 freelancers could receive PayPal money via a third-party wallet, paid into local bank, 0.25% tax; the SBP said in Feb 2025 it was willing to help but PayPal had not launched. [news] arabnews.pk link above; https://propakistani.pk/2025/02/19/sbp-willing-to-facilitate-paypal-launch-in-pakistan/
- Bangladesh: government says (June 2026) it is still working with Bangladesh Bank to bring PayPal; freelancers use Payoneer. [news] https://en.ittefaq.com.bd/16255/bangladesh-eyes-paypal-rollout-to-unlock-global
- Ukraine: PayPal long ran in "send only" mode; current status for receiving was not confirmed. [news] https://dou.ua/lenta/articles/how-paypal-work-in-ukraine/
- Brazil, Turkey, Egypt: not researched; unknown.

### 2e. Waiting for clients, reminders, partial payment
- PayPal Invoicing: reminders on by default around due date, configurable; manual reminders capped at 2 per invoice per 24 hours; partial payments with a minimum amount, status "Partially Paid"; recurring series weekly/monthly/quarterly/custom; no monthly fee for the free tier. [vendor] https://www.paypal.com/us/brc/article/invoicing-automation ; https://www.paypal.com/us/cshelp/article/how-do-i-send-a-reminder-for-an-invoice-or-money-request-help1152
- API: `invoice_reminder_configuration` sets reminder days before or after the due date. [vendor] https://developer.paypal.com/api/invoicing/v2/definitions/invoice_reminder_configuration
- Late payment norms: B2B terms average 43 days but payment arrives at 63 days (Intrum 2026); freelancer invoice-to-cash averages 39 days across 62 countries in one unverified compilation; UK IPSE: average wait 32 days and 15% wait 59 days or more; Bonsai: 29% of freelance invoices are paid at least one day late. [measured / secondary] https://www.inderes.se/releases/intrums-european-payment-report-2026-late-payments-are-holding-back-european-growth ; https://www.ipse.co.uk/policy/ipse-campaign-hub/late-payment/pay-up-how-to-end-late-payment.html
- Atradius 2025: overdue B2B invoices about 63% of sales in India, 57% in Germany, 51% in UK and Switzerland, 55% in Greece, 43% by value in the US. Definitions differ by country. [measured] https://group.atradius.com/knowledge-and-research/news/what-did-a-year-of-b2b-payment-disruption-teach-us ; country reports.
- Southern Europe: Intrum 2026 lists Italy at 67% and UK at 64% of firms paying suppliers late. [measured] inderes link above.
- Chasing costs time: 20 days a year chasing invoices (IPSE). [measured]

## 3. Yearly pains (what the user has to do, not tax law)

- US 1099-K: after the 2025 law the federal threshold is back at more than $20,000 and more than 200 transactions; some states are lower (Massachusetts $600). Some pages still print $600 or $5,000 and are out of date. I could not read PayPal's own page (403). [secondary] https://kahnlitwin.com/blogs/tax-blog/obbba-reverses-600-1099-k-threshold-requirement ; https://beancount.io/blog/2026/05/08/form-1099-k-2026-threshold-reverts-20000-200-transactions-obbba-payment-app-reporting-guide
- UK and EU platform reporting (DAC7 and the UK Reporting Rules): goods sellers with fewer than 30 sales and EUR 2,000 or less are excluded per platform; service providers are reported from the first sale; platforms collect tax ID, VAT number, date of birth; reports go out by January; a platform must give the seller a copy. Being reported does not by itself mean tax is owed. [gov] https://www.gov.uk/guidance/selling-goods-or-services-on-a-digital-platform ; https://www.gov.uk/guidance/reporting-rules-for-digital-platforms
- India: pick the right purpose code at PayPal signup (P0802 software is the one most cited), keep invoices to prove the service, ask for an inward remittance advice (FIRA); sources disagree on whether PayPal issues one. [vendor] https://www.winvesta.in/blog/businesses/the-real-cost-of-paypal-for-indian-freelancers-in-2026 ; https://grey.co/blog/firc-certificate-what-it-is-how-to-get-one-and-what-every-indian-freelancer-needs-to-know
- Not researched (no usable sources found): Canada, Australia, Philippines, Nigeria reporting. Do not claim anything for them.
- [inference] A date-aware helper could just say: "the form arrives in January; your PayPal Activity export for the year is here; keep a copy."

## 4. Irregular income life

- Upwork Freelance Forward 2024 (secondary page): 68% report significant month-to-month variation; 34% had a month below 50% of average. [measured, secondary] https://winvesta.in/blog/the-10-essential-freelance-jobs-realities-for-2024 (could not reach Upwork primary).
- Freelancing in America 2017: 63% of full-time freelancers dipped into savings at least monthly vs 20% of full-time non-employees. [measured, old] https://de2.slideshare.net/upwork/freelancing-in-america-2017
- IPSE: 20% found themselves with no money for rent and bills after late payment; 18% waited over three months once. [measured] https://www.ipse.co.uk/policy/ipse-campaign-hub/late-payment/pay-up-how-to-end-late-payment.html
- Runa 2025 (gig workers): 46% report financial strain from late payouts; 9% frequently. [measured] https://runa.io/blog/gig-economy-blog-series-2
- MBO Partners 2025: 72.9M US independents; stress/volatility figures are gated. [measured] https://www.mbopartners.com/state-of-independence
- Pennybot/Scale and similar guides agree on advice: budget from the lean-month average, route all client money to one account, keep a 1 to 2 month "client delay buffer", do not raid tax money. These are advice pages, not data. [vendor/advice] https://pennybot.io/blog/how-to-manage-irregular-income-freelancer
- Rent on a late month (Kenya story above) is the sharpest anecdote: PayPal hold plus rent arrears. [community] Business Today Kenya (2021).
- Not found: a clean, recent survey on how earners decide "what is safe to spend". [inference] The spoken workaround is "pay yourself a fixed amount from a buffer"; an app would automate that sentence.

## 5. Multi-currency and expat life

- Common stack in blogs: home bank for tax and rent, Wise (or Payoneer) for receiving and holding, PayPal only when a client insists, and a travel card. Tip repeated: ask the client to pay in their currency and withdraw in that currency to avoid PayPal's conversion. [vendor] https://www.neverendingvoyage.com/transferwise-borderless-review/ ; https://www.freelancermap.com/blog/cheaper-alternative-paypal/
- Wise itself can restrict holding in some countries; Bangladesh limits reported (unconfirmed). [vendor] 
- [inference] A runway app for someone paid in USD but spending in JPY, PHP or ARS needs two numbers: money now in PayPal in each currency, and an exchange-rate scenario for the day it is converted.

## 6. PayPal features people under-use or misunderstand

| feature | what to know | source |
|---|---|---|
| Goods and services vs Friends and Family | F&F has no purchase protection and card-funded F&F is not free; clients ask for it to avoid fees | https://wise.com/us/blog/paypal-friends-and-family-vs-goods-and-services [vendor] |
| Invoicing, reminders, partial payments, recurring series | Exist and are free to set up; reminders default on; cap of 2 manual reminders per 24h | https://www.paypal.com/us/brc/article/invoicing-automation [vendor] |
| Pay Later on invoices (US) | Buyer can pay in four; seller paid in full upfront; reported 4.99% fee on invoice total | https://help.invoicesimple.com/en/articles/11751872-can-my-clients-use-buy-now-pay-later-with-paypal [vendor, unconfirmed by PayPal] |
| Multi-currency balances | Hold up to about 21 to 24 currencies, but US withdrawal is USD only | PayPal brc article above [vendor] |
| PayPal Savings (US) | About 3.30% APY mid-2026, variable; personal US accounts only, business accounts not eligible | https://www.paypal.com/us/cshelp/article/paypal-savings-faqs-help777 [vendor] |
| Working Capital | WebBank loan to Business accounts after 90 days; fixed fee, repaid as share of PayPal sales; US, UK, Australia only per third-party | https://paypal.com/us/business/financial-services/working-capital-loan [vendor] |
| Seller protection for services | Weak for digital and intangible items, which is why holds and disputes bite | paypal-community.com threads [community] |

## 7. What a 30-day runway app should do for PayPal earners (ranked, non-tax, international)

Data legend: A = clearly exposed by PayPal REST APIs per docs; P = partly; N = not exposed (user or other data needed).

1. **Split "total" from "available" and name the held part.** Show "of $1,240 in PayPal, $430 is held; assume it arrives day X". Matters most: Kenya, Nigeria, Philippines, India, new accounts everywhere, small sellers. Data: A. Balances API returns total, available and withheld per currency (up to 3 hours delay). The release date of a hold is not a documented field. [inference] Use a rule: 21 days for new accounts, 7 days after completed for services, plus an "I don't know" state.
2. **Late-client what-if on the home sentence.** "If Acme pays 14 days late you are short on the 27th." Use the user's own history of days-to-pay per client. Matters: UK, Italy, India, Germany, Southeast Asia, everywhere with 40 to 60 day norms. Data: A for invoice date, due date, status, paid date via Invoicing v2 and webhooks; payer history is derived.
3. **Send or schedule a reminder at the right moment, with a one-tap approval.** Reminder before due, on due, and after; respects the 2 manual per 24h cap; suggest partial payment link when the client is stalling. Matters: all. Data: A (invoicing send_reminder, reminder config, partial payment flag).
4. **Currency-aware landing value.** Show net JPY/PHP/INR/ARS you will actually receive after PayPal's spread and international fee, and compare "convert now vs hold in USD" where holding is allowed. Matters: India (forced conversion), Philippines, Argentina, Mexico, Japan. Data: P. Balances and transaction fee fields are available; the withdrawal-day rate and the user's bank rate are not.
5. **"Dispute clock" on the timeline.** Show open disputes with `seller_response_due_date` and the amount at risk as a possible negative event in the 30 days. Matters: digital/service sellers worldwide. Data: A (Disputes API list and detail).
6. **Hold and limitation early warning.** If withheld balance jumps or a payment shows pending after a client pays, pin a card: what it means, how to release (mark order completed, ask client to confirm receipt, add proof), and treat that amount as unavailable for 180 days in the worst case. Matters: Kenya, Nigeria, Philippines, India, Pakistan-adjacent, any new account. Data: P. Balance split is A; why a hold exists is N.
7. **Fee and refund leak report in plain money.** "Last 30 days you lost $38 to spread and fixed fees on refunds." Show the price of asking a client to pay in their currency or by bank transfer. Matters: all non-US earners, marketplace sellers. Data: A (transaction fee fields in Transaction Search).
8. **Feast and famine buffer rule.** Compute a "pay yourself" number from the lean-month average, show how many weeks the buffer covers if the biggest client slips, and keep it inside safe to spend. Matters: everyone; strongest with 68% volatility figure. Data: A for history (transaction search up to 3 years), N for non-PayPal income.
9. **Cross-account balance entry (PayPal + Wise/Payoneer + local bank).** One manual snapshot field per account; the runway counts them. Matters: expats, India, Philippines, Nigeria, Bangladesh, Pakistan. Data: N (user entry or import).
10. **Goods-and-services guard.** When money arrives as Friends and Family, flag it ("no protection, may count as personal") and offer an invoice link for next time. Matters: freelancers with small clients, UK, US, EU. Data: P. Transaction Search has a transaction event code and subject, but the F&F flag is not a documented field.
11. **"Year-end paperwork is coming" card.** Date-triggered (Jan), per country: gather this export, check your platform's reporting email, store purpose-code proof. Pure information, no tax maths. Matters: US, UK, EU, India. Data: A for transaction export, N for country forms.
12. **Pay Later and recurring invoice suggestions.** Offer a recurring series for retainer clients and show the Pay Later fee tradeoff on large first invoices. Matters: US first (Pay Later), UK, Australia (Working Capital). Data: A for invoices; availability by country is N.

Reading notes for the team: items 1, 2, 3, 5, 7 are already feasible with the sandbox APIs the app uses (Invoicing, Balances, Transaction Search, Disputes, webhooks). Items 4, 6, 9, 10 need user input or a stated assumption. Whether the Balances `withheld_balance` field is populated in sandbox was not tested. Sources behind items 6 and 7 are mostly forum threads and vendor pages; cite them as "people report", not as PayPal policy.
