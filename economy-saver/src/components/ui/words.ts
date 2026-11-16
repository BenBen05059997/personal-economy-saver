// Sentences more than one face says, written once.

export const COULDNT_REACH_HOUSEHOLD = "Couldn’t reach your household.";
export const UPLOAD_FAILED = "Upload failed.";

/** The message of an error, or `fallback` when what was thrown is not an Error. */
export const wordsOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
