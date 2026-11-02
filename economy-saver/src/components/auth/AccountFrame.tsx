import Link from "next/link";
import type { ReactNode } from "react";
import "./account.css";

export function AccountFrame({ title, children }: { title: string; children: ReactNode }) {
  return <main className="account-page">
    <Link href="/" className="account-back">‹ Home</Link>
    <h1 className="ui-title">{title}</h1>
    {children}
  </main>;
}
