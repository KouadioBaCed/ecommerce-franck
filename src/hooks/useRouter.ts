import { useState, useEffect } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'product'; id: string }
  | { name: 'store'; slug: string }
  | { name: 'auth' }
  | { name: 'admin' }
  | { name: 'admin-products' }
  | { name: 'admin-users' }
  | { name: 'admin-settings' };

function parseHash(hash: string): Route {
  const h = hash.replace('#', '');
  if (!h || h === '/') return { name: 'home' };
  if (h === '/auth') return { name: 'auth' };
  if (h === '/admin') return { name: 'admin' };
  if (h === '/admin/products') return { name: 'admin-products' };
  if (h === '/admin/users') return { name: 'admin-users' };
  if (h === '/admin/settings') return { name: 'admin-settings' };
  const productMatch = h.match(/^\/product\/(.+)$/);
  if (productMatch) return { name: 'product', id: productMatch[1] };
  const storeMatch = h.match(/^\/store\/(.+)$/);
  if (storeMatch) return { name: 'store', slug: storeMatch[1] };
  return { name: 'home' };
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  function navigate(path: string) {
    window.location.hash = path;
  }

  return { route, navigate };
}
