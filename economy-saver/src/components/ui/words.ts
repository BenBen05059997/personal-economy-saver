// Sentences more than one face says, written once.

export const NOBODY_OWES = "Nobody owes anyone anything.";
export const COULDNT_REACH_HOUSEHOLD = "Couldn’t reach your household.";
export const UPLOAD_FAILED = "Upload failed.";

/** The first word of a name: "Ana Reyes" is "Ana". */
export const firstName = (name: string) => name.split(" ")[0];

/** The message of an error, or `fallback` when what was thrown is not an Error. */
export const wordsOf = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
