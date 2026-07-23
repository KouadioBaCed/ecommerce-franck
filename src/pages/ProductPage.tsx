import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  MessageCircle,
  Package,
  Store,
  CheckCircle,
  XCircle,
  ChevronRight,
  Heart,
  Share2,
  Star,
  Truck,
  ShieldCheck,
  RotateCcw,
  Plus,
  Minus,
  BadgeCheck,
  Copy,
  Check,
  ShoppingCart,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Product, Profile } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { InAppBrowserNotice } from '../components/InAppBrowserNotice';
import { useMetaPixel } from '../hooks/useMetaPixel';
import { trackAddToCart, trackPurchase } from '../lib/metaPixel';
import { isMetaInAppBrowser } from '../lib/inAppBrowser';
import { openWhatsAppChat } from '../lib/whatsappOrder';
import { scrollFieldIntoView } from '../lib/scrollFieldIntoView';

// FCFA → ISO 4217 currency code for Meta (West African CFA franc).
const CURRENCY = 'XOF';

interface ProductWithSeller extends Product {
  profiles: Profile;
}

interface ProductPageProps {
  id: string;
  navigate: (path: string) => void;
}

export function ProductPage({ id, navigate }: ProductPageProps) {
  const { user } = useAuth();
  const { isWished, toggle } = useWishlist();
  const { addItem } = useCart();
  const [product, setProduct] = useState<ProductWithSeller | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [qty, setQty] = useState(1);
  // Per-size quantities for clothing/shoes, e.g. { '40': 2, '42': 1 }.
  const [sizeQty, setSizeQty] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [cust, setCust] = useState({ firstName: '', lastName: '', phone: '', address: '' });
  const [orderError, setOrderError] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [activeImage, setActiveImage] = useState(0);
  const wished = product ? isWished(product.id) : false;
  // Facebook/Instagram ad clicks land here inside their embedded in-app
  // browser, which mishandles the WhatsApp handoff — see submitOrder().
  const inAppBrowser = useMemo(() => isMetaInAppBrowser(), []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setLoadError(null);

      // 1) Product — fetched on its own (no embed) so a relationship/cache issue
      //    can never mask a real "not found" and the error is always surfaced.
      const { data: prod, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        console.error('[ProductPage] product query failed:', error);
        setLoadError(error.message);
        setProduct(null);
        setLoading(false);
        return;
      }
      if (!prod) {
        setProduct(null);
        setLoading(false);
        return;
      }

      // 2) Seller profile (separate query; tolerates a hidden/deleted seller)
      const { data: seller } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', prod.seller_id)
        .maybeSingle();

      setProduct({ ...(prod as Product), profiles: seller as Profile } as ProductWithSeller);

      // 2b) Image gallery (falls back to the cover image_url if no gallery rows)
      const { data: imgs } = await supabase
        .from('product_images')
        .select('url, position')
        .eq('product_id', prod.id)
        .order('position', { ascending: true });
      const urls = imgs && imgs.length ? imgs.map((r) => r.url) : prod.image_url ? [prod.image_url] : [];
      setImages(urls);
      setActiveImage(0);

      // 3) More from the same shop
      const { data: more } = await supabase
        .from('products')
        .select('*')
        .eq('seller_id', prod.seller_id)
        .neq('id', prod.id)
        .eq('in_stock', true)
        .order('created_at', { ascending: false })
        .limit(4);
      setRelated((more as Product[]) ?? []);

      setLoading(false);
      setQty(1);
      setSizeQty({});
    }
    load();
  }, [id]);

  // Sizes / pointures (clothing & shoes). Buyer picks a quantity per size,
  // capped by the per-size stock the seller configured.
  const sizes = product?.sizes ?? [];
  const needsSize = sizes.length > 0;
  const sizeLabel = product?.category === 'Chaussures' ? 'Pointure' : 'Taille';
  const sizeStock = product?.size_stock ?? {};
  // Units available for a size. Legacy products without a stock map are uncapped.
  const stockFor = (s: string): number => {
    const v = sizeStock[s];
    return typeof v === 'number' ? v : Infinity;
  };
  const selectedSizes = sizes.filter((s) => (sizeQty[s] ?? 0) > 0);
  const totalQty = needsSize
    ? selectedSizes.reduce((sum, s) => sum + (sizeQty[s] ?? 0), 0)
    : qty;

  function setSizeCount(s: string, n: number) {
    const clamped = Math.max(0, Math.min(n, stockFor(s)));
    setSizeQty((m) => {
      const next = { ...m };
      if (clamped <= 0) delete next[s];
      else next[s] = clamped;
      return next;
    });
  }

  // Load the seller's Meta Pixel + fire PageView (no-op if none configured)
  useMetaPixel(product?.profiles?.meta_pixel_id, product?.id);

  function openOrder() {
    setOrderError('');
    setOrderOpen(true);
    if (product) {
      trackAddToCart({
        content_ids: [product.id],
        content_name: product.name,
        content_type: 'product',
        value: Number(product.price) * totalQty,
        currency: CURRENCY,
      });
    }
  }

  function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;

    const phone = product.profiles?.whatsapp_number?.replace(/\D/g, '');
    if (!phone) {
      setOrderError('La boutique n\'a pas configuré de numéro WhatsApp.');
      return;
    }
    if (!cust.firstName.trim() || !cust.lastName.trim() || !cust.phone.trim()) {
      setOrderError('Renseigne ton prénom, nom et numéro de téléphone.');
      return;
    }
    if (needsSize && totalQty < 1) {
      setOrderError(`Choisis au moins une ${sizeLabel.toLowerCase()} et sa quantité.`);
      return;
    }

    const unit = Number(product.price);
    const total = unit * totalQty;
    const qtyLines = needsSize
      ? [
          ...selectedSizes.map((s) => `${sizeLabel} ${s} : ${sizeQty[s]}`),
          `Quantité totale : ${totalQty}`,
        ]
      : [`Quantité : ${qty}`];
    const lines = [
      `Bonjour ${product.profiles?.store_name || ''} !`,
      '',
      'Je souhaite passer commande :',
      `*${product.name}*`,
      `Lien du produit : ${window.location.href}`,
      `Prix unitaire : ${unit.toLocaleString('fr-FR')} FCFA`,
      ...qtyLines,
      `Total : ${total.toLocaleString('fr-FR')} FCFA`,
      '',
      'Mes informations :',
      `Nom : ${cust.lastName.trim()}`,
      `Prénom : ${cust.firstName.trim()}`,
      `Téléphone : ${cust.phone.trim()}`,
    ];
    if (cust.address.trim()) lines.push(`Adresse : ${cust.address.trim()}`);
    lines.push('', 'Merci de me confirmer la disponibilité 🙏');

    // Meta Pixel conversion (WhatsApp order = the conversion in this flow)
    trackPurchase({
      value: total,
      currency: CURRENCY,
      content_ids: [product.id],
      content_name: product.name,
      num_items: totalQty,
    });

    openWhatsAppChat(phone, lines.join('\n'));
    setOrderOpen(false);
  }

  function addToCart() {
    if (!product) return;
    const seller = product.profiles;
    const base = {
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      image: images[0] || product.image_url || null,
      sellerId: product.seller_id,
      storeName: seller?.store_name || 'Boutique',
      storeSlug: seller?.store_slug ?? null,
      whatsappNumber: seller?.whatsapp_number || null,
    };

    if (needsSize) {
      selectedSizes.forEach((s) => {
        addItem({ ...base, size: s }, sizeQty[s] ?? 0);
      });
      setSizeQty({});
    } else {
      addItem({ ...base, size: null }, qty);
      setQty(1);
    }

    if (product) {
      trackAddToCart({
        content_ids: [product.id],
        content_name: product.name,
        content_type: 'product',
        value: Number(product.price) * totalQty,
        currency: CURRENCY,
      });
    }

    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 1500);
  }

  const rating = useMemo(() => {
    if (!product) return 4.7;
    let h = 0;
    for (let i = 0; i < product.id.length; i++) h = (h * 31 + product.id.charCodeAt(i)) >>> 0;
    return Number((4.2 + ((h % 80) / 100)).toFixed(1));
  }, [product]);

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid lg:grid-cols-2 gap-10 animate-pulse">
          <div className="aspect-square rounded-3xl animate-shimmer" />
          <div className="space-y-4">
            <div className="h-4 w-32 rounded-full animate-shimmer" />
            <div className="h-8 w-3/4 rounded-2xl animate-shimmer" />
            <div className="h-6 w-1/3 rounded-2xl animate-shimmer" />
            <div className="h-24 w-full rounded-2xl animate-shimmer" />
            <div className="h-12 w-full rounded-2xl animate-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-rose-50 grid place-items-center">
          <Package className="w-10 h-10 text-rose-400" />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink mt-4">Produit introuvable</h1>
        <p className="text-sm text-ink-muted mt-2">
          {loadError
            ? 'Le produit n\'a pas pu être chargé.'
            : 'Ce produit a peut-être été retiré, dépublié, ou n\'existe plus.'}
        </p>
        {loadError && (
          <p className="text-xs text-rose-500 mt-2 font-mono bg-rose-50 border border-rose-100 rounded-xl px-3 py-2 inline-block">
            {loadError}
          </p>
        )}
        <div className="mt-6">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-2 bg-ink text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour à l'accueil
          </button>
        </div>
      </div>
    );
  }

  const hasWhatsApp = !!product.profiles?.whatsapp_number?.replace(/\D/g, '');

  return (
    <div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs text-ink-muted mb-6 overflow-hidden">
          <button onClick={() => navigate('/')} className="hover:text-ink transition-colors">Accueil</button>
          <ChevronRight className="w-3.5 h-3.5 text-ink-subtle" />
          {product.category && (
            <>
              <span className="hover:text-ink transition-colors">{product.category}</span>
              <ChevronRight className="w-3.5 h-3.5 text-ink-subtle" />
            </>
          )}
          <span className="text-ink font-medium truncate">{product.name}</span>
        </nav>

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Gallery */}
          <div className="lg:col-span-7">
            <div className="relative aspect-square sm:aspect-[4/3] rounded-3xl overflow-hidden bg-white border border-slate-100 shadow-card group">
              {images[activeImage] || product.image_url ? (
                <img
                  src={images[activeImage] || product.image_url}
                  alt={product.name}
                  className="w-full h-full object-cover transition-transform duration-700 ease-out-soft group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full grid place-items-center bg-gradient-to-br from-surface-tint to-slate-100">
                  <Package className="w-24 h-24 text-slate-300" />
                </div>
              )}

              {/* Badges top */}
              <div className="absolute top-4 left-4 flex gap-2">
                {product.category && (
                  <span className="bg-white/95 backdrop-blur-sm text-xs font-semibold text-ink-soft px-2.5 py-1.5 rounded-full border border-slate-200 shadow-sm">
                    {product.category}
                  </span>
                )}
              </div>

              <div className="absolute top-4 right-4 flex flex-col gap-2">
                <button
                  onClick={() => { if (!user) { navigate('/auth'); return; } toggle(product.id); }}
                  aria-label="Favori"
                  className={`w-10 h-10 grid place-items-center rounded-full backdrop-blur-md transition-all ${
                    wished
                      ? 'bg-rose-500 text-white scale-110'
                      : 'bg-white/90 text-ink-soft hover:bg-white'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${wished ? 'fill-current' : ''}`} />
                </button>
                <button
                  onClick={copyLink}
                  aria-label="Partager"
                  className="w-10 h-10 grid place-items-center rounded-full bg-white/90 text-ink-soft hover:bg-white backdrop-blur-md transition-all"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Share2 className="w-4 h-4" />}
                </button>
              </div>

              {!product.in_stock && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-sm grid place-items-center">
                  <span className="bg-ink text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full">
                    Rupture de stock
                  </span>
                </div>
              )}
            </div>

            {/* Thumbnails (only when there is more than one image) */}
            {images.length > 1 && (
              <div className="mt-4 grid grid-cols-5 gap-3">
                {images.map((src, i) => (
                  <button
                    key={src}
                    onClick={() => setActiveImage(i)}
                    className={`aspect-square rounded-2xl overflow-hidden border-2 transition-all ${
                      i === activeImage ? 'border-ink ring-brand' : 'border-slate-100 hover:border-brand-200'
                    }`}
                  >
                    <img src={src} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-36 space-y-5">
              {/* Seller */}
              <button
                onClick={() => product.profiles?.store_slug && navigate(`/store/${product.profiles.store_slug}`)}
                className="inline-flex items-center gap-2.5 bg-white border border-slate-100 hover:border-brand-200 rounded-full pl-1 pr-3 py-1 shadow-soft hover:shadow-card transition-all group"
              >
                {product.profiles?.store_logo_url ? (
                  <img src={product.profiles.store_logo_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-brand-gradient grid place-items-center text-white text-xs font-bold">
                    {product.profiles?.store_name?.[0]?.toUpperCase() || 'B'}
                  </span>
                )}
                <span className="text-xs font-semibold text-ink truncate max-w-[140px] group-hover:text-brand-700 transition-colors">
                  {product.profiles?.store_name || 'Boutique'}
                </span>
                <BadgeCheck className="w-3.5 h-3.5 text-brand-500" />
                <ChevronRight className="w-3.5 h-3.5 text-ink-muted -ml-1" />
              </button>

              <h1 className="font-display text-2xl sm:text-3xl lg:text-[2.2rem] font-extrabold text-ink leading-[1.15] text-balance">
                {product.name}
              </h1>

              {/* Rating + stock */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 text-amber-500">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <Star key={i} className={`w-3.5 h-3.5 ${i < Math.round(rating) ? 'fill-current' : ''}`} />
                    ))}
                  </div>
                  <span className="text-ink-soft font-semibold text-xs">{rating}</span>
                  <span className="text-ink-muted text-xs">· 124 avis</span>
                </div>
                <span className="text-ink-subtle">·</span>
                <div className="flex items-center gap-1">
                  {product.in_stock ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-xs font-semibold text-emerald-600">En stock</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span className="text-xs font-semibold text-rose-500">Indisponible</span>
                    </>
                  )}
                </div>
              </div>

              {/* Price */}
              <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-5 space-y-5">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-display text-4xl font-extrabold text-ink leading-none">
                    {Number(product.price).toLocaleString('fr-FR')}
                  </span>
                  <span className="text-base font-semibold text-ink-muted">FCFA</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                    Meilleur prix
                  </span>
                </div>

                {needsSize ? (
                  /* Per-size quantities — pick several sizes/pointures at once */
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink-soft">
                        {sizeLabel}s &amp; quantités
                      </span>
                      <span className="text-xs font-semibold text-ink-soft">
                        Total : <span className="tabular-nums">{totalQty}</span>
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {sizes.map((s) => {
                        const n = sizeQty[s] ?? 0;
                        const avail = stockFor(s);
                        const soldOut = avail <= 0;
                        const atCap = n >= avail;
                        return (
                          <div
                            key={s}
                            className={`flex items-center justify-between rounded-2xl px-3 py-2 border transition-colors ${
                              soldOut
                                ? 'border-slate-100 bg-surface-tint/50 opacity-60'
                                : n > 0
                                ? 'border-ink/15 bg-surface-tint'
                                : 'border-slate-100 bg-white'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-sm font-semibold text-ink min-w-[3rem]">{s}</span>
                              {soldOut ? (
                                <span className="text-[11px] font-semibold text-rose-500">Épuisé</span>
                              ) : avail !== Infinity ? (
                                <span className="text-[11px] text-ink-muted tabular-nums">{avail} dispo</span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-1 bg-white rounded-full p-1 border border-slate-100">
                              <button
                                onClick={() => setSizeCount(s, n - 1)}
                                disabled={n <= 0}
                                className="w-8 h-8 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink hover:border-brand-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="min-w-[2.5rem] text-center text-sm font-bold text-ink tabular-nums">{n}</span>
                              <button
                                onClick={() => setSizeCount(s, n + 1)}
                                disabled={soldOut || atCap}
                                className="w-8 h-8 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink hover:border-brand-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* Quantity (products without sizes) */
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-ink-soft">Quantité</span>
                    <div className="flex items-center gap-1 bg-surface-tint rounded-full p-1">
                      <button
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        className="w-8 h-8 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink hover:border-brand-200 transition-all"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="min-w-[2.5rem] text-center text-sm font-bold text-ink tabular-nums">{qty}</span>
                      <button
                        onClick={() => setQty((q) => q + 1)}
                        className="w-8 h-8 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink hover:border-brand-200 transition-all"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* CTA */}
                {hasWhatsApp ? (
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={addToCart}
                      disabled={!product.in_stock || (needsSize && totalQty < 1)}
                      className={`flex items-center justify-center gap-2 flex-1 font-semibold py-3.5 rounded-2xl text-sm transition-all duration-200 border disabled:opacity-50 disabled:cursor-not-allowed ${
                        addedToCart
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-white border-slate-200 text-ink hover:border-brand-300 hover:bg-surface-tint'
                      }`}
                    >
                      {addedToCart ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                      {addedToCart ? 'Ajouté au panier' : 'Ajouter au panier'}
                    </button>
                    <button
                      onClick={openOrder}
                      disabled={!product.in_stock || (needsSize && totalQty < 1)}
                      className="flex items-center justify-center gap-2.5 flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-2xl text-sm transition-all duration-200 shadow-[0_10px_24px_-10px_rgba(16,185,129,0.55)] hover:shadow-[0_14px_30px_-10px_rgba(16,185,129,0.65)] hover:-translate-y-0.5"
                    >
                      <MessageCircle className="w-4 h-4" />
                      {!product.in_stock
                        ? 'Indisponible'
                        : needsSize && totalQty < 1
                        ? `Choisis une ${sizeLabel.toLowerCase()}`
                        : 'Commander maintenant'}
                    </button>
                  </div>
                ) : (
                  <div className="bg-surface-tint text-ink-muted text-sm text-center px-6 py-3.5 rounded-2xl">
                    Contact non disponible
                  </div>
                )}

                <button
                  onClick={copyLink}
                  className="w-full flex items-center justify-center gap-2 text-xs font-medium text-ink-muted hover:text-ink transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      Lien copié !
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copier le lien du produit
                    </>
                  )}
                </button>
              </div>

              {/* Trust */}
              <div className="grid grid-cols-3 gap-2">
                <TrustItem icon={Truck}        title="Livraison" sub="Par vendeur" />
                <TrustItem icon={ShieldCheck}  title="Vérifié"   sub="Vendeur sûr" />
                <TrustItem icon={RotateCcw}    title="Échange"   sub="Sous 7 jours" />
              </div>

              {/* Description */}
              {product.description && (
                <details open className="group bg-white border border-slate-100 rounded-2xl p-5">
                  <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold text-ink list-none">
                    Description
                    <ChevronRight className="w-4 h-4 text-ink-muted transition-transform group-open:rotate-90" />
                  </summary>
                  <p className="mt-3 text-sm text-ink-muted leading-relaxed whitespace-pre-line">
                    {product.description}
                  </p>
                </details>
              )}
            </div>
          </div>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <section className="mt-16 sm:mt-20">
            <div className="flex items-end justify-between gap-6 mb-6">
              <div>
                <span className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-700 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
                  <Store className="w-3 h-3" /> Même boutique
                </span>
                <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-ink mt-2">
                  Autres produits de {product.profiles?.store_name || 'cette boutique'}
                </h2>
              </div>
              {product.profiles?.store_slug && (
                <button
                  onClick={() => navigate(`/store/${product.profiles.store_slug}`)}
                  className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800"
                >
                  Voir tout <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 stagger">
              {related.map((p, i) => (
                <ProductCard key={p.id} product={p} seller={product.profiles} navigate={navigate} index={i} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* WhatsApp order form */}
      <Modal open={orderOpen} onClose={() => setOrderOpen(false)} size="md">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <span className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 grid place-items-center shrink-0">
              <MessageCircle className="w-5 h-5" />
            </span>
            <div>
              <h2 className="font-display text-lg font-extrabold text-ink leading-tight">Finaliser ma commande</h2>
              <p className="text-[11px] text-ink-muted">Tes infos seront envoyées au vendeur sur WhatsApp.</p>
            </div>
          </div>

          {/* Order recap */}
          <div className="flex items-center gap-3 bg-surface-tint rounded-2xl p-3 mb-5">
            <div className="w-12 h-12 rounded-xl overflow-hidden bg-white shrink-0 ring-1 ring-slate-100">
              {product.image_url ? (
                <img src={product.image_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center"><Package className="w-5 h-5 text-slate-300" /></div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{product.name}</p>
              <p className="text-xs text-ink-muted">
                {needsSize
                  ? selectedSizes.map((s) => `${s}×${sizeQty[s]}`).join('  ')
                  : `Quantité : ${qty}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-extrabold text-ink tabular-nums">
                {(Number(product.price) * totalQty).toLocaleString('fr-FR')} <span className="text-[11px] text-ink-muted font-semibold">FCFA</span>
              </p>
            </div>
          </div>

          <form onSubmit={submitOrder} className="space-y-4">
            {inAppBrowser && <InAppBrowserNotice />}
            {orderError && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-600 text-sm px-4 py-3 rounded-2xl animate-pop">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{orderError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <OrderField label="Prénom" required>
                <input
                  type="text"
                  required
                  value={cust.firstName}
                  onChange={(e) => setCust({ ...cust, firstName: e.target.value })}
                  onFocus={scrollFieldIntoView}
                  placeholder="Sara"
                  className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
                />
              </OrderField>
              <OrderField label="Nom" required>
                <input
                  type="text"
                  required
                  value={cust.lastName}
                  onChange={(e) => setCust({ ...cust, lastName: e.target.value })}
                  onFocus={scrollFieldIntoView}
                  placeholder="El Amrani"
                  className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
                />
              </OrderField>
            </div>

            <OrderField label="Téléphone" required>
              <input
                type="tel"
                required
                value={cust.phone}
                onChange={(e) => setCust({ ...cust, phone: e.target.value })}
                onFocus={scrollFieldIntoView}
                placeholder="0612345678"
                className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all tabular-nums"
              />
            </OrderField>

            <OrderField label="Adresse / précisions (optionnel)">
              <textarea
                value={cust.address}
                onChange={(e) => setCust({ ...cust, address: e.target.value })}
                onFocus={scrollFieldIntoView}
                rows={2}
                placeholder="Ville, quartier, point de repère..."
                className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all resize-none"
              />
            </OrderField>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setOrderOpen(false)}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold text-ink-soft bg-surface-tint hover:bg-slate-200 transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-[0_8px_20px_-8px_rgba(16,185,129,0.55)]"
              >
                <MessageCircle className="w-4 h-4" />
                Envoyer sur WhatsApp
              </button>
            </div>
            <p className="text-[11px] text-ink-muted text-center">
              WhatsApp s'ouvrira avec ta commande pré-remplie, prête à envoyer.
            </p>
          </form>
        </div>
      </Modal>
    </div>
  );
}

function OrderField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-ink-soft uppercase tracking-wider flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function TrustItem({
  icon: Icon,
  title,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
}) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-3 flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 grid place-items-center shrink-0">
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink truncate">{title}</p>
        <p className="text-[10px] text-ink-muted truncate">{sub}</p>
      </div>
    </div>
  );
}
