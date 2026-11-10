export type PanelPreferences = { open: boolean; spaceId: string | null };
export type PanelChoice = { open: boolean | null; spaceId: string | null };
export const CLOSED_PANEL: PanelPreferences = { open: false, spaceId: null };

const panelKey = (householdId: string) => `pes-ask-panel:${householdId}`;

/** Null means the person has not chosen open or closed; the viewport decides. */
export function readPanelChoice(storage: Pick<Storage, "getItem">, householdId: string): PanelChoice {
  try {
    const value = JSON.parse(storage.getItem(panelKey(householdId)) ?? "null");
    const open = typeof value?.open === "boolean" ? value.open : null;
    const spaceId = typeof value?.spaceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.spaceId) ? value.spaceId : null;
    return { open, spaceId };
  } catch {
    return { open: null, spaceId: null };
  }
}

export function readPanelPreferences(storage: Pick<Storage, "getItem">, householdId: string, defaultOpen = false): PanelPreferences {
  const choice = readPanelChoice(storage, householdId);
  return { open: choice.open ?? defaultOpen, spaceId: choice.spaceId };
}

/** Keep space selection without turning a viewport default into a user choice. */
export function writePanelChoice(storage: Pick<Storage, "setItem">, householdId: string, { open, spaceId }: PanelChoice) {
  try {
    storage.setItem(panelKey(householdId), JSON.stringify(open === null ? { spaceId } : { open, spaceId }));
  } catch { /* The open panel still works when browser storage is blocked. */ }
}

export function writePanelPreferences(storage: Pick<Storage, "setItem">, householdId: string, { open, spaceId }: PanelPreferences) {
  try {
    storage.setItem(panelKey(householdId), JSON.stringify({ open, spaceId }));
  } catch { /* The open panel still works when browser storage is blocked. */ }
}
