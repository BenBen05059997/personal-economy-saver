import { PayPalAPI, PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { getAccessToken, PayPalError } from "@/lib/paypal/client";

// Tools the AI agent may call on its own. None of them sends anything to anyone:
// create_invoice only makes a draft.
const AGENT_ACTIONS = {
  invoices: { create: true, list: true, get: true, search: true, generateInvoiceNumber: true },
};

// Tools the server calls only after the user taps Approve on a confirmation card.
const APPROVED_ACTIONS = {
  invoices: {
    send: true,
    sendReminder: true,
  },
};

const ALL_ACTIONS = {
  invoices: { ...AGENT_ACTIONS.invoices, ...APPROVED_ACTIONS.invoices },
};

// The toolkit's code defaults to live PayPal when sandbox is unset, so it is always set here.
const CONTEXT = { sandbox: true };

type ToolkitTool = ReturnType<PayPalMCPToolkit["getTools"]>[number];

function toolsFor(actions: Record<string, Record<string, boolean>>): ToolkitTool[] {
  // The access token is only used for run(); listing tools needs no network call.
  return new PayPalMCPToolkit({ accessToken: "unused", configuration: { actions, context: CONTEXT } }).getTools();
}

export const agentTools = () => toolsFor(AGENT_ACTIONS);
export const approvedTools = () => toolsFor(APPROVED_ACTIONS);

// Runs one toolkit tool by name: validates the arguments with the toolkit's own schema
// (run() does not), executes it against the sandbox, and turns error payloads into exceptions.
export async function runTool<T = unknown>(method: string, args: unknown, requestId?: string): Promise<T> {
  return executeTool<T>(toolsFor(ALL_ACTIONS), method, args, requestId);
}

/** Only the sandbox smoke test cleans up the draft it just created. */
export function deleteSmokeDraft(invoiceId: string) {
  return executeTool(toolsFor({ invoices: { delete: true } }), "delete_invoice", { invoice_id: invoiceId });
}

async function executeTool<T>(tools: ToolkitTool[], method: string, args: unknown, requestId?: string): Promise<T> {
  const tool = tools.find((t) => t.method === method);
  if (!tool) throw new PayPalError(`Tool ${method} is not enabled in this app`);

  const parsed = tool.parameters.safeParse(args ?? {});
  if (!parsed.success) {
    throw new PayPalError(`Invalid arguments for ${method}`, 400, undefined, parsed.error.issues);
  }

  const api = new PayPalAPI(await getAccessToken(), { ...CONTEXT, request_id: requestId });
  const result = JSON.parse(await withTimeout(api.run(method, parsed.data), method));
  if (result?.ok === false || result?.error) {
    const message = result.message ?? result.error?.message ?? `${method} failed`;
    throw new PayPalError(message, result.status, undefined, result);
  }
  return result as T;
}

// The toolkit's run() takes no abort signal. Approval holds row locks while it waits, so a hung call is cut off
// here; the transaction then rolls back, and the PayPal-Request-Id makes a retry safe.
const PAYPAL_TIMEOUT_MS = 20_000;
function withTimeout<T>(call: Promise<T>, method: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PayPalError(`PayPal did not answer ${method} within ${PAYPAL_TIMEOUT_MS / 1000} s`, 504)), PAYPAL_TIMEOUT_MS);
  });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}
