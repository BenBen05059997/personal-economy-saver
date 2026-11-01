# What people want, feel and fear about money advice, and what makes them act

Research note for a freelancer personal-finance app that suggests at the moment of an activity (bill arrives, client pays, tax deadline nears). First users: Japan-based freelancers paid in USD, then the US. All sources checked 2026-10-31. Survey or paper years are given each time. "Secondary" means the figure came from press coverage, not the survey's own report.

## Summary: 12 findings that should change how the app speaks, and when

1. **Education given ahead of time fades. Help given at the decision does not have to.** Financial-education programmes explain about 0.1% of the variance in behaviour and are close to zero after 20 months. The authors recommend "just-in-time" education tied to a specific decision (Fernandes, Lynch & Netemeyer 2014). The app should teach only at the moment and only about that moment.
2. **Defaults, simple choices and concrete plans beat persuasion.** Auto-enrolment raised 401(k) participation from 49% to 86% (Madrian & Shea 2001). Writing down a date and time added 4.2 points to a 33% baseline (Milkman et al. 2011). The app should offer a pre-filled action ("set aside $412 now") rather than advice to consider one.
3. **Expect small effects at scale.** Real nudge-unit trials averaged +1.4 points (+8%), against +8.7 points in published academic studies (DellaVigna & Linos 2022). Measure everything and don't over-promise.
4. **Freelancers' real pain is timing.** 58% of self-employed US adults have income that varies month to month, and 22% struggled to pay bills because of it, against 10% of employees (Fed SHED 2025). In Japan, 32.4% of freelancers had at least one month with zero income (Mynavi 2025). The moment a client pays is the moment to act.
5. **Tax is the predictable shock.** 47% of US 1099 workers set nothing aside for tax, 49% skip quarterly estimates, 40% couldn't pay the tax they owed and 63% fear owing more than expected (Independent Economy Council 2022). "Set aside X% of this payment" is the most valuable single suggestion.
6. **The young want help but don't know where to go.** 82% of Gen Z say they need advice and 76% haven't sought it. 38% don't know where to find the right adviser and 33% think they don't have enough money to need one (intelliflo/Harris 2023). An always-there, free, in-context helper fills exactly this gap.
7. **Shame and privacy are real barriers.** 40% of Americans are embarrassed by their finances and 51% think finances should stay private (CFP Board, Jan 2026). Write in a non-judgemental tone. Never compare the user with peers by default: peer information lowered saving among low savers (Beshears et al. 2015).
8. **People avoid looking when things are bad.** Logins rise on payday and fall when users are overdrawn or spending heavily (Olafsson & Pagel, "ostrich effect"). Bad-news moments need the gentlest wording and an immediate fix, not a scolding.
9. **Showing someone their own number works.** Easier access to one's own balance cut insufficient-funds fees by 38.4% (Carlin, Olafsson & Pagel 2023). App goal-setting raised saving, and "concreteness" and "monitoring" were the channels (Gargano & Rossi 2024). Seeing an age-progressed image of oneself raised hypothetical saving by about a third (Hershfield et al. 2011). Show the user's own number and forecast rather than a lecture.
10. **Nudges have side effects.** Payment reminders cut card late fees by about 14% but raised overdraft fees by about 9% (Medina 2021). Any "pay now" suggestion must check the cash buffer first.
11. **AI is used but not trusted.** About a quarter of Gen Z and Millennials who sought advice used AI, but only about 3 in 10 adults have confidence in it (3% "a great deal"), against about 8 in 10 for advisers (Gallup/Edward Jones 2026). 93% verify before acting and 57% regret acting on bad online advice (CFP Board 2025). So the app should show its working, cite the rule (tax rate, deadline) and make each number checkable.
12. **Japan specifics.** Only 8.7% have had financial education. Literacy fell to 53.8% correct, and young men overrate their own knowledge most (J-FLEC 2025). Non-investors say "no spare money" (56.7%) and "no knowledge" (40.4%), and they fear losses more than they want gains (FSA 2021). Japanese wording should say concretely what the money is for and how much stays safe, not talk about "returns".

---

## 1. What people say they want from advice

### US

| Finding | Figure | Source (survey year) |
|---|---|---|
| Need professional advice on some topic | 74% of adults; 82% Gen Z (18–26), 84% Millennials (27–42) | intelliflo / Harris Poll, fielded Apr 11–13 2023, n=2,081. https://insurancenewsnet.com/oarticle/84-of-millennials-say-they-need-financial-advice |
| Have NOT sought that advice | 76% Gen Z, 71% Millennials | same |
| Why investors hire advisers | ~60% hired for emotional reasons rather than financial ones (n=312 advised clients) | Morningstar, Labotka & Lamas, "Why People Hire Their Financial Advisors…" (2023). https://thinkadvisor.com/2023/06/20/why-clients-really-hire-advisors-study |
| What investors value | "Goals are still king"; personalised advice and the human touch | Morningstar, "What Do Investors Want From Their Advisor?" (2024), via https://thinkadvisor.com/2024/08/29/what-clients-really-want-from-their-advisors-according-to-4-studies/ |
| Emotional share of perceived value of advice | about 40–45% of perceived value is emotional (trust, peace of mind) | Vanguard, "Assessing the value of advice" (2019) and "The value of advice: assessing the role of emotions" (2020). https://corporate.vanguard.com/content/corporatesite/us/en/corp/who-we-are/pressroom/Press-Release-Vanguard-Measures-Emotional-Value-of-Advice-04012020.html ; https://www.fa-mag.com/news/nearly-half-of-the-value-of-financial-advice-is-emotional-51656.html |
| Peace of mind and time | 86% of advised clients report more peace of mind; 76% say advice saves time (median 2 h/week); high financial stress 14% advised vs 27% self-directed | Vanguard, "The emotional and time value of advice" (June 2025; survey July 2024, n=12,443). https://workplace.vanguard.com/content/dam/inst/iig-transformation/insights/pdf/2025/corporate/the_emotional_and_time_value_of_advice.pdf |
| Human vs digital emotional benefit | More positive emotions: 71% human-advised vs 47% digital. Fewer negative emotions: 79% vs 57%. 85% of digital-advice users did not feel ashamed using the service | same Vanguard 2025 |
| Gen Z with an adviser | 63% of Gen Z with an adviser report financial strength vs 42% without | Northwestern Mutual Planning & Progress 2025 (Harris, Jan 2–19 2025, n=4,626). Secondary: https://insurancenewsnet.com/oarticle/americans-trust-advisors-more-than-ai-for-financial-advice |

**Top questions and goals by age (under 35).** No survey here gave a clean ranked list of the "top questions" by age band. What the sources do show:
- **The goals young people name most often:** emergency savings, debt and investing. The 2024 NFCS shows that emergency savings fell from 53% (2021) to 46% (2024), and that 18–34s gained the most on the inflation question (+10 points). https://www.finra.org/investors/insights/finra-foundation-national-study-financial-prosperity-eludes-many-americans-despite-economy (published 2025-07-22).
- **Where they start:** first stop for money advice is a professional for 26% of all adults, 39% of Boomers but only 14% of Gen Z. 5% start on social media, and Gen Z is 9x as likely as Boomers to start there. Policygenius / YouGov, fielded Oct 16–19 2023, n=4,063, released June 2024. https://prnewswire.com/news-releases/gen-z-is-65-less-likely-than-boomers-to-turn-to-financial-professionals-first-for-advice-302175152.html
- **Who Gen Z trusts most:** family (29%) slightly ahead of a financial adviser (26%) (Northwestern Mutual 2025, secondary, same link as above).
- **Japan (FP consultations):** at the Japan FP Association's free consultation desk, the top themes in FY2023 were life planning, investing financial assets and household budgeting. Users were mostly in their 30s to 50s, about 80% of them, and few were in their 20s. https://kyodonewsprwire.jp/release/202407083252

### Japan

| Finding | Figure | Source (year) |
|---|---|---|
| Literacy quiz (25 true/false questions) | 53.8% correct, down from the 2022 survey (−1.9 pt). Men 56.8%, women 50.9% | J-FLEC Financial Literacy Survey 2025 (fielded Sep 26–Oct 17 2025, n=30,000, ages 18–79; published Mar 2026). Summaries: https://www.jri.co.jp/report/research/detail/16606/ ; https://www.dlri.co.jp/report/asset/598647.html (the J-FLEC PDF returned 403: https://www.j-flec.go.jp/wpimages/uploads/25lite_point.pdf) |
| Received financial education | 8.7% (+1.6 pt). People who had it scored higher, and their scores rose while the others' fell | JRI note 2026-04-09, same link |
| Overconfidence among the young | Ages 18–29: the gap between measured and self-rated literacy is −34.0 pt for men and −19.7 pt for women (self-rating exceeds tested knowledge) | DLRI Flash Insights 2026-05-12, same link |
| Young people entering investing | Investing experience has grown fastest among people in their 30s and younger since the 2024 NISA expansion | same (qualitative) |
| Main information source on investing | SNS is the top source (33%) | HuffPost Japan survey of 1,000 people (date not confirmed). https://webtan.impress.co.jp/r/prtimes/items/000000173.000019238 ; Fidelity Japan 2022: online, SNS and YouTube are the most common sources, especially for the young. https://retirement.fidelity.co.jp/media/PDFs/WI/report_20220920.pdf |

## 2. Why people do not seek advice

| Barrier | Figure | Source (year) |
|---|---|---|
| Cost | 44% of the unadvised think an adviser is too expensive; 50% of consumers overestimate what advisers cost | MagnifyMoney (2021, n=1,552). https://www.magnifymoney.com/news/financial-advisors-cost-survey/ |
| Cost, "not enough assets", unsure how it helps, distrust | 46% cost, 36% assets too small, 26% unsure how an adviser could help, 16% distrust advisers | Financial Engines survey of 401(k) participants (article 2019). https://www.napa-net.org/news/2019/2/most-non-advised-want-advisor-/ |
| Don't know where to find one | 38% of Gen Z, 27% of Millennials | intelliflo/Harris 2023 (link above) |
| "Not enough money to need one" | 33% of Gen Z, 31% of Millennials | same |
| Don't know where to find one (college students) | 64% | CFP Board study of college students (2026, secondary). https://www.investmentnews.com/practice-management/gen-z-college-students-hungry-for-financial-guidance-cfp-board-finds/265467 |
| Shame and privacy | 40% are embarrassed about their finances; 51% think finances should stay private; 71% would be comfortable with a *trusted, independent* adviser if they had access to one | CFP Board, fielded Jan 12–13 2026, ages 25–64 (press release Mar 2026). https://www.businesswire.com/news/home/20260317552834/en/ ; https://www.investmentnews.com/practice-management/surveys-show-silent-money-strains-reshaping-client-behavior/265783 |
| Embarrassment (UK, young people) | Top reasons for not talking about money: embarrassed about their own situation (35%), worried about comparison (31%), "don't know enough" (12%) | Citizens Advice (year not confirmed), via https://planetradio.co.uk/greatest-hits/kent/news/money-young-adults-cost-of-living-kent/ |
| Japan: why non-investors don't buy risk products | No spare money 56.7%, no investing knowledge 40.4%, anxious about buying or holding 26.3%, prefer principal-guaranteed 23.7%. Focus is on avoiding losses, not on growth. 10.7% intend to buy in future (20s 26.3%, 30s 23.2%) | FSA customer-attitude survey on risk-product sales (Jan 2021, n=9,829; published 2021-06-30), via DLRI: https://www.dlri.co.jp/report/macro/340846.html |
| Time | Not quantified as a barrier in the surveys found. Proxy: workers spend 3.8 h/week distracted by financial stress (Vanguard 2025) | Vanguard 2025 link above |

## 3. What people trust: human vs app vs AI

| Finding | Figure | Source (year) |
|---|---|---|
| Trust humans more than AI | Asking a financial question: 55% humans, 15% AI. Retirement plan 56% vs 13%. Budget tracking 48% vs 18% (AI does best on mechanical tasks) | Northwestern Mutual P&P 2025 (Jan 2025, n=4,626). https://news.northwesternmutual.com/2025-08-05-Human-Connection-Over-Machines-Americans-Trust-Advisors-More-Than-AI-for-Financial-Advice,-Finds-Northwestern-Mutuals-2025-Planning-Progress-Study |
| Want an adviser who uses AI | 54% of Gen Z and Millennials, 46% Gen X, 36% Boomers+ | same |
| Used AI for financial advice | About 1 in 5 of those who sought advice in the past year. About a quarter of Gen Z and Millennials vs 16% of Gen X and 7% of Boomers. Only about a third used a professional; 73% relied on their own internet research (that figure appears in only one syndicated version) | Gallup / Edward Jones, fielded Mar 20–Apr 6 2026, n=5,075 (AP, 2026-08-07). https://wtop.com/news/2026/08/some-us-adults-are-using-ai-for-financial-guidance-but-few-trust-it-gallup-poll-finds/ |
| Confidence in AI vs advisers | About 3 in 10 have at least "some" confidence in AI (3% "a great deal"); about 8 in 10 for financial advisers | same |
| Interest in AI advice by age | 20% overall (59% no). 18–34: 30%; 35–54: 23%; 55+: 8%. Men 25%, women 14% | FINRA Foundation NFCS 2024 (published July 2025), secondary: https://www.investmentexecutive.com/news/research-and-markets/one-fifth-of-investors-open-to-robo-advice-u-s-study |
| What people check afterwards | 93% validate financial info before acting: about a third do their own research and about a third ask an adviser. 45% question online info 5 or more times a month. 57% made a decision they regretted because of online misinformation (64% of under-45s vs 45% of older). 1 in 3 delayed a decision because of it | CFP Board "Steering Clear of Financial Misinformation", fielded Apr 2025, ages 25–64, income >$50k. https://www.investmentnews.com/practice-management/americans-spend-more-time-fact-checking-online-financial-advice-as-regrets-mount-cfp-board-finds/261619 ; https://www.cfp.net/news/2025/06/americans-getting-burned-by-online-money-advice |
| Trust in advisers | 43% trust financial advisers for advice, ahead of friends and family, websites and social media | CFP Board 2026 (secondary, via search summary) |
| Japan: generative-AI use | 58.8% had used generative AI in FY2025 (26.7% the year before) | MIC White Paper on Information and Communications, via DLRI: https://www.dlri.co.jp/report/asset/654775.html |
| Japan: AI for money | 69.4% of Money Forward ME users who use generative AI privately have asked it about household finances or investing. Top uses: how to start investing or pick stocks (50.4%), future and retirement simulations (46.1%). Not nationally representative; date not confirmed | https://news.infoseek.co.jp/article/prtimes_000001676_000008962/ |
| Japan: final decisions | Fewer than 10% of investors want AI to make the *final* investment decision, though 81.9% are positive about consulting it on household finances (n=199, small sample) | https://news.infoseek.co.jp/article/prtimes_000000030_000034273/ |

Other AI figures seen only in press coverage, with unclear dates or framing: a TD Bank survey with large jumps in LLM use for money (https://www.americanbanker.com/news/more-americans-asking-ai-for-financial-advice-td-survey), and Nationwide (25% of investors trust AI chatbot advice). Treat these as indicative only.

## 4. What people do with advice: the behaviour gap, education decay, just-in-time help, nudges

**The behaviour gap.** In the 10 years to Dec 2024, the average dollar in US funds earned 7.0% a year against 8.2% for the funds themselves, a gap of about 1.2 pt a year (≈15% of gains). Morningstar *Mind the Gap 2025*: https://www.morningstar.com/business/insights/research/mind-the-gap-2025. The 2026 edition again found about 1.2 pt. A May 2026 *Financial Analysts Journal* paper disputes this, putting the cost of bad timing at only about 0.10% a year: https://rpc.cfainstitute.org/research/financial-analysts-journal/2026/bad-timing-does-not-cost-investors-funds-returns. Treat the size of the gap as contested.

**Education decays.**
- Fernandes, Lynch & Netemeyer (2014), *Management Science* 60(8). Meta-analysis of 168 papers covering 201 studies. Interventions explain about 0.1% of the variance in financial behaviour, with weaker effects for low-income groups. Even large programmes have negligible effects 20 months or more later. The authors recommend "just-in-time" education tied to a specific behaviour. https://papers.ssrn.com/abstract=2333898
- Counterpoint: Kaiser, Lusardi, Menkhoff & Urban (2022), *JFE* 145(2). A meta-analysis of 76 RCTs (>160k people) finds positive causal effects on knowledge and behaviour, comparable to education in other fields, and robust to publication bias. https://econpapers.repec.org/RePEc:eee:jfinec:v:145:y:2022:i:2:p:255-272
- How to read the two together: education can work, but its effect is small and fades. Timing it to the decision is the cheapest way to make it count.

**Defaults and commitment.**
- Madrian & Shea (2001), *QJE*. Auto-enrolment raised new-hire 401(k) participation from 49% to 86% (US Treasury summary: https://home.treasury.gov/system/files/136/archive-documents/autoenroll.doc). The often-quoted "37%" baseline comes from a comparison with a different cohort and was not re-verified here. Paper: https://www.nber.org/papers/w7682
- Thaler & Benartzi (2004), *JPE*, "Save More Tomorrow" (pre-commit to save more from future raises). The paper's abstract is widely cited as savings rising from 3.5% to 13.6% over 40 months for participants, with 78% of those offered joining. **I could not open the primary page** (certificate error), and one secondary summary gives 4.4% to 10.6%. Verify before quoting. Page: https://www-apache.anderson.ucla.edu/faculty_pages/shlomo.benartzi/savemore.htm

**Reminders.**
- Karlan, McConnell, Mullainathan & Zinman (2016), *Management Science* 62(12). Reminders raised attainment of commitment-savings goals at three banks. Messages naming the *specific goal* plus the incentive worked best. **Gain vs loss framing made no significant difference.** Extra late reminders added nothing. https://econpapers.repec.org/RePEc:nbr:nberwo:16205 (The often-quoted "+6%, +16% when goal mentioned" figures were not verified in this pass.)
- Milkman et al. (2011), *PNAS*. A prompt to write down the date *and time* of a flu shot raised vaccination by 4.2 pt on a 33.1% baseline. A date-only prompt (+1.5) was not significant. https://www.nber.org/papers/w17183

**In-app and fintech evidence (2017–2024).**
- Carlin, Olafsson & Pagel (2023), *Review of Finance* 27(3) (Meniga app, Iceland). Making one's own financial information cheaper to access cut insufficient-funds fees by 38.4% within 24 months. Results for overdraft interest and late fees were mixed. https://business.rice.edu/wisdom/can-mobile-banking-app-really-save-you-money
- Gargano & Rossi (2024), *Journal of Finance* 79(3). Randomised beta access to goal-setting in a fintech app raised saving. It did not displace saving elsewhere, helped those least likely to save, and worked through "monitoring and concreteness". https://econpapers.repec.org/RePEc:bla:jfinan:v:79:y:2024:i:3:p:1931-1976
- Medina (2021), *Review of Financial Studies* 34(5) (Brazilian personal-finance platform). Card payment reminders cut late fees by about 14% but raised overdraft fees by about 9%, mostly among people with a history of overdrafts. https://ideas.repec.org/a/oup/rfinst/v34y2021i5p2580-2607..html
- DellaVigna & Linos (2022), *Econometrica* 90(1). 126 nudge-unit RCTs averaged +1.4 pt (+8.0% on a 17.3% baseline), against +8.7 pt (+33%) in published academic studies. About 70% of the gap comes from publication selection. https://www.nber.org/papers/w27594
- **Not found:** peer-reviewed RCTs on Acorns, Chime or Mint nudges, or on Japanese apps.

## 5. Emotions: anxiety, avoidance, numbers vs lectures

| Finding | Figure | Source (year) |
|---|---|---|
| Financial uncertainty → depressed or anxious | Nearly 70% of Americans. Kept up at night at least monthly: Gen Z 53%, Millennials 50%. Physical illness from money worry: 40% overall, 56% Gen Z, 53% Millennials | Northwestern Mutual P&P 2025 (Jan 2025). https://news.northwesternmutual.com/2025-06-03-Nearly-70-of-Americans-Say-Financial-Uncertainty-Has-Made-Them-Feel-Depressed-and-Anxious,-According-to-Northwestern-Mutual-2025-Planning-Progress-Study |
| Money hurts mental health | 43% at least sometimes (2025), down from 47% (2024) and 52% (2023). By generation in the 2023 wave: Gen X 60%, Millennials 55%, Gen Z 52%, Boomers 45% (secondary, NBC) | Bankrate, fielded Mar 19–21 2025, n=2,363. https://www.bankrate.com/banking/money-and-mental-health-survey/ ; https://www.nbcnews.com/business/consumer/financial-wealth-and-mental-health-americans-worried-about-money-rcna83569 |
| Financially anxious | 60% of US adults anxious, 50% stressed. Highest among the young, women and low-income | GFLEC/FINRA using NFCS 2018 (report 2021). https://gflec.org/wp-content/uploads/2021/04/Anxiety-and-Stress-Report-GFLEC-FINRA-FINAL.pdf |
| Doing at least okay financially (by age) | 18–29: 63%; 30–44: 68%; 45–59: 74%; 60+: 83%. Three months of savings: 18–29 37% vs 60+ 71% | Fed SHED 2025 (fielded Oct 2025, published 2026-05-13). https://www.federalreserve.gov/publications/files/2025-report-economic-well-being-us-households-202605.pdf |
| $400 emergency | 63% would cover it with cash or equivalent (unchanged 3 years; 68% in 2021) | same |
| Japan, young people | "Can't see economic room or prospects": 56.0% of 20–29s (secondary, Cabinet Office social-attitudes survey, around 2020). https://gentosha-go.com/articles/-/37484 . Older Cabinet Office white paper (2012): 82.9% of 15–29s worried about earning enough income | low confidence, dated |

**Avoidance (the "ostrich effect").** Olafsson & Pagel (NBER w23945 / CEPR DP12259, 2017) used daily logins to a financial app. People log in more when they get paid (using paydays shifted by weekends and holidays), and less when spending is high or they are overdrawn. https://ideas.repec.org/r/nbr/nberwo/23945.html. The term itself comes from Karlsson, Loewenstein & Seppi (2009), *J. Risk & Uncertainty*, where investors check portfolios less when markets fall (well known; not re-fetched here).

**Showing a forecast or number vs giving a lecture.**
- Carlin et al. (above): cheaper access to *one's own* numbers changed behaviour (−38.4% NSF fees).
- Gargano & Rossi (above): "concreteness" and "monitoring" were the channels.
- Hershfield et al. (2011), *JMR*. People shown an age-progressed image of themselves put about 33% more into retirement in hypothetical allocations (not real money). https://www.stern.nyu.edu/experience-stern/faculty-research/hershfield-retirement-savings
- No head-to-head RCT of "forecast number vs written lecture" in a money app was found.

## 6. Freelancers and gig workers

| Finding | Figure | Source (year) |
|---|---|---|
| Income varies month to month | Self-employed 58% vs 28% of employees. Struggled to pay bills because income varied: 22% vs 10%. All adults: 30% vary, 11% hardship | Fed SHED 2025 (Oct 2025). https://www.federalreserve.gov/publications/files/2025-report-economic-well-being-us-households-202605.pdf |
| Tax unpreparedness | 40% can't pay this year's tax; 47% don't set aside monthly; 49% don't pay quarterly estimates; 63% worry they'll owe more than expected; 46% fear an audit | Independent Economy Council, Mar 2022, n=1,003 (most income from 1099 work). https://www.newswire.com/news/new-report-finds-40-of-1099-workers-do-not-have-enough-money-to-pay-21683363 |
| Earlier waves | 2020: 40% not setting aside, 42% skip quarterly payments (Abound). 2017: 59% don't make quarterly payments, and 17% of those didn't know what estimated tax is (Everlance) | via https://reedcorp.tax/helpful-guides/freelancer-tax-report/ and https://www.cnbc.com/2018/01/17/gig-job-workers-had-better-beware-of-pay-as-you-go-tax-payments.html |
| Japan: income swings | Average best month ¥570k vs worst month ¥128k; 32.4% had a month with zero income. Satisfied with income: 25.4% (42.4% dissatisfied); overall satisfaction 59.6% | Mynavi freelance survey 2025 (Aug 23–26 2025, n=1,000). https://career-research.mynavi.jp/reserch/20251021_103453/ |
| Japan: size and satisfaction | 13.03M freelancers; only 32.0% satisfied with income. Social-security gaps flagged as an issue | Lancers freelance survey 2024 (n=2,929, published 2025-03-24). https://atmarkit.itmedia.co.jp/ait/articles/2503/26/news082.html |
| Japan: government survey | About 4.62M freelancers (broad definition); 37.7% had trouble with clients (e.g., payment) | Cabinet Secretariat freelance survey (Feb–Mar 2020, n=7,478). https://www.rodo.co.jp/news/91636/ ; https://kantei.go.jp/jp/singi/keizaisaisei/miraitoshikaigi/suishinkaigo2018/koyou/report.pdf |
| Japan: late payment | 45.0% had experienced late payment (smaller private survey) | via https://career-research.mynavi.jp/reserch/20251021_103453/ search summary; not independently confirmed |

**Not found:** any survey of Japan-resident freelancers paid in foreign currency (USD exchange-rate timing, foreign-income tax filing). The latest Upwork *Freelance Forward* and MBO *State of Independence* figures on money worries were not retrieved.

## 7. What makes people act on a suggestion

| Lever | Evidence | Strength |
|---|---|---|
| **Default / pre-filled action** | Auto-enrolment 49%→86% (Madrian & Shea 2001) | Strong |
| **Concrete plan / specificity** | Date-and-time prompt +4.2 pt; date-only n.s. (Milkman et al. 2011). Goal-specific reminders worked best (Karlan et al. 2016). "Concreteness" is a channel of goal-setting (Gargano & Rossi 2024) | Strong |
| **Moment of decision (just-in-time)** | Education fades, and the recommendation is to tie it to a specific decision (Fernandes et al. 2014). Logins peak on payday (Olafsson & Pagel) | Moderate (inferred) |
| **Own numbers made easy to see** | −38.4% NSF fees (Carlin et al. 2023) | Moderate–strong |
| **Vivid future self / forecast** | +~33% hypothetical retirement allocation (Hershfield et al. 2011) | Moderate (hypothetical outcomes) |
| **Pre-commitment to the future** | Save More Tomorrow (Thaler & Benartzi 2004); figures not re-verified | Strong (classic) |
| **Social proof** | Peer savings info *reduced* saving among low savers because of discouragement (Beshears et al. 2015, *JF* 70(3)). https://econpapers.repec.org/RePEc:bla:jfinan:v:70:y:2015:i:3:p:1161-1201 | Risky: backfires for people behind their peers |
| **Loss framing** | Gain vs loss framing in savings reminders made no significant difference (Karlan et al. 2016). Japanese non-investors fear loss more than they want gain (FSA 2021), so framing around safety matters | Weak as a lever; tone matters |
| **One tap** | Simplified "Quick Enrollment" raised savings-plan participation (Choi, Laibson & Madrian 2009; cited in Beshears et al. 2015). Exact effect not verified here | Moderate |
| **Number in the user's own currency** | **No direct study found.** Closest: concreteness (Gargano & Rossi), own-information effect (Carlin et al.) | Not found |
| **Deadline** | Single-day clinics made planning prompts most effective (Milkman et al. 2011). No fintech-specific deadline RCT found | Weak–moderate |
| **Expected effect size** | Field nudges average +1.4 pt (DellaVigna & Linos 2022) | Calibrates expectations |

## Implications for an app that suggests at the moment of activity

1. **Trigger on cash-in, not on the calendar.** When a client payment lands, suggest the tax set-aside right away, with a specific amount and percentage in the currency the user thinks in. For Japan-USD users, show the yen figure and say which FX rate was used. The evidence: payday attention, SHED income variability, and 47% not setting tax aside.
2. **One suggestion, one number, one tap, one reason.** For example: "Move ¥58,000 (20%) to Tax. Your 1st prepaid-tax instalment (予定納税) is due 31 Jul." Pre-fill it so the default is to act, and allow undo.
3. **Check the buffer before any "pay now" or "save now" nudge** (Medina's side effect). Never push a transfer that risks an overdraft or a missed rent payment.
4. **Use a planning prompt for deadlines.** Ask "When will you file? Pick a date", then schedule one reminder that names the goal. Don't repeat reminders (Karlan: extra reminders added nothing).
5. **Show the user's own forecast, not a lesson.** For example: "At this pace your tax pot will be ¥X short in March." Keep any explanation to one line under the number, and offer a "why?" expander for verification (93% verify, and AI trust is low).
6. **Show the working on every number.** Give the rule, the rate, the date and the source (NTA or IRS link). Use AI to draft, but present results as calculation plus citation, never as an unexplained verdict.
7. **Be shame-free and private by default.** No peer comparisons for users who are behind. Use a neutral tone on bad-news screens, and lead with the fix when balances are low (ostrich effect).
8. **In Japan, frame around safety and purpose ("keep ¥X safe for taxes and pension"), not returns.** Explain terms in one line, because only 8.7% have had financial education and the young overrate their own knowledge.
9. **Treat education as context, never as a course.** Every tip should be tied to the event in front of the user. Lessons given ahead of time fade.
10. **Measure lift honestly.** Expect single-digit point effects (+1.4 pt is the field average). A/B test each suggestion type and track any side effects, such as other fees or missed bills.

## Not found / not verified

- 2024 NFCS anxiety figures by age (only the 2018-wave anxiety data was found; the 2024 AI-interest-by-age figures are secondary).
- CFP Board, Bankrate or NerdWallet ranked lists of the "top money questions" by age band; Pew data on financial advice or AI-for-money.
- The Japan FP Association "life and money" survey (くらしとお金に関する調査) figures; Cabinet Office world-youth-survey (2018) money items; MUFG or Nomura young-investor survey figures.
- J-FLEC 2025 figures on advice-seeking and who people consult (the primary PDF returned 403).
- Effect sizes for Karlan et al. reminders (+6% / +16%) and the Save More Tomorrow 3.5%→13.6% figures (both are widely cited but not re-verified here).
- Fintech RCTs with Acorns, Chime, Mint or Japanese apps; any study comparing a forecast number with a lecture head-to-head; any study on showing amounts in the user's home currency.
- Surveys of Japan-based freelancers paid in USD; the 2024–2025 Upwork, Freelancers Union and MBO money-worry figures.
