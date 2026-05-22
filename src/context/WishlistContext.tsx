import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface WishlistContextType {
  ids: Set<string>;
  loading: boolean;
  isWished: (productId: string) => boolean;
  /** Returns the new state (true = added), or null if the user is not signed in. */
  toggle: (productId: string) => Promise<boolean | null>;
}

const WishlistContext = createContext<WishlistContextType | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      setIds(new Set());
      return;
    }
    let active = true;
    setLoading(true);
    supabase
      .from('wishlists')
      .select('product_id')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (!active) return;
        setIds(new Set((data ?? []).map((r) => r.product_id)));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const isWished = useCallback((id: string) => ids.has(id), [ids]);

  const flip = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const toggle = useCallback(
    async (productId: string): Promise<boolean | null> => {
      if (!user) return null;

      // Optimistic update
      setIds((prev) => flip(prev, productId));

      const { data, error } = await supabase.rpc('toggle_wishlist', {
        p_product_id: productId,
      });

      if (error) {
        // Revert on failure
        setIds((prev) => flip(prev, productId));
        return null;
      }
      return data as boolean;
    },
    [user]
  );

  return (
    <WishlistContext.Provider value={{ ids, loading, isWished, toggle }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
