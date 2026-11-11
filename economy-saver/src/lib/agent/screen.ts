export const ASK_SCREEN_NAMES = {
  home: "Home",
  canvas: "Ask",
  check: "To check",
  bills: "Bills",
  cards: "Cards",
  clients: "Clients",
  spending: "Spending",
  saving: "Saving",
  household: "Household",
  memory: "Memory",
  settings: "Settings",
  invoices: "Invoices",
  options: "Options",
  upload: "Upload",
  setup: "Setup",
  add: "Add",
} as const;

export type AskScreen = keyof typeof ASK_SCREEN_NAMES;

const screenRoutes: Record<string, AskScreen> = {
  "": "home",
  canvas: "canvas",
  "to-check": "check",
  bills: "bills",
  cards: "cards",
  clients: "clients",
  spending: "spending",
  saving: "saving",
  household: "household",
  memory: "memory",
  settings: "settings",
  account: "settings",
  invoices: "invoices",
  options: "options",
  upload: "upload",
  setup: "setup",
  add: "add",
};

/** Only the section is sent. A row's path, query and contents never become context. */
export function askScreenForPath(pathname: string): AskScreen | undefined {
  const section = pathname.split("/", 2)[1];
  return section !== undefined && Object.hasOwn(screenRoutes, section) ? screenRoutes[section] : undefined;
}
