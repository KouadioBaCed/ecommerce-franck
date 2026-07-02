/**
 * Open a store's public page in a NEW browser tab.
 * Builds an absolute URL on the current origin (history-based routing).
 */
export function openStore(slug: string) {
  if (!slug) return;
  window.open(`${window.location.origin}/store/${slug}`, '_blank', 'noopener,noreferrer');
}
