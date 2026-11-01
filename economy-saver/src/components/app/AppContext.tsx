"use client";

import { createContext, useContext, type ActionDispatch } from "react";
import type { Profile } from "@/lib/catalogue/types";
import type { MoneyState } from "@/lib/money/types";
import type { Persona, PersonaId } from "@/lib/sample/personas";
import type { Action, AppState, Stage } from "./state";
import type { TabId } from "./tabs";
import type { ToCheck } from "./toCheck";

// What every tab needs from the shell: the state, the one dispatch, the scripted demo and the way to move between tabs.
export type App = {
  state: AppState;
  persona: Persona;
  profile: Profile;
  money: MoneyState;
  fmt: (n: number) => string;
  stage: Stage;
  check: ToCheck;
  tab: TabId;
  dispatch: ActionDispatch<[Action]>;
  toast: (message: string) => void;
  go: (tab: TabId, scrollTo?: string) => void;
  approve: () => void;
  play: () => void;
  reset: () => void;
  startTrip: () => void;
  openStatement: () => void;
  switchPerson: (id: PersonaId) => void;
  reduced: boolean;
};

const Ctx = createContext<App | null>(null);
export const AppProvider = Ctx.Provider;

export function useApp(): App {
  const app = useContext(Ctx);
  if (!app) throw new Error("useApp needs the AppShell around it");
  return app;
}
