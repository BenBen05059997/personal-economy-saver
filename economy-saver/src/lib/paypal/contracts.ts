// Types and error classes the PayPal modules share. No code that talks to PayPal lives here.

export type PayPalRequest = { method: "GET" | "POST"; path: string; body?: unknown; actAs?: string; requestId?: string };
/** One PayPal call. Everything that talks to PayPal takes one, so tests pass a fake. */
export type PayPalCall = (req: PayPalRequest, signal?: AbortSignal) => Promise<unknown>;

export type OrderRequest = { payee: string; requestId: string; invoiceId: string; number: string; item: string;
  amountMinor: number; currency: "USD"; returnUrl: string; cancelUrl: string };
export type MadeOrder = { orderId: string; approveUrl: string; createdAt: Date };
export type CreateOrder = (o: OrderRequest) => Promise<MadeOrder>;
export type CaptureOrder = (orderId: string, payee: string) => Promise<"captured" | "already">; // throws PayPalError

export type ConnectionView = { state: "demo" | "none" | "pending" | "connected"; email: string | null; detail: string | null };

/** A signed-in household that has not connected its PayPal cannot be paid through it. */
export class NotConnected extends Error {
  constructor(message = "Connect your PayPal to make a payment link.") { super(message); this.name = "NotConnected"; }
}
