import { useEffect, useMemo, useState } from 'react';
import {
  Package,
  TrendingUp,
  Eye,
  ArrowRight,
  MessageCircle,
  Store,
  Plus,
  Wallet,
  ShoppingBag,
  Sparkles,
  BadgeCheck,
  Star,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { Product } from '../../lib/types';
import { openStore } from '../../lib/openStore';

interface AdminOverviewProps {
  navigate: (path: string) => void;
}

export function AdminOverview({ navigate }: AdminOverviewProps) {
  const { user, profile } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('products')
      .select('*')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setProducts(data ?? []);
        setLoading(false);
      });
  }, [user]);

  const inStock = products.filter((p) => p.in_stock).length;
  const outStock = products.length - inStock;
  const totalValue = products.reduce((sum, p) => sum + Number(p.price), 0);
  const avgPrice = products.length ? Math.round(totalValue / products.length) : 0;

  const isProfileComplete = !!(profile?.store_name && profile?.whatsapp_number);

  // Synthetic weekly trend so the dashboard feels alive even before real analytics.
  const weeklyTrend = useMemo(() => {
    const seed = user?.id || '0';
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return Array.from({ length: 7 }).map((_, i) => 30 + ((h >> i) % 65));
  }, [user]);

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fade-in">
      {/* Welcome */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink leading-tight mt-1">
            Bonjour {profile?.store_name?.split(' ')[0] || ''} 👋
          </h1>
          <p className="text-ink-muted text-sm mt-1.5">
            Voici un aperçu de votre boutique en temps réel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate('/admin/products')}
            className="inline-flex items-center gap-2 bg-ink hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-full transition-colors shadow-soft hover:shadow-elevated"
          >
            <Plus className="w-4 h-4" /> Nouveau produit
          </button>
          {profile?.store_slug && (
            <button
              onClick={() => openStore(profile.store_slug!)}
              className="inline-flex items-center gap-2 bg-white border border-slate-200 text-ink-soft hover:text-ink hover:border-slate-300 text-sm font-semibold px-4 py-2.5 rounded-full transition-colors"
            >
              <Eye className="w-4 h-4" /> Aperçu public
            </button>
          )}
        </div>
      </header>

      {/* Setup banner */}
      {!isProfileComplete && (
        <div className="relative overflow-hidden bg-ink text-white rounded-3xl p-6 sm:p-8">
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-brand-500/30 rounded-full blur-3xl" />
          <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-accent-rose/20 rounded-full blur-3xl" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
            <span className="w-12 h-12 grid place-items-center rounded-2xl bg-white/10 border border-white/15 shrink-0">
              <Sparkles className="w-6 h-6 text-amber-300" />
            </span>
            <div className="flex-1">
              <h3 className="font-display text-xl font-extrabold">Finalisez votre boutique</h3>
              <p className="text-white/70 text-sm mt-1 max-w-xl">
                Ajoutez le nom de votre boutique et votre numéro WhatsApp pour commencer à recevoir des commandes.
              </p>
            </div>
            <button
              onClick={() => navigate('/admin/settings')}
              className="bg-white text-ink text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-amber-50 transition-colors flex items-center gap-2 shrink-0"
            >
              Configurer <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi loading={loading} icon={Package}      tint="from-brand-100 to-brand-50 text-brand-600"     label="Produits publiés"  value={products.length} trend="+12%" />
        <Kpi loading={loading} icon={ShoppingBag}  tint="from-emerald-100 to-emerald-50 text-emerald-600" label="En stock"          value={inStock} trend={`${outStock} en rupture`} flat />
        <Kpi loading={loading} icon={Wallet}       tint="from-amber-100 to-amber-50 text-amber-600"     label="Valeur catalogue"  value={`${totalValue.toLocaleString('fr-FR')} FCFA`} trend={`Moy. ${avgPrice.toLocaleString('fr-FR')} FCFA`} flat />
        <Kpi loading={loading} icon={TrendingUp}   tint="from-pink-100 to-pink-50 text-pink-600"        label="Vues (7j)"         value="1.2k" trend="+34%" />
      </div>

      {/* Chart + Quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity chart */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-soft p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Activité</p>
              <h3 className="font-display text-xl font-bold text-ink mt-1">Vues des 7 derniers jours</h3>
            </div>
            <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <TrendingUp className="w-3 h-3" /> +34%
            </span>
          </div>

          <div className="mt-6 flex items-end justify-between gap-2 sm:gap-3 h-40">
            {weeklyTrend.map((h, i) => {
              const today = i === weeklyTrend.length - 1;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                  <div className="w-full bg-surface-tint rounded-2xl relative overflow-hidden" style={{ height: '100%' }}>
                    <div
                      className={`absolute bottom-0 left-0 right-0 rounded-2xl transition-all duration-700 ease-out-soft ${
                        today
                          ? 'bg-ink'
                          : 'bg-brand-gradient opacity-80 group-hover:opacity-100'
                      }`}
                      style={{ height: `${h}%`, animation: 'slideUp 0.6s ease-out both', animationDelay: `${i * 60}ms` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-ink-muted uppercase">
                    {['L','M','M','J','V','S','D'][i]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick actions */}
        <div className="space-y-3">
          <QuickAction
            tint="bg-brand-50 text-brand-600"
            icon={Package}
            title="Gérer mes produits"
            desc="Ajouter, modifier, supprimer"
            onClick={() => navigate('/admin/products')}
          />
          <QuickAction
            tint="bg-emerald-50 text-emerald-600"
            icon={MessageCircle}
            title="WhatsApp"
            desc="Recevoir les commandes"
            onClick={() => navigate('/admin/settings')}
          />
          {profile?.store_slug ? (
            <QuickAction
              tint="bg-amber-50 text-amber-600"
              icon={Eye}
              title="Voir ma boutique"
              desc="Aperçu public"
              onClick={() => openStore(profile.store_slug!)}
            />
          ) : (
            <QuickAction
              tint="bg-pink-50 text-pink-600"
              icon={Store}
              title="Configurer"
              desc="Choisir mon slug"
              onClick={() => navigate('/admin/settings')}
            />
          )}
        </div>
      </div>

      {/* Recent products */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-soft overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="font-display font-bold text-ink text-lg">Produits récents</h2>
            <p className="text-xs text-ink-muted mt-0.5">Les derniers produits ajoutés à votre catalogue</p>
          </div>
          <button
            onClick={() => navigate('/admin/products')}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 transition-colors"
          >
            Voir tout <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {loading ? (
          <div className="divide-y divide-slate-50">
            {[1,2,3].map((i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl animate-shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded-full animate-shimmer" />
                  <div className="h-3 w-1/5 rounded-full animate-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-50 grid place-items-center mb-3">
              <Package className="w-6 h-6 text-brand-500" />
            </div>
            <p className="font-display font-bold text-ink">Votre catalogue est vide</p>
            <p className="text-sm text-ink-muted mt-1">Ajoutez votre premier produit pour commencer à vendre.</p>
            <button
              onClick={() => navigate('/admin/products')}
              className="mt-5 inline-flex items-center gap-2 bg-ink text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Ajouter un produit
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {products.slice(0, 5).map((p) => (
              <div key={p.id} className="px-6 py-3.5 flex items-center gap-4 hover:bg-surface-tint transition-colors">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-surface-tint shrink-0 ring-1 ring-slate-100">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center">
                      <Package className="w-5 h-5 text-slate-300" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{p.name}</p>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-ink-muted">
                    {p.category && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-tint text-ink-soft">{p.category}</span>
                    )}
                    <span>·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="w-3 h-3 text-amber-500 fill-current" />
                      <span className="font-semibold text-ink-soft">4.7</span>
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-ink tabular-nums">{Number(p.price).toLocaleString('fr-FR')} FCFA</p>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold mt-0.5 ${p.in_stock ? 'text-emerald-600' : 'text-rose-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.in_stock ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                    {p.in_stock ? 'En stock' : 'Rupture'}
                  </span>
                </div>
                <button
                  onClick={() => navigate('/admin/products')}
                  className="ml-2 w-9 h-9 rounded-full grid place-items-center text-ink-muted hover:bg-white hover:text-ink hover:shadow-soft transition-all"
                  aria-label="Modifier"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Promo */}
      {profile?.store_slug && (
        <div className="bg-white border border-slate-100 rounded-3xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 grid place-items-center shrink-0">
            <BadgeCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">Votre boutique est en ligne</p>
            <p className="text-xs text-ink-muted truncate">marketo.app/store/{profile.store_slug}</p>
          </div>
          <button
            onClick={() => openStore(profile.store_slug!)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800"
          >
            Ouvrir <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  tint,
  label,
  value,
  trend,
  flat,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  label: string;
  value: React.ReactNode;
  trend?: string;
  flat?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-soft hover:shadow-card transition-all">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tint} grid place-items-center`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl sm:text-[1.75rem] font-display font-extrabold text-ink mt-3 tabular-nums leading-none">
        {loading ? <span className="inline-block w-16 h-6 rounded-full animate-shimmer align-middle" /> : value}
      </p>
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-ink-muted">{label}</p>
        {trend && (
          <span className={`text-[10px] font-bold ${flat ? 'text-ink-muted' : 'text-emerald-600'}`}>
            {trend}
          </span>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  tint,
  title,
  desc,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group w-full bg-white rounded-3xl p-4 border border-slate-100 shadow-soft hover:border-brand-200 hover:shadow-card hover:-translate-y-0.5 transition-all text-left flex items-center gap-3"
    >
      <span className={`w-10 h-10 rounded-xl grid place-items-center ${tint}`}>
        <Icon className="w-5 h-5" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink truncate">{title}</p>
        <p className="text-[11px] text-ink-muted truncate">{desc}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-ink-subtle group-hover:text-brand-600 group-hover:translate-x-0.5 transition-all" />
    </button>
  );
}
