// The largest document fipa reads, and the words for refusing one over it. No imports: the Worker entry (worker.ts) reads it too.
const MAX_DOCUMENT_MIB = 6;
export const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_MIB * 1024 * 1024;
/** The limit as people read it: "6 MiB". */
export const MAX_DOCUMENT_LABEL = `${MAX_DOCUMENT_MIB} MiB`;

/** "<what> exceeds the 6 MiB limit." for the thing that is too big. */
export const documentLimitMessage = (what: string) => `${what} exceeds the ${MAX_DOCUMENT_LABEL} limit.`;
