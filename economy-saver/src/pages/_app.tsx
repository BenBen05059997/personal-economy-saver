import type { AppProps } from "next/app";
import "@/app/globals.css";
import "@/components/home/home.css";
import "@/components/plan/plan.css";
import "@/components/family/family.css";

export default function PublicApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
