"use client";

import Link from "next/link";
import type { MouseEvent } from "react";

const typed = (field: Element) => {
  if (field instanceof HTMLInputElement) {
    if (field.type === "hidden" || field.disabled) return false;
    return field.type === "checkbox" || field.type === "radio" ? field.checked !== field.defaultChecked : field.value !== field.defaultValue;
  }
  if (field instanceof HTMLTextAreaElement) return !field.disabled && field.value !== field.defaultValue;
  if (field instanceof HTMLSelectElement) return !field.disabled && [...field.options].some(option => option.selected !== option.defaultSelected);
  return false;
};

/** The step's form that holds typed, unsaved input: a form that carries a returnTo field and has a visible field changed from its default. */
function dirtyForm() {
  return [...document.querySelectorAll<HTMLFormElement>("form:has(input[name=returnTo])")].find(form => [...form.elements].some(typed));
}

/** Back, Skip and Next/Finish. Next and Finish first save what was typed and not yet saved, by submitting that same form (its own route and checks) with its returnTo pointed at the next page; Skip goes on without saving. Without JavaScript they are plain links. */
export function SetupNav({ back, next, last }: { back: string | null; next: string; last: boolean }) {
  function save(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const form = dirtyForm();
    const target = form?.querySelector<HTMLInputElement>("input[name=returnTo]");
    if (!form || !target) return;
    event.preventDefault();
    const original = target.value;
    target.value = next;
    form.requestSubmit(); // the submit handler reads the fields at once; required-field messages show and the person stays here
    target.value = original;
  }
  return <nav className="setup-nav" aria-label="Setup steps">
    {back && <Link className="ui-button" href={back}>Back</Link>}
    <span className="setup-nav-gap" />
    <Link className="setup-skip" href={next}>Skip</Link>
    <Link className="ui-button primary" href={next} onClick={save}>{last ? "Finish" : "Next"}</Link>
  </nav>;
}
