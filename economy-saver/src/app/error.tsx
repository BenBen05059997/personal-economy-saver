"use client";
import { ErrorReference } from "@/components/shell/ErrorReference";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="account-page">
    <h1 className="ui-title">Something went wrong</h1>
    <p>That page could not be shown. Nothing you entered was lost. Try again, and if it keeps happening, quote the reference below.</p>
    <ErrorReference digest={error.digest} />
    <p><button className="ui-button" onClick={() => retry()}>Try again</button></p>
  </main>;
}
