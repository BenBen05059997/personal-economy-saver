// The icon drawings shared by more than one face: the 16-unit line icons by name, and the two marks drawn the same everywhere.

export const iconPaths = {
  home: "M2.5 7.2 8 2.8l5.5 4.4V13h-11z M6.5 13V9.5h3V13",
  check: "M2.5 9.5 4 3.5h8l1.5 6 M2.5 9.5V13h11V9.5H10l-1 1.5H7l-1-1.5z",
  ask: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z",
  menu: "M3 4.5h10 M3 8h10 M3 11.5h10",
  cards: "M3.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11V5a1.5 1.5 0 0 1 1.5-1.5z M2 6.8h12",
  clients: "M2.5 5.5h11v7h-11z M6 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5 M2.5 9h11",
  people: "M8.2 6A2.2 2.2 0 1 1 3.8 6a2.2 2.2 0 0 1 4.4 0z M2 13c.3-2.4 2-3.6 4-3.6s3.7 1.2 4 3.6 M10.5 4.2a2.2 2.2 0 0 1 0 3.6 M12 9.6c1 .5 1.8 1.5 2 3.4",
  bill: "M4 2.5h8v11l-1.6-1-1.2 1-1.2-1-1.2 1-1.2-1-1.6 1z M6 6h4 M6 8.5h4",
  memory: "M4 2.5h8v11l-4-2.5-4 2.5z",
  spending: "M3 12.5V9 M7 12.5V5.5 M11 12.5V3 M2.5 12.5h11",
  saving: "M5.5 2.5h5 M4.5 5h7 M4 5.6v6.4a1.5 1.5 0 0 0 1.5 1.5h5a1.5 1.5 0 0 0 1.5-1.5V5.6 M6.2 8.8h3.6",
  settings: "M3 5h2 M8 5h5 M3 11h6 M12 11h1 M8 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z M12 11a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
  mic: "M6 4a2 2 0 0 1 4 0v3.5a2 2 0 0 1-4 0z M3.5 7.8a4.5 4.5 0 0 0 9 0 M8 12.3V14",
  plus: "M8 3v10 M3 8h10",
  bell: "M2.5 11.5c1.3-1.3 1.6-2.5 1.6-5.1a3.9 3.9 0 1 1 7.8 0c0 2.6.3 3.8 1.6 5.1z M6.5 13.3a1.7 1.7 0 0 0 3 0",
  close: "M3.5 3.5l9 9 M12.5 3.5l-9 9",
};

/** The check mark of a saved or confirmed thing, at `size` pixels. */
export function CheckIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>;
}

/** The cross that closes a panel or drawer. */
export function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>;
}
