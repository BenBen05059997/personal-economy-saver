// Types and error classes the PayPal modules share. No code that talks to PayPal lives here.

/** `bodyText` is sent exactly as given, for a body that must reach PayPal byte for byte (a webhook event being verified). */
export type PayPalRequest = { method: "GET" | "POST"; path: string; body?: unknown; bodyText?: string; actAs?: string; requestId?: string };
/** One PayPal call. Everything that talks to PayPal takes one, so tests pass a fake. */
export type PayPalCall = (req: PayPalRequest, signal?: AbortSignal) => Promise<unknown>;

export type OrderRequest = { payee: string; requestId: string; invoiceId: string; number: string; item: string;
  amountMinor: number; currency: "USD"; returnUrl: string; cancelUrl: string };
export type MadeOrder = { orderId: string; approveUrl: string; createdAt: Date };
export type CreateOrder = (o: OrderRequest) => Promise<MadeOrder>;
/**
 * Takes an approved order's payment. The capture id PayPal gave when the capture is completed or pending; null when the order
 * was already captured (the completed-payment event brings it). `declined` when PayPal answered with a capture that took no
 * money (DECLINED or FAILED): the order is spent and the client pays again on a fresh one. Throws PayPalError.
 */
export type CaptureOrder = (orderId: string, payee: string) => Promise<{ captureId: string | null; declined?: boolean }>;

/**
 * What PayPal answered when the sandbox test card paid an order: the order, its status, and the first capture and its status
 * (null when PayPal gave none). The invoice is never marked paid from this; only the verified completed-payment event does.
 */
export type TestCardPayment = { orderId: string; orderStatus: string; captureId: string | null; captureStatus: string | null };
export type PayWithTestCard = (o: OrderRequest) => Promise<TestCardPayment>;

export type ConnectionView = { state: "demo" | "none" | "pending" | "connected"; email: string | null; detail: string | null };

/** A signed-in household that has not connected its PayPal cannot be paid through it. */
export class NotConnected extends Error {
  constructor(message = "Connect your PayPal to make a payment link.") { super(message); this.name = "NotConnected"; }
}
