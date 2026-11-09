export type PanelPreferences = { open: boolean; spaceId: string | null };
export const CLOSED_PANEL: PanelPreferences = { open: false, spaceId: null };

const panelKey = (householdId: string) => `pes-ask-panel:${householdId}`;

export function readPanelPreferences(storage: Pick<Storage, "getItem">, householdId: string): PanelPreferences {
  try {
    const value = JSON.parse(storage.getItem(panelKey(householdId)) ?? "null");
    if (typeof value?.open !== "boolean") return CLOSED_PANEL;
    const spaceId = typeof value.spaceId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.spaceId) ? value.spaceId : null;
    return { open: value.open, spaceId };
  } catch {
    return CLOSED_PANEL;
  }
}

export function writePanelPreferences(storage: Pick<Storage, "setItem">, householdId: string, { open, spaceId }: PanelPreferences) {
  try {
    storage.setItem(panelKey(householdId), JSON.stringify({ open, spaceId }));
  } catch { /* The open panel still works when browser storage is blocked. */ }
}
