import "@/components/family/family.css";

// The same answer for an unknown, an expired and a stopped link: the page cannot tell which, and says nothing else.
export default function FamilyLinkEnded() {
  return <main className="family-ended"><h1>This link has ended.</h1><p>Ask for a new one.</p></main>;
}
