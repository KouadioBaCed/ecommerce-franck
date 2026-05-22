/**
 * Open a store's public page in a NEW browser tab.
 * Builds an absolute URL that preserves the current origin + base path
 * (e.g. `/workspace`) before the hash route, so it works in any environment.
 */
export function openStore(slug: string) {
  if (!slug) return;
  const base = `${window.location.origin}${window.location.pathname}`;
  window.open(`${base}#/store/${slug}`, '_blank', 'noopener,noreferrer');
}
