export const ASK_SCREEN_NAMES = {
  home: "Home",
  canvas: "Ask",
  check: "To check",
  activity: "Activity",
  cards: "Cards",
  clients: "Clients",
  plan: "Plan",
  memory: "Memory",
  settings: "Settings",
  invoices: "Invoices",
  options: "Options",
  upload: "Upload",
} as const;

export type AskScreen = keyof typeof ASK_SCREEN_NAMES;

const screenRoutes: Record<string, AskScreen> = {
  "": "home",
  canvas: "canvas",
  "to-check": "check",
  activity: "activity",
  cards: "cards",
  clients: "clients",
  plan: "plan",
  memory: "memory",
  settings: "settings",
  account: "settings",
  invoices: "invoices",
  options: "options",
  upload: "upload",
};

/** Only the section is sent. A row's path, query and contents never become context. */
export function askScreenForPath(pathname: string): AskScreen | undefined {
  const section = pathname.split("/", 2)[1];
  return section !== undefined && Object.hasOwn(screenRoutes, section) ? screenRoutes[section] : undefined;
}
