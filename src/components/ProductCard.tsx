import { useMemo } from 'react';
import { Heart, Eye, Star, Package, ShoppingBag, BadgeCheck } from 'lucide-react';
import type { Product, Profile } from '../lib/types';
import { useWishlist } from '../context/WishlistContext';
import { useAuth } from '../context/AuthContext';

interface ProductCardProps {
  product: Product;
  seller?: Profile;
  navigate: (path: string) => void;
  index?: number;
}

function hashRating(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const rating = 4.2 + ((h % 80) / 100);
  const reviews = 12 + (h % 480);
  return { rating: Math.min(5, Number(rating.toFixed(1))), reviews };
}

export function ProductCard({ product, seller, navigate, index = 0 }: ProductCardProps) {
  const { user } = useAuth();
  const { isWished, toggle } = useWishlist();
  const wished = isWished(product.id);
  const { rating, reviews } = useMemo(() => hashRating(product.id), [product.id]);

  // Promo placeholder derived from id — purely visual hint, no logic change.
  const isPromo = useMemo(() => (product.id.charCodeAt(0) % 4) === 0, [product.id]);
  const oldPrice = isPromo ? Math.round(Number(product.price) * 1.25) : null;
  const isNew = useMemo(() => {
    if (!product.created_at) return false;
    const days = (Date.now() - new Date(product.created_at).getTime()) / 86400000;
    return days < 14;
  }, [product.created_at]);

  function open(e?: React.MouseEvent) {
    e?.stopPropagation();
    navigate(`/product/${product.id}`);
  }

  function toggleWish(e: React.MouseEvent) {
    e.stopPropagation();
    if (!user) {
      navigate('/auth');
      return;
    }
    toggle(product.id);
  }

  function openStore(e: React.MouseEvent) {
    e.stopPropagation();
    if (seller?.store_slug) navigate(`/store/${seller.store_slug}`);
  }

  return (
    <article
      onClick={open}
      style={{ animationDelay: `${Math.min(index * 35, 320)}ms` }}
      className="group relative flex flex-col bg-white rounded-3xl border border-slate-100 hover:border-brand-100 shadow-soft hover:shadow-elevated transition-all duration-300 cursor-pointer overflow-hidden lift animate-fade-in"
    >
      {/* Image */}
      <div className="relative aspect-square bg-gradient-to-br from-surface-tint to-slate-100 overflow-hidden">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-700 ease-out-soft group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full grid place-items-center">
            <Package className="w-14 h-14 text-slate-300" />
          </div>
        )}

        {/* Top badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {isPromo && (
            <span className="inline-flex items-center gap-1 bg-rose-500 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full shadow-sm">
              -20%
            </span>
          )}
          {isNew && !isPromo && (
            <span className="inline-flex items-center gap-1 bg-ink text-white text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full shadow-sm">
              Nouveau
            </span>
          )}
          {product.category && (
            <span className="hidden sm:inline-flex items-center bg-white/95 backdrop-blur-sm text-[10px] font-semibold text-ink-soft px-2 py-1 rounded-full border border-slate-200 shadow-sm">
              {product.category}
            </span>
          )}
        </div>

        {/* Wishlist */}
        <button
          onClick={toggleWish}
          aria-label="Ajouter aux favoris"
          className={`absolute top-3 right-3 w-9 h-9 grid place-items-center rounded-full border backdrop-blur-md transition-all ${
            wished
              ? 'bg-rose-500 border-rose-500 text-white scale-110'
              : 'bg-white/90 border-white text-ink-soft hover:bg-white hover:scale-110'
          }`}
        >
          <Heart className={`w-4 h-4 transition-all ${wished ? 'fill-current' : ''}`} />
        </button>

        {/* Hover quick action */}
        <div className="absolute inset-x-3 bottom-3 translate-y-3 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
          <button
            onClick={open}
            className="w-full flex items-center justify-center gap-2 bg-white/95 backdrop-blur-md text-ink text-xs font-semibold py-2.5 rounded-full shadow-elevated hover:bg-ink hover:text-white transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            Aperçu rapide
          </button>
        </div>

        {/* Out of stock veil */}
        {!product.in_stock && (
          <div className="absolute inset-0 bg-white/75 backdrop-blur-[2px] grid place-items-center">
            <span className="bg-ink text-white text-[11px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
              Rupture
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col p-4">
        {/* Seller chip */}
        {seller && (
          <button
            onClick={openStore}
            className="flex items-center gap-1.5 self-start text-[11px] font-medium text-ink-muted hover:text-brand-700 transition-colors mb-2"
          >
            {seller.store_logo_url ? (
              <img src={seller.store_logo_url} alt="" className="w-4 h-4 rounded-full object-cover" />
            ) : (
              <span className="w-4 h-4 rounded-full bg-brand-gradient grid place-items-center text-white text-[8px] font-bold">
                {seller.store_name?.[0]?.toUpperCase()}
              </span>
            )}
            <span className="truncate max-w-[120px]">{seller.store_name}</span>
            <BadgeCheck className="w-3 h-3 text-brand-500" />
          </button>
        )}

        <h3 className="text-sm font-semibold text-ink leading-snug line-clamp-2 group-hover:text-brand-700 transition-colors">
          {product.name}
        </h3>

        {/* Rating */}
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-ink-muted">
          <span className="flex items-center gap-0.5 text-amber-500">
            <Star className="w-3 h-3 fill-current" />
            <span className="font-semibold text-ink-soft">{rating}</span>
          </span>
          <span className="text-ink-subtle">({reviews})</span>
        </div>

        {/* Price */}
        <div className="mt-auto pt-3 flex items-end justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-extrabold text-ink leading-none">
              {Number(product.price).toLocaleString('fr-FR')}
            </span>
            <span className="text-xs font-semibold text-ink-muted">FCFA</span>
            {oldPrice && (
              <span className="text-xs text-ink-subtle line-through ml-1">
                {oldPrice.toLocaleString('fr-FR')}
              </span>
            )}
          </div>
          <span className="w-9 h-9 rounded-full bg-brand-50 text-brand-600 grid place-items-center group-hover:bg-ink group-hover:text-white transition-all duration-300">
            <ShoppingBag className="w-4 h-4" strokeWidth={2.4} />
          </span>
        </div>
      </div>
    </article>
  );
}
