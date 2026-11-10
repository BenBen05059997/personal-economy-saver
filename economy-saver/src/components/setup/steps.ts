import type { BillPreset } from "@/components/household/AddEntry";

/** The setup steps after "Start planning", in order: /setup?step=<step>. */
export const STEPS = ["bank", "income", "bills", "card"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_WORDS: Record<Step, { question: string; why: string }> = {
  bank: { question: "What’s in your bank today?", why: "So the forecast starts from today’s money." },
  income: { question: "Who pays you?", why: "So fipa knows what comes in." },
  bills: { question: "What do you pay every month?", why: "So the days money leaves show up." },
  card: { question: "Do you pay with a credit card?", why: "So card bills land on the right day." },
};

/** The bill chips. Each starts the Add a bill form with a name and one of the fourteen categories, repeating every month. */
export const BILL_CHIPS: { label: string; preset: BillPreset }[] = [
  { label: "Rent", preset: { name: "Rent", category: "housing" } },
  { label: "Phone", preset: { name: "Phone", category: "phone_internet" } },
  { label: "Internet", preset: { name: "Internet", category: "phone_internet" } },
  { label: "Electricity", preset: { name: "Electricity", category: "utilities", varies: true } },
  { label: "Gas & water", preset: { name: "Gas and water", category: "utilities", varies: true } },
  { label: "Subscriptions", preset: { name: "Subscriptions", category: "subscriptions" } },
  { label: "Insurance", preset: { name: "Insurance", category: "insurance" } },
  { label: "Loan", preset: { name: "Loan", category: "debt" } },
  { label: "Other", preset: { name: "", category: "other" } },
];

export const stepPath = (step: Step) => `/setup?step=${step}`;
