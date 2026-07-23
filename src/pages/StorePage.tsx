import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Store,
  Package,
  BadgeCheck,
  Share2,
  Star,
  Search,
  Heart,
  Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Product, Profile } from '../lib/types';
import { ProductCard } from '../components/ProductCard';
import { useMetaPixel } from '../hooks/useMetaPixel';
import { getSubscriptionState } from '../lib/subscription';

interface StorePageProps {
  slug: string;
  navigate: (path: string) => void;
}

export function StorePage({ slug, navigate }: StorePageProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState('');
  const [following, setFollowing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('store_slug', slug)
        .maybeSingle();

      if (p) {
        setProfile(p);
        const { data: prods } = await supabase
          .from('products')
          .select('*')
          .eq('seller_id', p.id)
          .eq('in_stock', true)
          .order('created_at', { ascending: false });
        setProducts(prods ?? []);
      }
      setLoading(false);
    }
    load();
  }, [slug]);

  // Load this store's Meta Pixel (no-op if the vendor hasn't set one)
  useMetaPixel(profile?.meta_pixel_id, slug);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))],
    [products]
  );

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        const matchCat = !activeCat || p.category === activeCat;
        const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
        return matchCat && matchSearch;
      }),
    [products, activeCat, search]
  );

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div>
        <div className="h-56 sm:h-72 animate-shimmer" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="-mt-12 bg-white rounded-3xl border border-slate-100 shadow-card p-6 flex gap-5">
            <div className="w-24 h-24 rounded-3xl animate-shimmer" />
            <div className="flex-1 space-y-3">
              <div className="h-5 w-1/3 rounded-full animate-shimmer" />
              <div className="h-3 w-2/3 rounded-full animate-shimmer" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-rose-50 grid place-items-center">
          <Store className="w-10 h-10 text-rose-400" />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink mt-4">Boutique introuvable</h1>
        <p className="text-sm text-ink-muted mt-2">Cette boutique n'existe pas ou a été supprimée.</p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 inline-flex items-center gap-2 bg-ink text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour à l'accueil
        </button>
      </div>
    );
  }

  // Blocage fort: an unpaid / expired store is not publicly available.
  if (!getSubscriptionState(profile).active) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-amber-50 grid place-items-center">
          <Store className="w-10 h-10 text-amber-400" />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink mt-4">Boutique temporairement indisponible</h1>
        <p className="text-sm text-ink-muted mt-2">
          Cette boutique n'est pas active pour le moment. Revenez plus tard.
        </p>
        <button
          onClick={() => navigate('/')}
          className="mt-6 inline-flex items-center gap-2 bg-ink text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour à l'accueil
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Cover */}
      <div className="relative h-56 sm:h-72 lg:h-80 overflow-hidden">
        {profile.banner_url ? (
          <>
            <img src={profile.banner_url} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
          </>
        ) : (
          <>
            <div className="absolute inset-0 bg-brand-gradient-2" />
            <div className="absolute inset-0 bg-mesh opacity-70" />
            <div className="absolute inset-0 bg-grid opacity-20" />
          </>
        )}

        <button
          onClick={() => navigate('/')}
          className="absolute top-4 left-4 inline-flex items-center gap-2 bg-white/90 backdrop-blur-md text-ink-soft hover:text-ink text-xs font-semibold px-3 py-2 rounded-full shadow-soft transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>

        <button
          onClick={copyLink}
          className="absolute top-4 right-4 inline-flex items-center gap-2 bg-white/90 backdrop-blur-md text-ink-soft hover:text-ink text-xs font-semibold px-3 py-2 rounded-full shadow-soft transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />}
          {copied ? 'Copié' : 'Partager'}
        </button>
      </div>

      {/* Store header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="-mt-14 sm:-mt-16 bg-white rounded-3xl border border-slate-100 shadow-card p-5 sm:p-7 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-end gap-5">
            {/* Avatar */}
            <div className="relative">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-white border-4 border-white shadow-elevated overflow-hidden grid place-items-center -mt-12 sm:-mt-16">
                {profile.store_logo_url ? (
                  <img src={profile.store_logo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full bg-brand-gradient grid place-items-center text-white text-3xl font-extrabold font-display">
                    {profile.store_name?.[0]?.toUpperCase() || 'B'}
                  </span>
                )}
              </div>
              <span className="absolute -bottom-1 -right-1 w-7 h-7 grid place-items-center bg-emerald-500 text-white rounded-full border-2 border-white">
                <BadgeCheck className="w-4 h-4" />
              </span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-ink leading-tight">
                  {profile.store_name || 'Boutique'}
                </h1>
                <span className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full">
                  <BadgeCheck className="w-3 h-3" /> Vérifiée
                </span>
              </div>
              {profile.store_description ? (
                <p className="text-sm text-ink-muted mt-1.5 line-clamp-2 max-w-2xl">{profile.store_description}</p>
              ) : (
                <p className="text-sm text-ink-muted mt-1.5 italic">Aucune description pour cette boutique.</p>
              )}

              {/* Stats */}
              <div className="mt-4 flex items-center gap-5 text-xs">
                <Stat label="Produits" value={products.length.toString()} />
                <Divider />
                <Stat label="Note" value={<span className="inline-flex items-center gap-1">4.8 <Star className="w-3 h-3 text-amber-500 fill-current" /></span>} />
                <Divider />
                <Stat label="Avis" value="124" />
                <Divider />
                <Stat label="Réponse" value={<span className="text-emerald-600">&lt; 30 min</span>} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex sm:flex-col items-stretch gap-2 sm:ml-auto">
              <button
                onClick={() => setFollowing((f) => !f)}
                className={`flex items-center justify-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-full transition-all border ${
                  following
                    ? 'bg-rose-50 border-rose-200 text-rose-600'
                    : 'bg-white border-slate-200 text-ink-soft hover:border-rose-200 hover:text-rose-500'
                }`}
              >
                <Heart className={`w-4 h-4 ${following ? 'fill-current' : ''}`} />
                {following ? 'Suivie' : 'Suivre'}
              </button>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mt-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          {/* Search */}
          <div className="relative max-w-md w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Rechercher dans ${profile.store_name || 'cette boutique'}`}
              className="w-full pl-11 pr-4 py-3 text-sm bg-white border border-slate-200 rounded-full text-ink placeholder-ink-subtle focus:border-brand-300 focus:ring-brand transition-all"
            />
          </div>

          {/* Categories */}
          {categories.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
              <button
                onClick={() => setActiveCat('')}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  !activeCat
                    ? 'bg-ink text-white border-ink'
                    : 'bg-white border-slate-200 text-ink-soft hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                Tout ({products.length})
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCat(activeCat === c ? '' : c)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    activeCat === c
                      ? 'bg-ink text-white border-ink'
                      : 'bg-white border-slate-200 text-ink-soft hover:border-brand-300 hover:text-brand-700'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Products */}
        <div id="produits" className="py-8 pb-20 scroll-mt-24">
          {filtered.length === 0 ? (
            <div className="bg-white rounded-3xl border border-dashed border-slate-200 py-16 text-center">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-brand-50 grid place-items-center mb-4">
                <Package className="w-7 h-7 text-brand-500" />
              </div>
              <h3 className="font-display text-lg font-bold text-ink">
                {products.length === 0 ? 'Cette boutique est vide' : 'Aucun résultat'}
              </h3>
              <p className="text-sm text-ink-muted mt-1">
                {products.length === 0
                  ? 'Le vendeur n\'a pas encore ajouté de produits.'
                  : 'Essayez une autre recherche ou catégorie.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 stagger">
              {filtered.map((p, i) => (
                <ProductCard key={p.id} product={p} seller={profile} navigate={navigate} index={i} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm font-bold text-ink">{value}</span>
      <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">{label}</span>
    </div>
  );
}

function Divider() {
  return <span className="w-px h-7 bg-slate-200" />;
}
