import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';

export interface CartLine {
  key: string;
  productId: string;
  name: string;
  price: number;
  image: string | null;
  size: string | null;
  qty: number;
  sellerId: string;
  storeName: string;
  storeSlug: string | null;
  whatsappNumber: string | null;
}

interface CartContextType {
  items: CartLine[];
  count: number;
  addItem: (line: Omit<CartLine, 'key' | 'qty'>, qty?: number) => void;
  removeItem: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  clearSeller: (sellerId: string) => void;
  clear: () => void;
}

const STORAGE_KEY = 'marketoos_cart_v1';
const CartContext = createContext<CartContextType | null>(null);

// No login required — buyers order anonymously via WhatsApp, so the cart is
// purely client-side and persisted to localStorage (not the `carts` table,
// which is tied to an authenticated user_id).
function loadInitial(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartLine[]>(loadInitial);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const addItem = useCallback((line: Omit<CartLine, 'key' | 'qty'>, qty = 1) => {
    const key = `${line.productId}::${line.size ?? ''}`;
    setItems((prev) => {
      const existing = prev.find((i) => i.key === key);
      if (existing) {
        return prev.map((i) => (i.key === key ? { ...i, qty: i.qty + qty } : i));
      }
      return [...prev, { ...line, key, qty }];
    });
  }, []);

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const setQty = useCallback((key: string, qty: number) => {
    setItems((prev) => {
      if (qty <= 0) return prev.filter((i) => i.key !== key);
      return prev.map((i) => (i.key === key ? { ...i, qty } : i));
    });
  }, []);

  const clearSeller = useCallback((sellerId: string) => {
    setItems((prev) => prev.filter((i) => i.sellerId !== sellerId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = useMemo(() => items.reduce((sum, i) => sum + i.qty, 0), [items]);

  const value = useMemo(
    () => ({ items, count, addItem, removeItem, setQty, clearSeller, clear }),
    [items, count, addItem, removeItem, setQty, clearSeller, clear]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
