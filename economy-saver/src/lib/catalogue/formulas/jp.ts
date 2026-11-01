import type { Context, Formula, Profile } from "../types";

// One entry per move in src/data/catalogue/jp.json, keyed by move id.
// Every rate and amount below was checked on its primary page on Nov 1, 2026 (see research/catalogue/verification-jp.md);
// each constant says which page.

// No live rate in Profile or Context; the demo uses ¥150/$ (research examples use 150 as well).
const JPY_PER_USD = 150;

const BLUE_65 = 650_000;
const KOKUHO_RATE = 0.1058; // Setagaya FY2026, under 40: 7.51% + 2.80% + 0.27% (医療 + 支援金 + 子ども・子育て支援金)
const KOKUHO_FLAT = 47_600 + 17_600 + 1_873; // Setagaya FY2026 per-person amounts = ¥67,073
const KOKUHO_CAP_UNDER40 = 670_000 + 260_000 + 30_000; // Setagaya FY2026 caps: 医療 + 支援金 + 子ども
const KOKUHO_CAP_40_64 = KOKUHO_CAP_UNDER40 + 170_000; // plus 介護 (rate 2.43%, ¥17,800 per person) = ¥1.13M
const PENSION_YEAR = 17_920 * 12; // 国民年金 FY2026 (¥18,290 a month in FY2027)
const IDECO_CAP_MONTH = 75_000; // 第1号, in force 2026-12-01: the Dec 2026 contribution, debited Jan 26, 2027 (MHLW leaflet, ideco-koushiki.jp)
const KYOSAI_MAX_YEAR = 840_000; // ¥70,000 a month
const AFTER_TAX = 0.79685; // 1 − 20.315%
const kokuhoCap = (age: number) => (age >= 40 ? KOKUHO_CAP_40_64 : KOKUHO_CAP_UNDER40);

const yen = (n: number) => {
  const r = Math.round(n);
  if (r >= 1_000_000) return `¥${(r / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (r >= 100_000) return `¥${Math.round(r / 1000)}k`;
  return `¥${r.toLocaleString("en-US")}`;
};
const round100 = (n: number) => Math.round(n / 100) * 100;
const isFreelancer = (p: Profile) => p.work !== "employee";

// --- Tax model ---------------------------------------------------------------------------
// A small estimate of a freelancer's year, built from the research's worked example (Tokyo,
// under 40, single, ¥6M revenue, ¥1M expenses, 青色 ¥650k → 事業所得 ¥4.35M, 所得税 taxable
// ¥2.61M, 住民税所得割 ¥320k, 国保 ≈ ¥482k, all-in saving ≈ 36% per ¥1 of expense, ≈ 20% per
// ¥1 of iDeCo or 共済 deduction). It scales by income band: the 所得税 band, the ¥1.04M /
// ¥670k / ¥620k basic deduction (令和8-9年分, NTA No.1199), the 国保 cap and the 5% 個人事業税 above ¥2.9M
// (Tokyo: デザイン業 is 5%, 事業主控除 ¥2.9M).
// Savings moves assume a blue return (as the research profile does), which is conservative
// for a white filer: their real band is higher. Not a tax calculation; never shown as one.

// NTA No.2260 brackets, 所得税 before the 1.021 復興特別所得税 uplift.
const BRACKETS: [number, number][] = [
  [1_950_000, 0.05],
  [3_300_000, 0.1],
  [6_950_000, 0.2],
  [9_000_000, 0.23],
  [18_000_000, 0.33],
  [40_000_000, 0.4],
  [Infinity, 0.45],
];

function incomeTax(taxable: number): number {
  let tax = 0;
  let prev = 0;
  for (const [top, rate] of BRACKETS) {
    if (taxable <= prev) break;
    tax += (Math.min(taxable, top) - prev) * rate;
    prev = top;
  }
  return tax * 1.021;
}

function bandRate(taxable: number): number {
  for (const [top, rate] of BRACKETS) if (taxable <= top) return rate;
  return 0.45;
}

const blueDeduction = (p: Profile) =>
  p.filing === "jp_blue_65" ? BLUE_65 : p.filing === "jp_blue_10" ? 100_000 : 0;

function basicDeduction(gokei: number): number {
  if (gokei <= 4_890_000) return 1_040_000;
  if (gokei <= 6_550_000) return 670_000;
  return 620_000;
}

type Year = {
  profit: number; // revenue − expenses, before 青色
  gokei: number; // 合計所得
  kokuho: number;
  taxable: number; // 所得税 taxable income
  residentBase: number; // 住民税 taxable income
  burden: number; // 所得税 + 住民税 + 国保 + 国民年金 + 個人事業税
};

// blueDed: the 青色 deduction to assume. Default is the research profile's ¥650k.
function year(p: Profile, blueDed = BLUE_65): Year {
  const profit = Math.max(0, p.annualRevenue - p.annualExpenses);
  const gokei = Math.max(0, profit - blueDed);
  const older = p.age >= 40; // 40–64 add 2.43% and ¥17,800
  const kokuho = Math.min(
    kokuhoCap(p.age),
    (KOKUHO_RATE + (older ? 0.0243 : 0)) * Math.max(0, gokei - 430_000) + KOKUHO_FLAT + (older ? 17_800 : 0),
  );
  const si = kokuho + PENSION_YEAR;
  const retire = p.retirementMonthly * 12;
  const taxable = Math.max(0, gokei - si - basicDeduction(gokei) - retire);
  const residentBase = Math.max(0, gokei - si - 430_000 - retire);
  const bizTax = Math.max(0, profit - 2_900_000) * 0.05; // 青色 is added back for 個人事業税
  const burden = incomeTax(taxable) + residentBase * 0.1 + 5_000 + kokuho + PENSION_YEAR + bizTax;
  return { profit, gokei, kokuho, taxable, residentBase, burden };
}

// All-in saving per ¥1 of extra expense: 所得税 band × 1.021 + 住民税 10% + 国保 + 個人事業税 (≈ 36% for Ben).
function expenseRate(p: Profile): number {
  const y = year(p);
  return bandRate(y.taxable) * 1.021 + 0.1 + (y.kokuho < kokuhoCap(p.age) ? KOKUHO_RATE : 0) + (y.profit > 2_900_000 ? 0.05 : 0);
}

// Tax saved by deducting `d` more from income, after `prior` already deducted, counted band by band
// (≈ 20% for Ben). iDeCo and 共済 lower 所得税 and 住民税 only, not 国保 or 個人事業税.
function deductionSaving(p: Profile, d: number, prior = 0): number {
  const y = year(p);
  const pos = (x: number) => Math.max(0, x);
  const inc = incomeTax(pos(y.taxable - prior)) - incomeTax(pos(y.taxable - prior - d));
  const res = 0.1 * (pos(y.residentBase - prior) - pos(y.residentBase - prior - d));
  return inc + res;
}

// iDeCo room still open under the cap, per year.
const idecoRoomYear = (p: Profile) => Math.max(0, IDECO_CAP_MONTH - p.retirementMonthly) * 12;

// The payout in yen, if this context carries one.
function payoutYen(c: Context): number | undefined {
  const e = c.event;
  if (!e?.amount) return undefined;
  return e.currency === "USD" ? e.amount * JPY_PER_USD : e.amount;
}

const notFreelancer = "this is for freelancers and sole proprietors";

// --- Leaving a job ----------------------------------------------------------------------
// The life_event moment carries the job exit in the context event: kind "left_job" (resigned) or "laid_off"
// (dismissal, expired contract: an involuntary exit), amount = last monthly pay in yen.
const leftJob = (c: Context) => c.event?.kind === "left_job" || c.event?.kind === "laid_off";
const lastMonthlyPay = (p: Profile, c: Context) =>
  c.event?.amount && c.event.currency !== "USD" ? c.event.amount : p.annualRevenue / 12;

// 協会けんぽ Tokyo FY2026 (保険料額表 from 令和8年3月分): 健康保険 9.85%, 子ども・子育て支援金 0.23% (from April),
// 介護 1.62% at 40-64. 任意継続 pays the whole premium on min(last 標準報酬月額, ¥320,000).
const NININ_RATE = 0.0985 + 0.0023;
const NININ_KAIGO = 0.0162;
const NININ_BASE_CAP = 320_000; // 令和8年度 cap, kyoukaikenpo.or.jp notice of 2025-12-10

// 給与所得控除, 令和8-9年分 (NTA No.1410). The 令和7年分 table differs only below ¥2.2M.
function salaryDeduction(s: number): number {
  if (s <= 2_200_000) return 740_000;
  if (s <= 3_600_000) return s * 0.3 + 80_000;
  if (s <= 6_600_000) return s * 0.2 + 440_000;
  if (s <= 8_500_000) return s * 0.1 + 1_100_000;
  return 1_950_000;
}

// 国保 for a person with salary income only, Setagaya FY2026: (給与所得 − ¥430,000) × rate + per-person amount, capped.
// An involuntary exit (特定受給資格者 / 特定理由離職者) counts 給与所得 at 30% (MHLW).
function kokuhoFromSalary(annualPay: number, age: number, involuntary: boolean): number {
  const older = age >= 40;
  const income = Math.max(0, annualPay - salaryDeduction(annualPay)) * (involuntary ? 0.3 : 1);
  const base = Math.max(0, income - 430_000);
  const rate = KOKUHO_RATE + (older ? 0.0243 : 0);
  const flat = KOKUHO_FLAT + (older ? 17_800 : 0);
  return Math.min(kokuhoCap(age), base * rate + flat);
}

// 基本手当日額 from the last monthly pay, for someone under 60 (MHLW formula in force from 2026-08-01).
function kihonTeate(monthlyPay: number, age: number): number {
  const w = (monthlyPay * 6) / 180; // 賃金日額
  const [wCap, ceiling] = age < 30 ? [14_900, 7_450] : age < 45 ? [16_540, 8_270] : [18_220, 9_110];
  if (w < 3_203) return Math.floor(3_203 * 0.8);
  if (w < 5_480) return Math.floor(0.8 * w);
  if (w <= 13_490) return Math.floor(0.8 * w - 0.3 * ((w - 5_480) / (13_490 - 5_480)) * w);
  if (w <= wCap) return Math.floor(0.5 * w);
  return ceiling;
}

export const jpFormulas: Record<string, Formula> = {
  // Refund = 10/110 of tax-inclusive Japanese business spending. Assumes all annualExpenses is taxable
  // domestic spend (home rent and PayPal fees are not, so the real figure is lower).
  "jp-consumption-tax-election": {
    eligible: (p) => {
      if (!isFreelancer(p)) return notFreelancer;
      if (p.consumptionTaxElected) return "already elected";
      if (p.incomeCurrency === "JPY") return "clients pay in yen, so sales would be taxable at 10%";
      return true;
    },
    value: (p) => {
      const amount = round100((p.annualExpenses * 10) / 110);
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `${yen(p.annualExpenses)} of Japanese business spending × 10/110 ≈ ${yen(amount)} back a year (less the extra bookkeeping)`,
      };
    },
  },

  // Three offers on A8.net's self-back list on Nov 1, 2026: two cards (¥5,750 and ¥3,000) and a bank account (¥10,000)
  // = ¥18,750, less the worst-case ¥660 transfer fee. Exchange-account offers need a purchase, so they are left out.
  // Before tax: the rewards are taxable income.
  "jp-self-back": {
    eligible: (p) => (p.doneSignupBonuses ? "already done" : true),
    value: () => ({
      amount: 18_750 - 660,
      currency: "JPY",
      per: "once",
      basis: "Three example offers (two cards, a bank account) pay ¥18,750 once before tax, less up to ¥660 to transfer",
    }),
  },

  // The November instalment is a third of last year's income tax (予定納税基準額, ¥150k or more to apply). Assumes last year ≈ this
  // year's profile and uses the 2026-27 basic deduction as a stand-in for 2025's, so it is an estimate.
  // It is the most cash the request can keep with you, not a gain: the real amount depends on the estimate.
  "jp-yotei-nozei-reduction": {
    eligible: (p) => {
      if (!isFreelancer(p)) return notFreelancer;
      if (p.yearsFreelancing < 2) return "no 予定納税 notice until the second year";
      const tax = incomeTax(year(p, blueDeduction(p)).taxable);
      return tax >= 150_000 ? true : "last year's income tax was under ¥150k, so no 予定納税";
    },
    value: (p) => {
      const tax = incomeTax(year(p, blueDeduction(p)).taxable);
      const amount = round100(tax / 3);
      return {
        amount,
        currency: "JPY",
        per: "once",
        basis: `November instalment ≈ ${yen(amount)} (a third of about ${yen(tax)} income tax); if this year's tax will be lower you can pay less now`,
      };
    },
  },

  // Housing and utilities are assumed to be 45% of monthlyEssentials and the work room 25% of that
  // (the research example uses a 25% work room); the profile has no rent field. Illustrative.
  // 施行令96条: a share under half is deductible only on a blue return; the saving rate here is the blue profile's.
  "jp-home-share": {
    eligible: (p) => (isFreelancer(p) ? true : notFreelancer),
    value: (p, c) => {
      const home = p.monthlyEssentials * 0.45 * 12;
      const share = 0.25;
      const rate = expenseRate(p);
      const amount = round100(home * share * rate);
      const bill = c.event?.amount;
      const thisBill = bill ? `; this ${yen(bill)} bill alone is ${yen(bill * share)} a month of expense` : "";
      const blueNote = blueDeduction(p) === 0 ? ". A share under half needs a blue return" : "";
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `${yen(home)} a year of home costs × ${Math.round(share * 100)}% work share × ${Math.round(rate * 100)}% saved ≈ ${yen(amount)} a year${thisBill}${blueNote}`,
      };
    },
  },

  // PayPal Japan standard business rates (paypal.com/jp merchant-fees, page dated 2026-01-22, rechecked Nov 1): 3.60% domestic +
  // 0.50% cross-border (one row for Japan accounts) + $0.30 fixed, then 3.00% over base to convert what is left.
  // Annual figure assumes 12 payouts a year for the fixed fee (it barely matters).
  "jp-payout-cost": {
    eligible: (p) => {
      if (!isFreelancer(p)) return notFreelancer;
      return p.incomeCurrency === "JPY" ? "clients already pay in yen" : true;
    },
    value: (p, c) => {
      const rate = 0.041 + 0.03 * (1 - 0.041);
      const annual = round100(p.annualRevenue * rate + 12 * 0.3 * JPY_PER_USD);
      const e = c.event;
      let thisOne = "";
      if (e?.amount && e.currency === "USD") {
        const net = e.amount - (e.amount * 0.041 + 0.3);
        const yenIn = net * JPY_PER_USD * 0.97;
        const cost = e.amount * JPY_PER_USD - yenIn;
        thisOne = `; this $${e.amount} payout cost about ${yen(cost)} (${yen(yenIn)} reaches your bank at ¥${JPY_PER_USD}/$)`;
      }
      return {
        amount: annual,
        currency: "JPY",
        per: "year",
        basis: `${yen(p.annualRevenue)} a year × about ${(rate * 100).toFixed(1)}% PayPal fees and conversion ≈ ${yen(annual)} a year, which pricing it in keeps${thisOne}`,
      };
    },
  },

  // Set-aside = average tax-and-pension share of revenue (actual filing status), applied to this payout.
  // Money protected, not earned. Only meaningful with a payout in the context.
  "jp-tax-pot": {
    eligible: (p, c) => {
      if (!isFreelancer(p)) return notFreelancer;
      return payoutYen(c) ? true : "needs a payout to apply to";
    },
    value: (p, c) => {
      const pay = payoutYen(c) ?? 0;
      const share = p.annualRevenue > 0 ? year(p, blueDeduction(p)).burden / p.annualRevenue : 0;
      const amount = round100(pay * share);
      return {
        amount,
        currency: "JPY",
        per: "once",
        basis: `${yen(pay)} payout × about ${Math.round(share * 100)}% tax and pension share ≈ ${yen(amount)} is already owed: move it to the tax pot`,
      };
    },
  },

  // Extra deduction × (所得税 band × 1.021 + 住民税 10% + 国保 rate), at the income left after the deduction
  // (≈ 31% for Ben, so ¥200k; the research range is ¥170–200k). Ignores the ¥4.89M basic-deduction cliff.
  "jp-blue-return-65": {
    eligible: (p) => {
      if (!isFreelancer(p)) return notFreelancer;
      return p.filing === "jp_blue_65" ? "already filing blue with the ¥650k deduction" : true;
    },
    value: (p) => {
      const extra = BLUE_65 - (p.filing === "jp_blue_10" ? 100_000 : 0);
      const after = year(p);
      const rate = bandRate(after.taxable) * 1.021 + 0.1 + (after.kokuho < kokuhoCap(p.age) ? KOKUHO_RATE : 0);
      const amount = round100(extra * rate);
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `${yen(extra)} more deduction × ${Math.round(rate * 100)}% (所得税, 住民税 and 国保) ≈ ${yen(amount)} a year`,
      };
    },
  },

  // Saving on the room still open under the ¥75,000 cap, which takes effect with the Dec 2026 contribution (debited Jan 26, 2027),
  // so ¥900k a year counts in the 2027 tax year (research: about ¥170k at Ben's income).
  "jp-ideco": {
    eligible: (p) => {
      if (!isFreelancer(p) || p.healthInsurance === "jp_employer") return "this cap is for the self-employed";
      return idecoRoomYear(p) > 0 ? true : "already at the cap";
    },
    value: (p) => {
      const d = idecoRoomYear(p);
      const amount = round100(deductionSaving(p, d));
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `${yen(d / 12)} a month × 12 = ${yen(d)} deducted ≈ ${yen(amount)} less 所得税 and 住民税 a year`,
      };
    },
  },

  // 共済 stacked on a maxed iDeCo, so the two rows add up to the research's ≈¥284k instead of double counting.
  "jp-kyosai": {
    eligible: (p) => (isFreelancer(p) ? true : notFreelancer),
    value: (p) => {
      const prior = idecoRoomYear(p);
      const amount = round100(deductionSaving(p, KYOSAI_MAX_YEAR, prior));
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `${yen(KYOSAI_MAX_YEAR / 12)} a month × 12 = ${yen(KYOSAI_MAX_YEAR)} deducted, on top of a maxed iDeCo ≈ ${yen(amount)} less tax a year`,
      };
    },
  },

  // 総務省 formula: limit = 住民税所得割 × 20% ÷ (90% − 所得税 band × 1.021) + ¥2,000, using the blue-return
  // profile (the lower, safer limit). Gifts ≈ 30% of the donation (secondary); value is gifts minus the ¥2,000.
  "jp-furusato": {
    eligible: (p) => (year(p).residentBase > 0 ? true : "no 住民税所得割 to offset"),
    value: (p) => {
      const y = year(p);
      const warikin = y.residentBase * 0.1;
      const limit = (warikin * 0.2) / (0.9 - bandRate(y.taxable) * 1.021) + 2_000;
      const amount = round100(limit * 0.3 - 2_000);
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `Limit ≈ ${yen(limit)}; gifts of about 30% minus the ¥2,000 you pay ≈ ${yen(amount)}. Keep a margin`,
      };
    },
  },

  // Research example: ¥200k of missed deductions a year (家事按分, fees) × years still open (max 5) × (所得税 + 住民税).
  // 更正の請求 closes 5 years after the statutory deadline: the 2021 return on Mar 15, 2027 (NTA No.2026).
  "jp-amended-return": {
    eligible: (p, c) => {
      if (!isFreelancer(p)) return notFreelancer;
      if (p.yearsFreelancing < 1) return "no filed return yet";
      if (c.moment === "deadline_near" && p.yearsFreelancing < 5) return "no return old enough to expire soon";
      return true;
    },
    value: (p) => {
      const years = Math.min(5, Math.max(1, Math.floor(p.yearsFreelancing)));
      const rate = bandRate(year(p).taxable) * 1.021 + 0.1;
      const amount = round100(years * 200_000 * rate);
      return {
        amount,
        currency: "JPY",
        per: "once",
        basis: `${yen(200_000)} missed a year (example) × ${years} filed years × ${Math.round(rate * 100)}% ≈ ${yen(amount)} back`,
      };
    },
  },

  // Round 20 of the 持続化補助金 (商工会議所地区, 公募要領 第8版): rate 2/3, cap ¥500k (website and system costs: ¥300k of subsidy).
  // Example: ¥300k of eligible spend × 2/3 = ¥200k, if approved (the screening can say no). The デジタル化・AI導入補助金 pays 1/2.
  "jp-jizokuka-subsidy": {
    eligible: (p) => {
      if (!isFreelancer(p)) return notFreelancer;
      return p.filing === "none" ? "needs a registered business (開業届)" : true;
    },
    value: () => ({
      amount: 200_000,
      currency: "JPY",
      per: "once",
      basis: "Example: ¥300k of eligible spend × 2/3 ≈ ¥200k back if approved, after you pay and report (cap ¥500k; a reimbursement, not a gain if you would not spend it)",
    }),
  },

  // 2-year prepayment by 口座振替, latest published pair (FY2026–27): ¥417,150 paid, ¥17,370 discount. An April 2027 start covers
  // FY2027–28 (¥18,290 a month in FY2027; FY2028 not published), so this is the latest example, not a quote.
  "jp-nenkin-prepay": {
    eligible: (p) =>
      isFreelancer(p) && p.healthInsurance !== "jp_employer" ? true : "you pay 国民年金 only as a self-employed person",
    value: () => ({
      amount: 17_370,
      currency: "JPY",
      per: "once",
      basis: "Paying 24 months by bank debit costs ¥417,150, which is ¥17,370 less than paying monthly",
    }),
  },

  // ¥200 × 12 months of extra pension for life per year paid (the payback is 2 years of pension).
  "jp-fuka-nenkin": {
    eligible: (p) =>
      isFreelancer(p) && p.healthInsurance !== "jp_employer" ? true : "you pay 国民年金 only as a self-employed person",
    value: () => ({
      amount: 2_400,
      currency: "JPY",
      per: "year",
      basis: "¥400 a month buys ¥2,400 a year of pension for life for each year you pay; 10 years adds ¥24,000 a year",
    }),
  },

  // Surplus above the worst case, first ¥1M at 1.2% (an online bank's account, Oct 1, 2026; it pays 0.75% above ¥1M) and the rest at
  // 2.05% (個人向け国債 変動10年, Oct 2026 issue, 1-year lock), against a 0.5% megabank from Nov 2, after 20.315% tax.
  "jp-park-cash": {
    eligible: (_p, c) => (c.worstLow >= 100_000 ? true : "no surplus above the runway's worst case"),
    value: (_p, c) => {
      const s = Math.max(0, c.worstLow);
      const gross = Math.min(s, 1_000_000) * 0.012 + Math.max(0, s - 1_000_000) * 0.0205 - s * 0.005;
      const amount = round100(gross * AFTER_TAX);
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `${yen(s)} of surplus at 1.2% / 2.05% instead of 0.5%, after tax ≈ ${yen(amount)} a year`,
      };
    },
  },

  // 楽天カード 17.64% APR (its premium cards 15.00%); 三井住友カード 18.0% for members who joined from Mar 31, 2026. Only applies with a revolving balance.
  "jp-revolving-check": {
    eligible: (p) => (p.revolvingBalance > 0 ? true : "no revolving balance"),
    value: (p) => {
      const amount = round100(p.revolvingBalance * 0.1764);
      return {
        amount,
        currency: "JPY",
        per: "year",
        basis: `${yen(p.revolvingBalance)} revolving × 17.64% ≈ ${yen(amount)} a year in interest`,
      };
    },
  },

  // 1 card: issuer bonus of 5,000 points (≈ ¥5,000, issuer page on Nov 1, 2026). A point-site reward on top could not be confirmed
  // (the site shows amounts only with JavaScript), so it is not counted. Offers move week to week.
  "jp-card-signup-bonus": {
    eligible: (p) => (p.doneSignupBonuses ? "already done" : true),
    value: () => ({
      amount: 5_000,
      currency: "JPY",
      per: "once",
      basis: "One free card: the issuer's own sign-up bonus of about ¥5,000 in points, with conditions (offers change weekly)",
    }),
  },

  // Full exemption saves the monthly premium; the test is (dependants + 1) × ¥350k + ¥320k of income,
  // assumed single. Not for Ben's income.
  "jp-nenkin-exemption": {
    eligible: (p) => {
      if (!isFreelancer(p) || p.healthInsurance === "jp_employer") return "you pay 国民年金 only as a self-employed person";
      const income = year(p, blueDeduction(p)).gokei;
      return income <= 670_000 ? true : "income is above the full-exemption line (¥670k for a single person)";
    },
    value: () => ({
      amount: PENSION_YEAR,
      currency: "JPY",
      per: "year",
      basis: `A full exemption saves ¥17,920 a month, ${yen(PENSION_YEAR)} a year, and still counts as half a paid month`,
    }),
  },

  // 任意継続 (協会けんぽ Tokyo) against 国保 (Setagaya) for the first 12 months after leaving a job, from the last monthly pay.
  // The value is the gap: the saving from picking the cheaper one. Year two depends on income not known yet, so it is not modelled.
  // Bonuses and dependants are ignored (任意継続 has no per-person fee; 国保 charges ¥67,073 a head).
  "jp-ninin-keizoku": {
    eligible: (p, c) => {
      if (!leftJob(c) && p.healthInsurance !== "jp_employer") return "this is for people leaving an employer's health plan";
      if (p.age >= 65) return "任意継続 and 国保 premiums here are for under 65";
      return true;
    },
    value: (p, c) => {
      const monthly = lastMonthlyPay(p, c);
      const older = p.age >= 40;
      const ninin = Math.min(monthly, NININ_BASE_CAP) * (NININ_RATE + (older ? NININ_KAIGO : 0)) * 12;
      const involuntary = c.event?.kind === "laid_off";
      const koku = kokuhoFromSalary(monthly * 12, p.age, involuntary);
      const amount = round100(Math.abs(koku - ninin));
      const cheaper = ninin <= koku ? "任意継続" : "国保";
      return {
        amount,
        currency: "JPY",
        per: "once",
        basis: `First 12 months: 任意継続 ≈ ${yen(ninin)} vs 国保 ≈ ${yen(koku)}${involuntary ? " (involuntary exit, salary counted at 30%)" : ""}; ${cheaper} is cheaper by ${yen(amount)}`,
      };
    },
  },

  // 再就職手当 for starting a business: 基本手当日額 × remaining days × 70%. Assumes the 90-day minimum entitlement with two thirds
  // left (60 days), so it is a floor-style example; the real days are on the 受給資格者証. Under 60 only.
  "jp-saishushoku-teate": {
    eligible: (p, c) => {
      if (!leftJob(c)) return "this is for people on unemployment benefit after leaving a job";
      if (p.age >= 60) return "the benefit formula here covers people under 60";
      return true;
    },
    value: (p, c) => {
      const monthly = lastMonthlyPay(p, c);
      const daily = kihonTeate(monthly, p.age);
      const amount = Math.floor(daily * 60 * 0.7);
      return {
        amount,
        currency: "JPY",
        per: "once",
        basis: `基本手当日額 ≈ ${yen(daily)} × 60 days left (two thirds of the 90-day minimum) × 70% ≈ ${yen(amount)}, paid if Hello Work approves your business`,
      };
    },
  },
};
