"use client";
import { ErrorReference } from "@/components/shell/ErrorReference";

// Replaces the root layout, so it carries its own html and body and no stylesheet.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <html lang="en"><body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem auto", maxWidth: "32rem", padding: "0 1rem" }}>
    <h1>Something went wrong</h1>
    <p>The app could not be shown. Try again, and if it keeps happening, quote the reference below.</p>
    <ErrorReference digest={error.digest} />
    <p><button onClick={() => retry()}>Try again</button></p>
  </body></html>;
}
