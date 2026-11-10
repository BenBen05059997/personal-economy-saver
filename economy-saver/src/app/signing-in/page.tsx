import { Suspense } from "react";
import { LoadingState } from "@/components/ui/LoadingState";
import { FinishSignIn } from "@/components/auth/FinishSignIn";

const LABEL = "Signing you in…";

export default function SigningInPage() {
  return <>
    <LoadingState label={LABEL} />
    <Suspense fallback={null}><FinishSignIn /></Suspense>
  </>;
}
