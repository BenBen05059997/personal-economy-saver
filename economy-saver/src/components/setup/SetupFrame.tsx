import Link from "next/link";
import type { ReactNode } from "react";
import { AskButton } from "@/components/shell/AskButton";
import { LogoMark } from "@/components/shell/Logo";

/** Setup stays a focused flow: a thin bar with the logo and the Ask button, no sidebar, Add or bell. The content wrapper is what Next and Finish look inside for unsaved input. */
export function SetupFrame({ children }: { children: ReactNode }) {
  return <>
    <header className="setup-frame-bar">
      <Link prefetch={false} className="setup-frame-brand" href="/"><LogoMark />fipa</Link>
      <AskButton />
    </header>
    <div data-setup-content>{children}</div>
  </>;
}
