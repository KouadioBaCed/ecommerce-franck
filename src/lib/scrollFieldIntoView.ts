import type { FocusEvent } from 'react';

/**
 * iOS Safari doesn't reliably auto-scroll a focused field inside a fixed,
 * scrollable modal once the keyboard opens — force it once the keyboard
 * animation has settled.
 *
 * `block: 'start'` is deliberate, not `'center'`: some in-app browsers
 * (Facebook/Instagram) never actually shrink the modal's on-screen box for
 * the keyboard — the keyboard just overlays whatever pixels happen to be
 * there. The panel's top edge is the one region that's reliably still above
 * the keyboard (it starts near the top of the screen), so scrolling a field
 * there is safe. `'center'` was landing fields in the panel's vertical
 * midpoint, which sits right behind the keyboard on those browsers.
 */
export function scrollFieldIntoView(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget;
  window.setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 300);
}
