import { useEffect } from 'react';
import { initPixel, trackPageView } from '../lib/metaPixel';

/**
 * Initializes the given store's Meta Pixel and fires a PageView.
 * - Re-fires PageView when `pageKey` changes (SPA route changes within the
 *   same store), since `initPixel` itself is idempotent per pixel id.
 * - No pixel id → does nothing (clean fallback).
 */
export function useMetaPixel(pixelId: string | null | undefined, pageKey?: string): void {
  useEffect(() => {
    if (!pixelId) return;
    initPixel(pixelId);
    trackPageView();
  }, [pixelId, pageKey]);
}
