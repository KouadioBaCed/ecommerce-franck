import type { FocusEvent } from 'react';

/**
 * iOS Safari doesn't reliably auto-scroll a focused field inside a fixed,
 * scrollable modal once the keyboard opens — force it once the keyboard
 * animation/visualViewport resize (see Modal.tsx) has settled.
 */
export function scrollFieldIntoView(e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget;
  window.setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 300);
}
