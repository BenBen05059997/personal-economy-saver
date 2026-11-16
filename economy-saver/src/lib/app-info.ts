// Words about the app that more than one face writes. No imports: pages, routes and client components read it.

/** The one-sentence description in the page metadata and the web app manifest. */
export const APP_DESCRIPTION = "See what you can spend, what’s due, and who can pay you through PayPal.";

/** The name of the downloaded household file for the household's day (`YYYY-MM-DD`). */
export const exportFilename = (day: string) => `personal-economy-saver-${day}.json`;
