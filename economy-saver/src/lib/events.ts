// Temporary M0 store: the last few webhook deliveries, in memory only. Replace with real storage later.
export type RecordedEvent = {
  id: string;
  type: string;
  verified: boolean;
  reason?: string;
  resourceId?: string;
  receivedAt: string;
};

const LIMIT = 50;

// Kept on globalThis so it survives dev hot reload.
const store = globalThis as typeof globalThis & { __recentEvents?: RecordedEvent[] };

function list(): RecordedEvent[] {
  return (store.__recentEvents ??= []);
}

export function recordEvent(event: RecordedEvent): void {
  const events = list();
  events.unshift(event);
  events.length = Math.min(events.length, LIMIT);
}

// Newest first.
export function recentEvents(): RecordedEvent[] {
  return [...list()];
}
