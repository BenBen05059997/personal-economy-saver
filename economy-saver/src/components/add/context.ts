"use client";
import { createContext, useContext } from "react";

export type AddKind = "bill" | "charge" | "client" | "card" | "person";

export type AddApi = {
  /** Opens the Add dialog for `kind`; `trigger` takes focus back when it closes. */
  openAdd: (kind: AddKind, trigger: HTMLElement | null) => void;
};

export const AddContext = createContext<AddApi | null>(null);

/** The Add host's API, or null outside it. A link then stays a plain link to the Add page, which is the no-JS path. */
export function useAdd(): AddApi | null {
  return useContext(AddContext);
}
