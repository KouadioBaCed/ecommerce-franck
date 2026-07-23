/**
 * Detects Facebook/Instagram/Messenger's embedded in-app browser (WKWebView
 * on iOS, a constrained Chrome WebView on Android). These WebViews handle
 * `window.open`-triggered popups and app-scheme handoffs differently from a
 * real browser, which is what breaks WhatsApp click-to-chat links opened
 * from a Facebook ad — see submitOrder() in ProductPage.tsx.
 */
export function isMetaInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger/i.test(ua);
}
