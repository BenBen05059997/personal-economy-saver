"use client";

import { useEffect, useRef, useState } from "react";
import { LoadingIndicator } from "@/components/ui/LoadingState";

export function TryItForm() {
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // A native navigation can restore this form from the browser's back cache.
    function restore() {
      submitting.current = false;
      setPending(false);
    }
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  return <form method="get" action="/api/try" aria-busy={pending} onSubmit={(event) => {
    if (submitting.current) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
    setPending(true);
  }}>
    <button type="submit" disabled={pending}>
      {pending ? <LoadingIndicator label="Creating your household…" /> : "Try it"}
    </button>
  </form>;
}
