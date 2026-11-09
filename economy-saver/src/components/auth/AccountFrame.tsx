import Link from "next/link";
import type { ReactNode } from "react";
import "./account.css";

export function AccountFrame({ title, children, embedded = false }: { title: string; children: ReactNode; embedded?: boolean }) {
  const Frame = embedded ? "section" : "main";
  return <Frame className="account-page">
    <Link href="/" className="account-back ui-back">‹ Home</Link>
    <h1 className="ui-title">{title}</h1>
    {children}
  </Frame>;
}
