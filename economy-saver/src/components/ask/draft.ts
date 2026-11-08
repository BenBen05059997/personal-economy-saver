// The hand-over from the top bar to the Ask page: a character typed on the bar waits in sessionStorage until the page takes it.
export const DRAFT_KEY = "pes-ask-draft";
export const DRAFT_EVENT = "pes-ask-draft";

// What waits there: a typed character as a plain string, spoken words as JSON with their source. Both forms are read.
export type Draft = { text: string; source: "manual" | "voice" };

export function storeDraft(draft: Draft): void {
  try { window.sessionStorage.setItem(DRAFT_KEY, draft.source === "voice" ? JSON.stringify(draft) : draft.text); } catch { /* storage can be blocked: the page opens with an empty box */ }
}

export function takeStoredDraft(): Draft | null {
  try {
    const stored = window.sessionStorage.getItem(DRAFT_KEY);
    if (stored === null) return null;
    window.sessionStorage.removeItem(DRAFT_KEY);
    if (stored.length > 1 && stored.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(stored);
        if (parsed && typeof parsed === "object" && typeof (parsed as Draft).text === "string") return { text: (parsed as Draft).text, source: (parsed as Draft).source === "voice" ? "voice" : "manual" };
      } catch { /* a plain string that starts with a brace */ }
    }
    return { text: stored, source: "manual" };
  } catch { return null; }
}
