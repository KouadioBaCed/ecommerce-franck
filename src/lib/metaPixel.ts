/**
 * Typed Meta (Facebook) Pixel integration — no `any`.
 *
 * - One pixel is initialized at most once (anti double-load).
 * - The fbevents.js SDK is injected a single time, lazily.
 * - All tracking calls are no-ops until a pixel has been initialized, so
 *   nothing is sent when a store has no pixel configured.
 */

interface Fbq {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export interface AddToCartParams {
  content_ids?: string[];
  content_name?: string;
  content_type?: 'product';
  value?: number;
  currency?: string;
}

export interface PurchaseParams {
  value: number;
  currency: string;
  content_ids?: string[];
  content_name?: string;
  num_items?: number;
}

const FB_EVENTS_SRC = 'https://connect.facebook.net/en_US/fbevents.js';
const SCRIPT_ID = 'meta-pixel-sdk';
const initializedPixels = new Set<string>();

/** Meta Pixel IDs are numeric strings (typically 15–16 digits). */
export function isValidPixelId(value: string): boolean {
  return /^\d{10,20}$/.test(value.trim());
}

/** Injects the fbevents.js base snippet exactly once. */
function ensureBaseScript(): void {
  if (window.fbq) return;

  const fbq = function (this: unknown, ...args: unknown[]): void {
    if (fbq.callMethod) {
      fbq.callMethod.apply(fbq, args);
    } else {
      fbq.queue.push(args);
    }
  } as Fbq;

  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];

  window.fbq = fbq;
  if (!window._fbq) window._fbq = fbq;

  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = FB_EVENTS_SRC;
    document.head.appendChild(script);
  }
}

/**
 * Initialize a store's pixel. No-op if the id is missing/invalid or already
 * loaded — so visiting a store without a pixel never injects any script.
 */
export function initPixel(pixelId: string | null | undefined): void {
  if (!pixelId || !isValidPixelId(pixelId)) return;
  if (initializedPixels.has(pixelId)) return;
  ensureBaseScript();
  window.fbq?.('init', pixelId);
  initializedPixels.add(pixelId);
}

export function trackPageView(): void {
  window.fbq?.('track', 'PageView');
}

export function trackAddToCart(params?: AddToCartParams): void {
  window.fbq?.('track', 'AddToCart', params);
}

export function trackPurchase(params: PurchaseParams): void {
  window.fbq?.('track', 'Purchase', params);
}
