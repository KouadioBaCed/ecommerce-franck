import { useEffect, useMemo, useState } from 'react';
import {
  SlidersHorizontal,
  Store,
  Sparkles,
  ShieldCheck,
  Truck,
  MessageCircle,
  ArrowRight,
  Flame,
  ChevronRight,
  Instagram,
  Twitter,
  Facebook,
  Star,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Product, Profile } from '../lib/types';
import { ProductCard } from '../components/ProductCard';

interface ProductWithSeller extends Product {
  profiles: Profile;
}

interface HomePageProps {
  navigate: (path: string) => void;
}

export function HomePage({ navigate }: HomePageProps) {
  const [products, setProducts] = useState<ProductWithSeller[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase
        .from('products')
        .select('*, profiles(*)')
        .eq('in_stock', true)
        .order('created_at', { ascending: false });

      if (data) {
        setProducts(data as ProductWithSeller[]);
        const cats = [...new Set(data.map((p) => p.category).filter(Boolean))];
        setCategories(cats);
      }
      setLoading(false);
    }
    load();
  }, []);

  const trending = useMemo(() => products.slice(0, 8), [products]);
  const featuredStores = useMemo(() => {
    const map = new Map<string, Profile & { count: number }>();
    products.forEach((p) => {
      if (!p.profiles?.id) return;
      const existing = map.get(p.profiles.id);
      if (existing) existing.count += 1;
      else map.set(p.profiles.id, { ...p.profiles, count: 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  }, [products]);

  return (
    <div className="min-h-screen bg-surface-alt">
      <Hero
        categories={categories}
        onPick={setCategory}
        navigate={navigate}
      />

      <TrustStrip />

      {/* Filter bar */}
      <div className="sticky top-16 md:top-32 z-30 border-b border-slate-100 bg-white/85 glass">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-2 text-ink-muted shrink-0">
            <SlidersHorizontal className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">Filtrer</span>
          </div>
          <Chip active={!category} onClick={() => setCategory('')}>Tout</Chip>
          {categories.map((cat) => (
            <Chip key={cat} active={category === cat} onClick={() => setCategory(cat === category ? '' : cat)}>
              {cat}
            </Chip>
          ))}
        </div>
      </div>

      {/* Trending */}
      {!loading && trending.length > 0 && !category && (
        <Section
          eyebrow={<span className="inline-flex items-center gap-1.5"><Flame className="w-3.5 h-3.5" /> Tendance maintenant</span>}
          title="Les coups de coeur de la semaine"
          subtitle="Les produits les plus convoités par notre communauté."
          action={
            <button className="hidden sm:inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 transition-colors">
              Voir tout <ChevronRight className="w-4 h-4" />
            </button>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 stagger">
            {trending.slice(0, 4).map((p, i) => (
              <ProductCard
                key={p.id}
                product={p}
                seller={p.profiles}
                navigate={navigate}
                index={i}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Promo banner */}
      {!loading && !category && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12">
          <div className="relative overflow-hidden rounded-3xl bg-brand-gradient-2 p-8 sm:p-12">
            <div className="absolute inset-0 bg-grid opacity-30" />
            <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
            <div className="absolute -left-10 -bottom-10 w-72 h-72 rounded-full bg-accent-rose/20 blur-3xl" />

            <div className="relative grid sm:grid-cols-5 gap-6 items-center">
              <div className="sm:col-span-3 text-white">
                <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm border border-white/20 rounded-full px-3 py-1 text-xs font-semibold mb-4">
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  Lancement officiel
                </span>
                <h3 className="font-display text-3xl sm:text-4xl font-extrabold leading-tight text-balance">
                  Devenez vendeur en 2 minutes — sans commission cachée.
                </h3>
                <p className="text-white/80 mt-3 max-w-md text-sm sm:text-base">
                  Créez votre vitrine, importez vos produits, recevez vos commandes directement sur WhatsApp.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    onClick={() => navigate('/auth')}
                    className="inline-flex items-center gap-2 bg-white text-ink font-semibold px-5 py-3 rounded-full hover:bg-amber-50 transition-colors shadow-elevated"
                  >
                    Ouvrir ma boutique
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 text-white font-semibold px-5 py-3 rounded-full hover:bg-white/20 transition-colors">
                    En savoir plus
                  </button>
                </div>
              </div>

              <div className="sm:col-span-2 hidden sm:flex justify-end">
                <div className="relative">
                  <div className="w-56 h-56 rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 rotate-6 animate-float grid place-items-center">
                    <Store className="w-20 h-20 text-white/90" strokeWidth={1.4} />
                  </div>
                  <div className="absolute -bottom-4 -left-8 bg-white text-ink rounded-2xl px-3 py-2 shadow-elevated flex items-center gap-2 text-xs font-semibold">
                    <span className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 grid place-items-center">
                      <MessageCircle className="w-3.5 h-3.5" />
                    </span>
                    +12 commandes reçues
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Featured stores */}
      {!loading && featuredStores.length > 0 && !category && (
        <Section
          eyebrow="Boutiques en vedette"
          title="Découvrez nos meilleurs vendeurs"
          subtitle="Une sélection de boutiques actives et reconnues par la communauté."
        >
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {featuredStores.map((s, i) => (
              <button
                key={s.id}
                onClick={() => s.store_slug && navigate(`/store/${s.store_slug}`)}
                style={{ animationDelay: `${i * 40}ms` }}
                className="group relative text-left bg-white rounded-3xl border border-slate-100 hover:border-brand-200 shadow-soft hover:shadow-elevated transition-all overflow-hidden lift animate-fade-in"
              >
                <div className="h-20 bg-brand-gradient relative overflow-hidden">
                  {s.banner_url && (
                    <img src={s.banner_url} alt="" className="w-full h-full object-cover opacity-70" />
                  )}
                </div>
                <div className="px-4 pb-4 -mt-7">
                  <div className="w-12 h-12 rounded-2xl bg-white border-4 border-white shadow-card overflow-hidden grid place-items-center">
                    {s.store_logo_url ? (
                      <img src={s.store_logo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full bg-brand-gradient grid place-items-center text-white font-bold">
                        {s.store_name?.[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-semibold text-ink truncate text-sm">{s.store_name || 'Boutique'}</p>
                  <p className="text-xs text-ink-muted mt-0.5 flex items-center gap-2">
                    <span>{s.count} produit{s.count > 1 ? 's' : ''}</span>
                    <span className="inline-flex items-center gap-0.5 text-amber-500">
                      <Star className="w-3 h-3 fill-current" />
                      <span className="font-semibold text-ink-soft">4.8</span>
                    </span>
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

      <Newsletter />
      <Footer navigate={navigate} />
    </div>
  );
}

/* --------- Sub-components --------- */

function Hero({
  categories,
  onPick,
  navigate,
}: {
  categories: string[];
  onPick: (c: string) => void;
  navigate: (path: string) => void;
}) {
  return (
    <section className="relative overflow-hidden pt-10 pb-16 sm:pt-16 sm:pb-24">
      <div className="absolute inset-0 bg-mesh" />
      <div className="absolute inset-0 bg-grid opacity-60" />
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-brand-200/40 rounded-full blur-3xl" />
      <div className="absolute -bottom-40 -left-32 w-96 h-96 bg-pink-200/30 rounded-full blur-3xl" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 text-center lg:text-left animate-slide-up">
            <span className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-slate-200 shadow-soft rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Plateforme nouvelle génération
            </span>

            <h1 className="font-display mt-5 text-4xl sm:text-5xl lg:text-6xl font-extrabold text-ink leading-[1.05] text-balance">
              La marketplace où{' '}
              <span className="text-gradient">tout le monde gagne</span>.
            </h1>

            <p className="mt-5 text-base sm:text-lg text-ink-muted max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Des milliers de produits proposés par des vendeurs vérifiés. Commandez en 1 clic via WhatsApp, sans intermédiaire.
            </p>

            {/* Primary CTA — accéder à sa boutique (connexion / inscription) */}
            <div className="mt-6 flex justify-center lg:justify-start">
              <button
                onClick={() => navigate('/auth')}
                className="inline-flex items-center gap-2 bg-ink hover:bg-brand-700 text-white font-semibold px-6 py-3.5 rounded-full shadow-elevated hover:shadow-glow hover:-translate-y-0.5 transition-all"
              >
                <Store className="w-4.5 h-4.5" />
                Accéder à ma boutique
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Search */}
            <form
              onSubmit={(e) => e.preventDefault()}
              className="mt-8 max-w-2xl mx-auto lg:mx-0 relative"
            >

              {categories.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-center lg:justify-start gap-2 text-xs">
                  <span className="text-ink-subtle font-medium">Populaire :</span>
                  {categories.slice(0, 5).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => onPick(c)}
                      className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-ink-soft hover:border-brand-300 hover:text-brand-700 transition-colors"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </form>

            {/* Stats row */}
            <div className="mt-10 grid grid-cols-3 gap-3 sm:max-w-md mx-auto lg:mx-0">
              <Stat label="Produits" value="10k+" />
              <Stat label="Vendeurs" value="850" />
              <Stat label="Satisfaction" value="98%" />
            </div>
          </div>

          {/* Hero visual */}
          <div className="lg:col-span-5 hidden lg:block relative">
            <div className="relative mx-auto w-[420px] h-[480px]">
              <div className="absolute inset-0 bg-brand-gradient rounded-[40px] -rotate-6 opacity-95 shadow-[0_30px_60px_-20px_rgba(99,102,241,0.55)]" />
              <div className="absolute inset-2 bg-white rounded-[36px] overflow-hidden border border-white shadow-elevated">
                <div className="p-6 h-full flex flex-col">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-brand-gradient grid place-items-center">
                        <Store className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-ink">Atelier Aurora</p>
                        <p className="text-[10px] text-ink-muted flex items-center gap-1">
                          <BadgeIcon /> Vendeur vérifié
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">En ligne</span>
                  </div>

                  <div className="mt-5 flex-1 rounded-2xl bg-gradient-to-br from-rose-100 via-amber-50 to-pink-100 relative overflow-hidden">
                    <div className="absolute bottom-3 left-3 right-3 bg-white/95 backdrop-blur-sm rounded-2xl p-3 shadow-card">
                      <p className="text-xs font-semibold text-ink line-clamp-1">Sac à dos minimaliste cuir vegan</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-sm font-extrabold text-ink">490 <span className="text-[10px] text-ink-muted">FCFA</span></span>
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500">
                          <Star className="w-3 h-3 fill-current" />
                          <span className="font-semibold text-ink-soft">4.9</span>
                          <span className="text-ink-subtle">(127)</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <button className="mt-4 w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm rounded-2xl py-3 flex items-center justify-center gap-2 shadow-[0_10px_24px_-12px_rgba(16,185,129,0.6)]">
                    <MessageCircle className="w-4 h-4" /> Commander sur WhatsApp
                  </button>
                </div>
              </div>

              {/* Floating badges */}
              <div className="absolute -top-6 -left-6 bg-white rounded-2xl px-3 py-2 shadow-elevated flex items-center gap-2 animate-float">
                <span className="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 grid place-items-center">
                  <Sparkles className="w-4 h-4" />
                </span>
                <div>
                  <p className="text-[10px] text-ink-muted">Nouveau</p>
                  <p className="text-xs font-bold text-ink">+24 boutiques</p>
                </div>
              </div>

              <div className="absolute -bottom-6 -right-6 bg-white rounded-2xl px-3 py-2 shadow-elevated flex items-center gap-2 animate-float" style={{ animationDelay: '1s' }}>
                <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 grid place-items-center">
                  <ShieldCheck className="w-4 h-4" />
                </span>
                <div>
                  <p className="text-[10px] text-ink-muted">100%</p>
                  <p className="text-xs font-bold text-ink">Sécurisé</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" className="text-brand-500 fill-current">
      <path d="M12 1l3 4 5 .8-3.6 3.7.8 5L12 12l-5.2 2.5.8-5L4 5.8 9 5z" />
    </svg>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center lg:text-left">
      <p className="font-display text-2xl sm:text-3xl font-extrabold text-ink">{value}</p>
      <p className="text-xs text-ink-muted mt-0.5">{label}</p>
    </div>
  );
}

function TrustStrip() {
  const items = [
    { icon: ShieldCheck, label: 'Paiement sécurisé', desc: 'Vendeurs vérifiés' },
    { icon: Truck,       label: 'Livraison directe', desc: 'Par le vendeur' },
    { icon: MessageCircle, label: 'Support WhatsApp', desc: 'Réponse rapide' },
    { icon: Sparkles,    label: '10k+ produits',     desc: 'Mis à jour quotidiennement' },
  ];
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6 sm:-mt-10 relative z-10">
      <div className="bg-white rounded-3xl shadow-card border border-slate-100 p-4 sm:p-6 grid grid-cols-2 lg:grid-cols-4 gap-2">
        {items.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-center gap-3 p-2.5 rounded-2xl hover:bg-surface-tint transition-colors">
            <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 grid place-items-center shrink-0">
              <Icon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{label}</p>
              <p className="text-[11px] text-ink-muted truncate">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Section({
  eyebrow,
  title,
  subtitle,
  action,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-16 sm:mt-20">
      <div className="flex items-end justify-between gap-6 mb-6 sm:mb-8">
        <div className="max-w-2xl">
          {eyebrow && (
            <span className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-700 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
              {eyebrow}
            </span>
          )}
          <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-ink mt-2 leading-tight text-balance">
            {title}
          </h2>
          {subtitle && <p className="text-ink-muted text-sm mt-1.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-200 ${
        active
          ? 'bg-ink text-white border-ink shadow-soft'
          : 'bg-white text-ink-soft border-slate-200 hover:border-brand-300 hover:text-brand-700'
      }`}
    >
      {children}
    </button>
  );
}

function Newsletter() {
  return (
    <></>
    // <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-20">
    //   <div className="relative overflow-hidden rounded-3xl bg-ink text-white p-8 sm:p-12">
    //     <div className="absolute -top-20 -right-20 w-72 h-72 bg-brand-500/30 blur-3xl rounded-full" />
    //     <div className="absolute -bottom-20 -left-10 w-72 h-72 bg-accent-rose/20 blur-3xl rounded-full" />
    //     <div className="relative grid lg:grid-cols-2 gap-8 items-center">
    //       <div>
    //         <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/20 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider">
    //           <Mail className="w-3 h-3" /> Newsletter
    //         </span>
    //         <h3 className="font-display text-2xl sm:text-3xl font-extrabold mt-3 leading-tight">
    //           Recevez les bons plans avant tout le monde.
    //         </h3>
    //         <p className="text-white/70 mt-2 text-sm max-w-md">
    //           Nouvelles boutiques, ventes flash et promotions exclusives — directement dans votre boîte mail.
    //         </p>
    //       </div>

    //       <form
    //         onSubmit={(e) => e.preventDefault()}
    //         className="flex items-center gap-2 bg-white/10 backdrop-blur-md border border-white/15 rounded-2xl p-1.5 max-w-md lg:ml-auto w-full"
    //       >
    //         <Mail className="w-4 h-4 text-white/60 ml-2.5" />
    //         <input
    //           type="email"
    //           placeholder="vous@exemple.com"
    //           className="flex-1 bg-transparent outline-none text-sm placeholder-white/50 py-2.5"
    //         />
    //         <button type="submit" className="bg-white text-ink font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-amber-50 transition-colors">
    //           S'inscrire
    //         </button>
    //       </form>
    //     </div>
    //   </div>
    // </section>
  );
}

function Footer({ navigate }: { navigate: (p: string) => void }) {
  return (
    <footer className="mt-20 border-t border-slate-100 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-brand-gradient grid place-items-center shadow-glowSm">
              <Store className="w-4 h-4 text-white" />
            </span>
            <span className="font-display font-extrabold text-lg text-ink">
              Marketo<span className="text-brand-600">.</span>
            </span>
          </div>
          <p className="mt-3 text-sm text-ink-muted leading-relaxed max-w-xs">
            La marketplace nouvelle génération pour vendeurs indépendants et acheteurs exigeants.
          </p>
          <div className="mt-4 flex items-center gap-2">
            {[Instagram, Twitter, Facebook].map((Icon, i) => (
              <a
                key={i}
                href="#"
                onClick={(e) => e.preventDefault()}
                className="w-9 h-9 rounded-full border border-slate-200 grid place-items-center text-ink-soft hover:bg-ink hover:text-white hover:border-ink transition-all"
              >
                <Icon className="w-4 h-4" />
              </a>
            ))}
          </div>
        </div>

        <FooterCol title="Acheter">
          <FooterLink onClick={() => navigate('/')}>Tous les produits</FooterLink>
          <FooterLink onClick={() => navigate('/')}>Boutiques</FooterLink>
          <FooterLink onClick={() => navigate('/')}>Catégories</FooterLink>
          <FooterLink onClick={() => navigate('/')}>Tendances</FooterLink>
        </FooterCol>

        <FooterCol title="Vendre">
          <FooterLink onClick={() => navigate('/auth')}>Ouvrir une boutique</FooterLink>
          <FooterLink onClick={() => navigate('/auth')}>Espace vendeur</FooterLink>
          <FooterLink onClick={() => {}}>Tarifs</FooterLink>
          <FooterLink onClick={() => {}}>Guide vendeur</FooterLink>
        </FooterCol>

        <FooterCol title="Support">
          <FooterLink onClick={() => {}}>Centre d'aide</FooterLink>
          <FooterLink onClick={() => {}}>Contact</FooterLink>
          <FooterLink onClick={() => {}}>Confidentialité</FooterLink>
          <FooterLink onClick={() => {}}>CGU</FooterLink>
        </FooterCol>
      </div>

      <div className="border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-ink-muted">
          <p>© {new Date().getFullYear()} Marketo. Tous droits réservés.</p>
          <p className="flex items-center gap-1.5">
            Fait avec passion <span className="text-rose-500">♥</span> pour les vendeurs indépendants.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold text-ink mb-3 text-sm">{title}</p>
      <ul className="space-y-2.5">{children}</ul>
    </div>
  );
}

function FooterLink({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <li>
      <button
        onClick={onClick}
        className="text-sm text-ink-muted hover:text-ink transition-colors"
      >
        {children}
      </button>
    </li>
  );
}
