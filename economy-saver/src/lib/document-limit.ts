// The largest document fipa reads, and the words for refusing one over it. No imports: the Worker entry (worker.ts) reads it too.
export const MAX_DOCUMENT_BYTES = 6 * 1024 * 1024;

/** "<what> exceeds the 6 MiB limit." for the thing that is too big. */
export const documentLimitMessage = (what: string) => `${what} exceeds the 6 MiB limit.`;
