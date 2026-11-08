import Link from "next/link";
import "./memory.css";

const TABS = [
  { id: "memory", label: "Profile", href: "/memory" },
  { id: "spaces", label: "Spaces", href: "/memory?tab=spaces" },
  { id: "goals", label: "Goals", href: "/memory?tab=goals" },
  { id: "rules", label: "Rules", href: "/memory?tab=rules" },
] as const;

export type MemoryTab = typeof TABS[number]["id"];

export function MemoryTabs({ active }: { active: MemoryTab }) {
  return <nav className="memory-tabs" aria-label="Assistant settings">
    {TABS.map(tab => <Link className="ui-button" key={tab.id} href={tab.href} prefetch={false} aria-current={active === tab.id ? "page" : undefined}>{tab.label}</Link>)}
  </nav>;
}
