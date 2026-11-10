"use client";
import { useEffect } from "react";

/** Hands the sign-in link's query to /api/auth/finish; the page keeps showing the loader while that route works. */
export function FinishSignIn() {
  useEffect(() => { location.replace("/api/auth/finish" + location.search); }, []);
  return null;
}
