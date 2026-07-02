import { useState, useEffect } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'product'; id: string }
  | { name: 'store'; slug: string }
  | { name: 'auth' }
  | { name: 'admin' }
  | { name: 'admin-products' }
  | { name: 'admin-users' }
  | { name: 'admin-settings' }
  | { name: 'admin-subscription' }
  | { name: 'admin-payments' };

function parsePath(pathname: string): Route {
  // Strip trailing slashes (keep root as '/')
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return { name: 'home' };
  if (p === '/auth') return { name: 'auth' };
  if (p === '/admin') return { name: 'admin' };
  if (p === '/admin/products') return { name: 'admin-products' };
  if (p === '/admin/users') return { name: 'admin-users' };
  if (p === '/admin/settings') return { name: 'admin-settings' };
  if (p === '/admin/subscription') return { name: 'admin-subscription' };
  if (p === '/admin/payments') return { name: 'admin-payments' };
  const productMatch = p.match(/^\/product\/(.+)$/);
  if (productMatch) return { name: 'product', id: decodeURIComponent(productMatch[1]) };
  const storeMatch = p.match(/^\/store\/(.+)$/);
  if (storeMatch) return { name: 'store', slug: decodeURIComponent(storeMatch[1]) };
  return { name: 'home' };
}

// Backward-compat: links shared while the app used hash routing look like
// `/#/product/123`. Rewrite them to the real path on first load so old links
// keep working. (Supabase puts `#access_token=...` in the hash — that does not
// start with `#/`, so it is left untouched for AuthContext to handle.)
function initialPath(): string {
  const hash = window.location.hash;
  if (hash.startsWith('#/')) {
    const path = hash.slice(1);
    window.history.replaceState({}, '', path);
    return path;
  }
  return window.location.pathname;
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parsePath(initialPath()));

  useEffect(() => {
    const handler = () => setRoute(parsePath(window.location.pathname));
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  function navigate(path: string) {
    if (path !== window.location.pathname) {
      window.history.pushState({}, '', path);
    }
    setRoute(parsePath(path));
    window.scrollTo(0, 0);
  }

  return { route, navigate };
}
