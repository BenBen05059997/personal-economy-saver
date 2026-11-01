import type { Context, Formula, Profile, Valued } from "../types";

// One entry per move in src/data/catalogue/us.json, keyed by move id.
// Figures come from research/wealth-moves/united-states.md and were re-checked against primary sources on Nov 1, 2026
// (research/catalogue/verification-us.md has the page for each one).

// ---------------------------------------------------------------------------------------------
// Federal tax approximation for a single filer, tax year 2026. It exists to price moves, not to
// prepare a return: no state tax, no credits, no itemising, no other income.
//
//   SE tax          15.3% of 92.35% of profit; the Social Security part stops at the $184,500 wage base
//   AGI             profit - half of SE tax - pre-tax retirement already being saved
//   Standard ded.   $16,100 (single, 2026)
//   QBI             the smaller of 20% x (profit - half SE tax) and 20% x taxable income before QBI,
//                   with a $400 minimum when qualified income is at least $1,000
//   Income tax      2026 single-filer brackets, Rev. Proc. 2025-32 Table 3 (IRB 2025-45, checked Nov 1, 2026):
//                   10% to $12,400, 12% to $50,400, 22% to $105,700, 24% to $201,775, 32% to $256,225,
//                   35% to $640,600, 37% above. Not modelled: the QBI income-threshold limits, the Additional
//                   Medicare Tax, W-2 wages that use up the Social Security wage base.
//
// For $60k profit this returns SE tax $8,478, AGI $55,761, taxable income $31,729 (the research
// says about $31,700) and total federal tax $12,037 (research: about $12,000).
// ---------------------------------------------------------------------------------------------

const SE_RATE_SS = 0.124;
const SE_RATE_MEDICARE = 0.029;
const SE_BASE_FACTOR = 0.9235;
const SS_WAGE_BASE_2026 = 184_500;
const STANDARD_DEDUCTION_2026 = 16_100;
const QBI_MINIMUM = 400;
const BRACKETS_2026_SINGLE: [number, number][] = [
  [12_400, 0.1],
  [50_400, 0.12],
  [105_700, 0.22],
  [201_775, 0.24],
  [256_225, 0.32],
  [640_600, 0.35],
  [Infinity, 0.37],
];
// A pre-tax deduction also shrinks the QBI deduction by 20% of itself, so it saves 0.8 x the rate.
const QBI_INTERACTION = 0.8;

const SELF_ONLY_HSA_LIMIT_2026 = 4_400;
const ROTH_IRA_LIMIT_2026 = 7_500;
const SOLO_401K_EMPLOYEE_LIMIT_2026 = 24_500;
const SOLO_401K_TOTAL_LIMIT_2026 = 72_000;
const EXAMPLE_PRETAX_CONTRIBUTION = 10_000; // the research's "realistic" contribution
// 100% FPL used for 2026 coverage is the 2025 HHS guideline, $15,650; 400% = $62,600 (ASPE, IRS PTC Q&A).
// 2027 coverage uses the 2026 guideline, $15,960 (400% = $63,840), and a top rate of 10.22% (Rev. Proc. 2026-26).
const FPL_2026_COVERAGE = 15_650;
const PTC_CLIFF_2026 = 4 * FPL_2026_COVERAGE;
const PTC_APPLICABLE_PCT_TOP = 0.0996; // 300%-400% FPL, benchmark silver plan
const EXAMPLE_BENCHMARK_PREMIUM = 7_200; // research example for age ~40; the user's own is not known
const EXAMPLE_SE_HEALTH_PREMIUMS = 5_000; // research example
const UNDERPAYMENT_RATE = 0.07; // IRS rate for Q3 and Q4 2026 (Q1 2026 7%, Q2 2026 6%); Q1 2027 not yet announced
const ESTIMATED_TAX_DUE_2026 = ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]; // Pub 505 (2026)
const RETURN_DUE_2027 = "2027-04-15"; // the date all tax is assumed paid if nothing was paid in instalments
const HYSA_APY = 0.04; // cautious: the best online rates listed Oct 26, 2026 were 4.27% to 4.40%
const NATIONAL_AVG_SAVINGS = 0.0038; // FDIC national rate, savings, Oct 19, 2026
const CARD_APR = 0.2236; // Federal Reserve G.19, accounts assessed interest, Aug 2026 (preliminary)
const BACKUP_WITHHOLDING = 0.24;
const SET_ASIDE_RATE = 0.25; // low end of the 25%-30% guide
const FREE_FILE_AGI_CAP = 89_000; // 2026 season (income for 2025); IRS's page now shows $95,000, season opens Jan 2027
const FREE_FILE_UPSELL_LOW = 120; // low end of the anecdotal $120-$200; no vendor page shows a price without signing in
const BANK_BONUS_TYPICAL = 300; // median of 20 bonuses in one published 2025 tally (range $100 to $900)
const CARD_BONUS_POINTS = 75_000;
const CARD_POINT_VALUE = 0.01;
const CARD_ANNUAL_FEE = 95;
const UNCLAIMED_REFUND_MEDIAN = 686; // IRS median for tax year 2022, before credits (IR-2026-37); no 2023 figure yet
const IRS_2023_REFUND_EXPIRY = "2027-04-15"; // three years after the Apr 15, 2024 due date

type TaxEstimate = {
  profit: number;
  seTax: number;
  agi: number; // also the MAGI used for the marketplace credit
  taxableBeforeQbi: number;
  qbi: number; // the deduction
  qualifiedIncome: number;
  taxable: number;
  incomeTax: number;
  totalTax: number;
  marginal: number; // rate on the next dollar of taxable income
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

function seTax(profit: number): number {
  const base = Math.max(0, profit) * SE_BASE_FACTOR;
  return SE_RATE_SS * Math.min(base, SS_WAGE_BASE_2026) + SE_RATE_MEDICARE * base;
}

function bracketTax(taxable: number): { tax: number; marginal: number } {
  let tax = 0;
  let floor = 0;
  let marginal = BRACKETS_2026_SINGLE[0][1];
  for (const [top, rate] of BRACKETS_2026_SINGLE) {
    if (taxable <= floor) break;
    tax += (Math.min(taxable, top) - floor) * rate;
    marginal = rate;
    floor = top;
  }
  return { tax, marginal };
}

function estimate(p: Profile): TaxEstimate {
  const profit = Math.max(0, p.annualRevenue - p.annualExpenses);
  const se = seTax(profit);
  const agi = Math.max(0, profit - se / 2 - p.retirementMonthly * 12);
  const taxableBeforeQbi = Math.max(0, agi - STANDARD_DEDUCTION_2026);
  const qualifiedIncome = Math.max(0, profit - se / 2 - p.retirementMonthly * 12);
  let qbi = Math.min(0.2 * qualifiedIncome, 0.2 * taxableBeforeQbi);
  if (qualifiedIncome >= 1_000) qbi = Math.max(qbi, Math.min(QBI_MINIMUM, taxableBeforeQbi));
  const taxable = Math.max(0, taxableBeforeQbi - qbi);
  const { tax, marginal } = bracketTax(taxable);
  return { profit, seTax: se, agi, taxableBeforeQbi, qbi, qualifiedIncome, taxable, incomeTax: tax, totalTax: tax + se, marginal };
}

// The bill moment carries a free-text label ("Zilker Valley Power $142, due Dec 3"), and a bill event has no category yet,
// so a medical bill is recognised by event.kind "medical_bill", or by a healthcare word in a "bill" label.
const MEDICAL_WORDS =
  /\b(medical|hospital|clinic|doctor|physician|urgent care|ambulance|radiology|laborator(?:y|ies)|dental|dentist|orthodont\w*|surgery|surgical|anesthesi\w*|pathology|physical therapy|pediatric\w*|cardiology|dermatology|health\s?(?:system|care|center)|medicine)\b/i;
const isMedicalBill = (c: Context): boolean =>
  c.event?.kind === "medical_bill" || (c.event?.kind === "bill" && MEDICAL_WORDS.test(c.event.label));

const isFreelancer = (p: Profile) => p.work === "freelancer" || p.work === "both";
const SCHEDULE_C_REASON = "needs self-employment income filed on Schedule C";
const needsScheduleC = (p: Profile): true | string =>
  isFreelancer(p) && p.filing === "us_schedule_c" ? true : SCHEDULE_C_REASON;

function value(amount: number, per: Valued["per"], basis: string): Valued {
  return { amount: Math.round(amount), currency: "USD", per, basis };
}

export const usFormulas: Record<string, Formula> = {
  // The credit you would lose by crossing the 400% line, or the credit you could win back.
  "us-ptc-cliff": {
    eligible: (p) => {
      if (p.healthInsurance !== "us_marketplace") return "only for people buying a marketplace plan";
      const t = estimate(p);
      if (t.agi < 3 * FPL_2026_COVERAGE) return "income is under 300% of the poverty line, where the credit uses a different percentage than the research covers";
      if (t.agi > PTC_CLIFF_2026 + 15_000) return "income is far above the 400% line";
      return true;
    },
    value: (p) => {
      const magi = estimate(p).agi;
      const gap = PTC_CLIFF_2026 - magi;
      if (gap >= 0) {
        const credit = Math.max(0, EXAMPLE_BENCHMARK_PREMIUM - PTC_APPLICABLE_PCT_TOP * magi);
        return value(
          credit,
          "year",
          `Your income for the credit (MAGI) is about ${usd(magi)}, ${usd(gap)} under the ${usd(PTC_CLIFF_2026)} line. An example benchmark premium of ${usd(EXAMPLE_BENCHMARK_PREMIUM)} minus ${pct(PTC_APPLICABLE_PCT_TOP, 2)} of MAGI leaves ${usd(credit)} a year to protect.`,
        );
      }
      const atLine = Math.max(0, EXAMPLE_BENCHMARK_PREMIUM - PTC_APPLICABLE_PCT_TOP * PTC_CLIFF_2026);
      return value(
        atLine,
        "year",
        `Your MAGI of about ${usd(magi)} is ${usd(-gap)} over the ${usd(PTC_CLIFF_2026)} line, so the credit is $0. At least ${usd(-gap)} of pre-tax retirement or HSA money would bring about ${usd(atLine)} a year back (example premium ${usd(EXAMPLE_BENCHMARK_PREMIUM)}).`,
      );
    },
  },

  "us-solo-401k-or-sep": {
    eligible: (p) => {
      const ok = needsScheduleC(p);
      if (ok !== true) return ok;
      return p.retirementAccount ? "already saving into a Solo 401(k), SEP or similar" : true;
    },
    value: (p) => {
      const t = estimate(p);
      const employerPart = 0.2 * (t.profit - t.seTax / 2);
      const room = Math.min(SOLO_401K_EMPLOYEE_LIMIT_2026 + employerPart, SOLO_401K_TOTAL_LIMIT_2026);
      const contribution = Math.min(EXAMPLE_PRETAX_CONTRIBUTION, room);
      const saved = contribution * t.marginal * QBI_INTERACTION;
      return value(
        saved,
        "year",
        `A ${usd(contribution)} pre-tax contribution at your ${pct(t.marginal)} bracket x ${QBI_INTERACTION} saves about ${usd(saved)} of federal tax and lowers MAGI by ${usd(contribution)}. Your Solo 401(k) room is about ${usd(room)}; a SEP's is about ${usd(employerPart)}.`,
      );
    },
  },

  "us-qbi-deduction": {
    eligible: needsScheduleC,
    value: (p) => {
      const t = estimate(p);
      const saved = t.qbi * t.marginal;
      return value(
        saved,
        "year",
        `20% of the smaller of ${usd(t.qualifiedIncome)} of qualified income and ${usd(t.taxableBeforeQbi)} of taxable income before the deduction is ${usd(t.qbi)}, x ${pct(t.marginal)} = ${usd(saved)} off federal tax.`,
      );
    },
  },

  "us-se-health-insurance-deduction": {
    eligible: (p) => {
      const ok = needsScheduleC(p);
      if (ok !== true) return ok;
      return p.healthInsurance === "us_marketplace" || p.healthInsurance === "none" ? true : "only if you pay your own premiums";
    },
    value: (p) => {
      const t = estimate(p);
      const saved = EXAMPLE_SE_HEALTH_PREMIUMS * t.marginal * QBI_INTERACTION;
      return value(
        saved,
        "year",
        `${usd(EXAMPLE_SE_HEALTH_PREMIUMS)} of premiums (the research's example; use your net premium) x ${pct(t.marginal)} x ${QBI_INTERACTION} saves about ${usd(saved)} of federal tax.`,
      );
    },
  },

  "us-hsa-bronze-plan": {
    eligible: (p) =>
      p.healthInsurance === "us_marketplace" || p.healthInsurance === "none"
        ? true
        : "needs an HSA-eligible plan (high-deductible, or bronze or catastrophic on the marketplace)",
    value: (p) => {
      const t = estimate(p);
      const saved = SELF_ONLY_HSA_LIMIT_2026 * t.marginal * QBI_INTERACTION;
      return value(
        saved,
        "year",
        `If your plan is bronze, catastrophic or another HSA-eligible plan: ${usd(SELF_ONLY_HSA_LIMIT_2026)} x ${pct(t.marginal)} x ${QBI_INTERACTION} = ${usd(saved)} of federal tax saved, and MAGI falls by ${usd(SELF_ONLY_HSA_LIMIT_2026)}.`,
      );
    },
  },

  // The value is only the interest forgone on withheld cash; the point of the card is the rule.
  "us-1099k-no-form-still-taxed": {
    eligible: (p) => (isFreelancer(p) ? true : "only for people paid as freelancers"),
    value: (p, c) => {
      const payment = c.event?.amount ?? p.annualRevenue / 12;
      const held = payment * BACKUP_WITHHOLDING;
      const days = Math.max(0, daysBetween(c.today, "2027-04-15"));
      const lost = held * HYSA_APY * (days / 365);
      return value(
        lost,
        "once",
        `If PayPal lacked a correct tax ID it would hold back ${pct(BACKUP_WITHHOLDING)} of a ${usd(payment)} payment (${usd(held)}) until you file; at ${pct(HYSA_APY, 1)} that costs about ${usd(lost)} in interest. The income is taxable whether or not a form arrives.`,
      );
    },
  },

  "us-bank-signup-bonus": {
    eligible: (p) => (p.doneSignupBonuses ? "already doing sign-up bonuses" : true),
    value: (p) => {
      const t = estimate(p);
      const net = BANK_BONUS_TYPICAL * (1 - t.marginal);
      return value(
        net,
        "once",
        `One typical bonus: the middle of 20 bonuses in one published 2025 tally was ${usd(BANK_BONUS_TYPICAL)} (range $100 to $900); after ${pct(t.marginal)} income tax that is ${usd(net)}. Fees, deposit rules and holding periods can cut it, and the tally is one enthusiast's, not an average.`,
      );
    },
  },

  "us-card-signup-bonus": {
    eligible: (p) => {
      if (p.doneSignupBonuses) return "already doing sign-up bonuses";
      return p.revolvingBalance > 0 ? "never with a card balance" : true;
    },
    value: () => {
      const gross = CARD_BONUS_POINTS * CARD_POINT_VALUE;
      const net = gross - CARD_ANNUAL_FEE;
      return value(
        net,
        "once",
        `An example ${CARD_BONUS_POINTS.toLocaleString("en-US")}-point offer at ${CARD_POINT_VALUE * 100} cent a point is ${usd(gross)}, minus a ${usd(CARD_ANNUAL_FEE)} annual fee = ${usd(net)} in year one, if you reach the spend with bills you already pay and never carry a balance.`,
      );
    },
  },

  "us-unclaimed-refunds-and-property": {
    eligible: (p, c) => {
      if (daysBetween(c.today, IRS_2023_REFUND_EXPIRY) < 0) return "the 2023 refund window has closed";
      return p.yearsFreelancing >= 3 ? true : "tax year 2023 was before you started";
    },
    value: (p, c) =>
      value(
        UNCLAIMED_REFUND_MEDIAN,
        "once",
        `Only if a 2023 return was skipped or part-filed: the IRS median unclaimed refund for 2022 was ${usd(UNCLAIMED_REFUND_MEDIAN)} before credits (no 2023 figure is published yet), and 2023 refunds expire in ${daysBetween(c.today, IRS_2023_REFUND_EXPIRY)} days. State unclaimed property is free to search; no per-person figure is known.`,
      ),
  },

  "us-free-file": {
    eligible: (p) => {
      const t = estimate(p);
      return t.agi <= FREE_FILE_AGI_CAP ? true : `income is over the ${usd(FREE_FILE_AGI_CAP)} Free File limit`;
    },
    value: (p) =>
      value(
        FREE_FILE_UPSELL_LOW,
        "year",
        `Your income of about ${usd(estimate(p).agi)} is under the ${usd(FREE_FILE_AGI_CAP)} Free File limit of the 2026 season (the IRS page now shows $95,000 for the next); a paid Schedule C tier costs ${usd(FREE_FILE_UPSELL_LOW)} or more (anecdotal).`,
      ),
  },

  // Only instalments still ahead can be saved: an instalment already past is either paid or already accruing the penalty.
  "us-estimated-tax-quarterly": {
    eligible: (p) => {
      if (!isFreelancer(p)) return "only for people with income that has no tax withheld";
      return estimate(p).totalTax >= 1_000 ? true : "you are not expected to owe $1,000 or more";
    },
    value: (p, c) => {
      const t = estimate(p);
      const quarter = t.totalTax / 4;
      const ahead = ESTIMATED_TAX_DUE_2026.filter((d) => daysBetween(c.today, d) >= 0);
      const lateDays = ahead.reduce((sum, d) => sum + daysBetween(d, RETURN_DUE_2027), 0);
      const penalty = quarter * UNDERPAYMENT_RATE * (lateDays / 365);
      return value(
        penalty,
        "year",
        ahead.length === 0
          ? `All four 2026 due dates have passed; about ${usd(quarter)} a quarter was due on an estimated ${usd(t.totalTax)} of federal tax.`
          : `About ${usd(quarter)} a quarter on an estimated ${usd(t.totalTax)} of federal tax. ${ahead.length === 1 ? "The last 2026 payment is" : `${ahead.length} 2026 payments are`} still ahead; paying ${ahead.length === 1 ? "it" : "them"} on Apr 15, 2027 instead of on time would cost about ${usd(penalty)} at the ${pct(UNDERPAYMENT_RATE)} IRS rate.`,
      );
    },
  },

  // The tax pot is not a gain, so the value is the small penalty avoided; the card should lead with the amount to move.
  "us-tax-set-aside": {
    eligible: (p, c) => {
      if (!isFreelancer(p)) return "only for people with income that has no tax withheld";
      return c.event?.amount && c.event.amount > 0 ? true : "needs a payment to set aside from";
    },
    value: (p, c) => {
      const payment = c.event?.amount ?? 0;
      const t = estimate(p);
      const setAside = payment * SET_ASIDE_RATE;
      const federalShare = p.annualRevenue > 0 ? t.totalTax / p.annualRevenue : 0;
      const penalty = setAside * UNDERPAYMENT_RATE * (90 / 365); // Q4 due Jan 15, paid Apr 15 instead
      return value(
        penalty,
        "once",
        `Set aside ${usd(setAside)} of the ${usd(payment)} (${pct(SET_ASIDE_RATE)}). Your federal tax is about ${pct(federalShare)} of revenue; guides say ${pct(SET_ASIDE_RATE)} to 30%. Unsaved, it would face the ${pct(UNDERPAYMENT_RATE)} IRS rate when it comes due.`,
      );
    },
  },

  "us-roth-ira-prior-year": {
    eligible: (p) => (p.taxFreeInvesting ? "already using a Roth IRA" : true),
    value: (p) => {
      const t = estimate(p);
      const growth = ROTH_IRA_LIMIT_2026 * 0.07;
      const taxAvoided = growth * t.marginal;
      return value(
        taxAvoided,
        "year",
        `${usd(ROTH_IRA_LIMIT_2026)} at an assumed 7% grows ${usd(growth)} in year one, tax-free instead of taxed at ${pct(t.marginal)} (${usd(taxAvoided)}). Over 40 years the research's example reaches about $112,000.`,
      );
    },
  },

  "us-hysa-cash": {
    eligible: (p, c) => (c.cashToday - p.monthlyEssentials > 0 ? true : "no cash above one month of essentials"),
    value: (p, c) => {
      const idle = Math.max(0, c.cashToday - p.monthlyEssentials);
      const extra = idle * (HYSA_APY - NATIONAL_AVG_SAVINGS);
      return value(
        extra,
        "year",
        `${usd(idle)} above one month of essentials at ${pct(HYSA_APY, 1)} instead of the ${pct(NATIONAL_AVG_SAVINGS, 2)} national average earns about ${usd(extra)} more a year, if it sits at the average now.`,
      );
    },
  },

  "us-card-interest": {
    eligible: (p) => (p.revolvingBalance > 0 ? true : "no card balance carried"),
    value: (p) => {
      const cost = p.revolvingBalance * CARD_APR;
      return value(cost, "year", `${usd(p.revolvingBalance)} at the ${pct(CARD_APR, 2)} average APR costs about ${usd(cost)} a year in interest.`);
    },
  },

  // Protected, not a gain. No honest saving exists for an unseen bill, so the value is the amount on the table.
  "us-medical-bill-check": {
    eligible: (_p, c) => {
      if (!isMedicalBill(c)) return "only for a medical bill";
      return c.event?.amount && c.event.amount > 0 ? true : "needs the bill amount";
    },
    value: (_p, c) => {
      const bill = c.event?.amount ?? 0;
      return value(
        bill,
        "once",
        `This bill is ${usd(bill)}. Most bills check out; this is the amount worth verifying (insurer's explanation of benefits, itemised bill, and a collector's validation notice) before you pay. It is not a saving and is not counted in Found for you.`,
      );
    },
  },
};
