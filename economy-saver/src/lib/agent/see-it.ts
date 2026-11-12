// The buttons that end an Ask answer (D60): where the person can see what the answer used or did. The words are ours, never the model's.
export type SeeIt = { href: string; label: string };
export const SEE_IT_MAX = 3;

/** An in-app page link; a "#note" anchor on the Ask page and a source with no address are not. */
const isPage = (href: string | undefined): href is string => Boolean(href) && !href!.startsWith("#");

/** An address as an in-app path: relative ones stay, an absolute one on `origin` loses its origin, any other origin is null. */
function inApp(href: string, origin: string): string | null {
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return origin !== "" && url.origin === origin ? url.pathname + url.search + url.hash : null;
  } catch { return null; }
}

/**
 * One row of buttons: the turn's own links first (they already say where something was kept), then "See it in <source> ›" for each
 * source that has a page; an absolute address on the app's own `origin` is made a path, one on another origin is dropped. One button per address, at most SEE_IT_MAX. `quiet` is what is left over, shown as plain text.
 */
export function seeItButtons<T extends { href?: string; label: string }>(links: readonly SeeIt[], sources: readonly T[], origin: string): { buttons: SeeIt[]; quiet: T[] } {
  const buttons: SeeIt[] = [];
  const add = (button: SeeIt) => { if (buttons.length < SEE_IT_MAX && !buttons.some(known => known.href === button.href)) buttons.push(button); };
  for (const link of links) { const href = inApp(link.href, origin); if (href !== null) add({ ...link, href }); }
  const pages = sources.map(source => ({ source, href: source.href === undefined ? undefined : inApp(source.href, origin) ?? undefined }));
  for (const { source, href } of pages) if (isPage(href)) add({ href, label: `See it in ${source.label} ›` });
  return { buttons, quiet: pages.filter(({ href }) => !isPage(href)).map(({ source }) => source) };
}
