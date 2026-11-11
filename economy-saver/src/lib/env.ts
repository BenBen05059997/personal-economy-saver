import { z } from "zod";

// The only PayPal host this app ever talks to. There is deliberately no live URL anywhere.
export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";

// An empty `KEY=` line in .env.local means "not set yet", not "set to an empty string".
const blankIsUnset = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), inner);

const schema = z.object({
  PAYPAL_ENVIRONMENT: z.literal("SANDBOX", {
    errorMap: () => ({
      message: "must be SANDBOX. This app never talks to live PayPal.",
    }),
  }),
  PAYPAL_CLIENT_ID: z.string({ required_error: "is missing" }).min(1, "is missing"),
  PAYPAL_CLIENT_SECRET: z.string({ required_error: "is missing" }).min(1, "is missing"),
  // D13: fipa's partner attribution code, sent on every PayPal call.
  PAYPAL_PARTNER_ATTRIBUTION_ID: z.string({ required_error: "is missing" }).min(1, "is missing"),
  // fipa's own platform merchant id: used in partner paths and as the payee for Try it.
  PAYPAL_PARTNER_MERCHANT_ID: z.string({ required_error: "is missing" }).min(1, "is missing"),
  // Set after registering the webhook (npm run webhook:register).
  PAYPAL_WEBHOOK_ID: blankIsUnset(z.string().min(1).optional()),
});

type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Read lazily so `next build` works without secrets; every PayPal call goes through here first.
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")} ${issue.message}`)
      .join("\n");
    throw new Error(`Environment is not ready. Fix .env.local:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
