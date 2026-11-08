"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiForm, ApiFormGroup } from "@/components/ui/ApiForm";
import { FORM_FETCH_HEADER } from "@/lib/form-fetch";

export type InviteRow = { id: string; name: string; email: string; expiresAt: string; expiresLabel: string };
type Person = { id: string; name: string };

export function InvitePeople({ people, invites }: { people: Person[]; invites: InviteRow[] }) {
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [memberId, setMemberId] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const linkField = useRef<HTMLInputElement>(null);
  const chosen = people.some(person => person.id === memberId) ? memberId : "";
  const busy = working || refreshing;

  async function makeInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    if (!chosen) body.delete("memberId");
    setWorking(true);
    setMessage("");
    setUrl("");
    try {
      const response = await fetch("/api/invites", { method: "POST", body, headers: { [FORM_FETCH_HEADER]: "1" } });
      if (!response.ok) { setMessage(await response.text()); return; }
      const { url: created } = await response.json() as { url: string };
      setUrl(created);
      setMemberId("");
      form.reset();
      refresh(() => router.refresh());
    } catch {
      setMessage("Couldn’t show the invite link. Check Pending invitations before trying again.");
    } finally {
      setWorking(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Invite link copied.");
    } catch {
      linkField.current?.focus();
      linkField.current?.select();
      setMessage("Copy the selected link.");
    }
  }

  return <div className="settings-family" id="invite-people">
    <h3>Invite someone</h3>
    <p className="ui-hint">Send the person a seven-day invite link. They’ll join using the email address you enter.</p>
    <form className="settings-invite-form" method="post" action="/api/invites" onSubmit={makeInvite} aria-busy={busy}>
      <fieldset disabled={busy}>
        <input type="hidden" name="kind" value="create" />
        <label className="ui-field">Email address<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
        <label className="ui-field">Person
          <select name="memberId" value={chosen} onChange={event => setMemberId(event.target.value)}>
            <option value="">Add a new person</option>
            {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        {!chosen && <>
          <label className="ui-field">Name<input name="name" maxLength={80} required aria-describedby="invite-new-person-note" /></label>
          <p className="ui-hint" id="invite-new-person-note">Creating a new person divides shared costs equally again.</p>
        </>}
        <button type="submit" className="ui-button">Create invite link</button>
      </fieldset>
    </form>
    {url && <div className="ui-field settings-invite-form">
      <label htmlFor="new-invite-link">Copy this invite link now. It’s shown once.</label>
      <input id="new-invite-link" ref={linkField} readOnly value={url} onFocus={event => event.target.select()} autoComplete="off" spellCheck={false} />
      <div className="settings-reminder-actions">
        <button type="button" className="ui-button" onClick={() => void copy()}>Copy invite link</button>
        <button type="button" className="ui-button" onClick={() => { setUrl(""); setMessage(""); }}>Done</button>
      </div>
    </div>}
    <p className="ui-hint" role="status">{message}</p>
    {invites.length > 0 && <>
      <h3>Pending invitations</h3>
      <ApiFormGroup>{invites.map(invite => <div className="ui-row settings-invite-form" key={invite.id}>
        <div><strong>{invite.name}</strong><p className="ui-hint">{invite.email} · Expires <time dateTime={invite.expiresAt}>{invite.expiresLabel}</time></p></div>
        <ApiForm action="/api/invites" onDone={() => { setUrl(""); setMessage(""); }}>
          <input type="hidden" name="kind" value="cancel" />
          <input type="hidden" name="id" value={invite.id} />
          <button type="submit" className="ui-button" aria-label={"Cancel invitation for " + invite.name}>Cancel invitation</button>
        </ApiForm>
      </div>)}</ApiFormGroup>
    </>}
  </div>;
}
