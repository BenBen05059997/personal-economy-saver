import type { loadSettings } from "@/db/settings";
import type { McpTokenInfo } from "@/db/mcp-tokens";
import { AddLink } from "@/components/add/AddLink";
import "@/components/household/household.css";
import { ApiForm } from "@/components/ui/ApiForm";
import { ConfirmRemove } from "@/components/ui/ConfirmRemove";
import { PercentInput } from "@/components/ui/CheckedInput";
import { FamilyShare, type FamilyLinkRow } from "@/components/settings/FamilyShare";
import { HouseholdAccess } from "@/components/settings/HouseholdAccess";
import { InvitePeople, type InviteRow } from "@/components/settings/InvitePeople";

type SettingsData = Awaited<ReturnType<typeof loadSettings>>;

/** Remove for one person who is not the owner: asks first and says where their bills and cards go (the rule is on `removeMember`). */
function RemovePerson({ person, people, cards }: { person: SettingsData["people"][number]; people: SettingsData["people"]; cards: SettingsData["cards"] }) {
  const owner = people.find(p => p.role === "owner")?.name ?? people[0].name;
  const note = [`${person.name}’s bills become shared and paid by ${owner}.`,
    ...(cards.some(card => card.memberId === person.id) ? [`Their cards become shared cards (${owner}’s if they carry shared charges).`] : []),
    ...(people.length > 2 ? ["Everyone’s share becomes equal again."] : [])].join(" ");
  return <div className="settings-bill"><p>{person.name}</p><ConfirmRemove kind="person" id={person.id} returnTo="/household/people" label={person.name} note={note} /></div>;
}

/** Household → People: names and shares, add and remove, invitations, family links and who has access. */
export function PeopleTab({ data, familyLinks, canManage, access }: {
  data: SettingsData; familyLinks: FamilyLinkRow[]; canManage: boolean; access: { invites: InviteRow[]; tokens: McpTokenInfo[]; invited: string[] } | null;
}) {
  const { people, cards } = data;
  return <>
    <section className="ui-panel" id="people">
      <header className="directory-header">
        <div><h2>People</h2>
          <p className="ui-hint">{people.length > 1 ? "Adding someone splits the shared costs equally again." : "Add a partner or housemate to split shared bills and charges. You start equal and can change the shares afterwards."}</p></div>
        <AddLink kind="person" className="ui-button primary">Add a person</AddLink>
      </header>
      <ApiForm action="/api/people"><input type="hidden" name="kind" value="people" />
        {people.length > 1 && <p className="ui-hint">Each person’s share of the shared bills and charges. The shares must total 100%.</p>}
        <div key={people.map(person => `${person.id}:${person.name}:${person.shareBp}`).join("|")}>{people.map(person => <div key={person.id} className="settings-person">
          <label className="ui-field">{person.role === "owner" ? "Owner’s name" : "Member’s name"}<input name={`name:${person.id}`} defaultValue={person.name} maxLength={80} required /></label>
          {people.length > 1 && <label className="ui-field">Share (%)<PercentInput name={`share:${person.id}`} defaultValue={String(person.shareBp / 100)} maxLength={6} required /></label>}
        </div>)}</div>
        <button className="ui-button">Save names</button></ApiForm>
      {canManage && people.length > 1 && <div className="settings-remove-people"><p className="ui-hint">A person can be removed once they owe nobody and nobody owes them.</p>
        {people.filter(person => person.role !== "owner").map(person => <RemovePerson key={person.id} person={person} people={people} cards={cards} />)}</div>}
      {access && <InvitePeople people={people.filter(person => person.role === "member" && !person.signedIn && !access.invited.includes(person.id))} invites={access.invites} />}
      {canManage && <FamilyShare links={familyLinks} />}
    </section>
    {access && <HouseholdAccess people={people} familyLinks={familyLinks} tokens={access.tokens} />}
  </>;
}
