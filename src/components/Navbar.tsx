import { useEffect, useState } from 'react';
import {
  Menu,
  X,
  LayoutDashboard,
  LogOut,
  LogIn,
  Store,
  Heart,
  ShoppingCart,
  Sparkles,
  ChevronDown,
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { openStore } from '../lib/openStore';
import { Logo } from './Logo';
import { CartDrawer } from './CartDrawer';

interface NavbarProps {
  navigate: (path: string) => void;
  currentRoute: string;
}

const quickLinks = [
  { label: 'Tendances',    path: '/' },
  { label: 'Boutiques',    path: '/' },
  { label: 'Nouveautés',   path: '/' },
  { label: 'Promotions',   path: '/' },
];

export function Navbar({ navigate, currentRoute }: NavbarProps) {
  const { user, profile, signOut } = useAuth();
  const { count: cartCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate('/');
    setMenuOpen(false);
  }

  function go(path: string) {
    navigate(path);
    setMenuOpen(false);
  }

  const isAdmin = currentRoute.startsWith('/admin');

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'glass border-b border-slate-200/60 shadow-soft'
          : 'bg-white/80 backdrop-blur-sm border-b border-transparent'
      }`}
    >
      {/* Top announcement bar */}
      <div className="hidden md:flex items-center justify-center gap-2 bg-ink text-white text-xs py-1.5 tracking-wide">
        <Sparkles className="w-3.5 h-3.5 text-amber-300" />
        Recevez vos commandes directement sur WhatsApp, sans intermédiaire
      </div>

      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <button
            onClick={() => navigate('/')}
            className="flex items-center shrink-0 group transition-transform duration-300 hover:scale-[1.02]"
            aria-label="Accueil Marketoos"
          >
            <Logo />
          </button>

          {/* Spacer */}
          <div className="hidden md:block flex-1" />

          {/* Right actions — desktop */}
          <div className="hidden md:flex items-center gap-1">
            <IconButton label="Favoris" onClick={() => navigate('/')}>
              <Heart className="w-4.5 h-4.5" />
            </IconButton>
            <IconButton label="Panier" onClick={() => setCartOpen(true)} badge={cartCount}>
              <ShoppingCart className="w-4.5 h-4.5" />
            </IconButton>

            {user ? (
              <>
                <button
                  onClick={() => navigate('/admin')}
                  className={`flex items-center gap-1.5 text-sm font-medium px-3.5 h-10 rounded-full transition-all ${
                    isAdmin
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-soft hover:bg-surface-tint'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </button>

                <div className="relative ml-1">
                  <button
                    onClick={() => setAccountOpen((o) => !o)}
                    className="flex items-center gap-2 pl-1 pr-2.5 h-10 rounded-full hover:bg-surface-tint transition-colors"
                  >
                    {profile?.store_logo_url ? (
                      <img
                        src={profile.store_logo_url}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover ring-2 ring-white shadow-soft"
                      />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-brand-gradient grid place-items-center text-white text-xs font-bold ring-2 ring-white">
                        {(profile?.store_name || user.email || 'U')[0]?.toUpperCase()}
                      </span>
                    )}
                    <ChevronDown className={`w-3.5 h-3.5 text-ink-muted transition-transform ${accountOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {accountOpen && (
                    <>
                      {/* click-away overlay */}
                      <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                      <div className="absolute right-0 top-full mt-2 w-60 z-50 origin-top-right bg-white rounded-2xl shadow-elevated border border-slate-100 p-2 animate-pop">
                        <div className="px-3 py-2 border-b border-slate-100 mb-1">
                          <p className="text-sm font-semibold text-ink truncate">{profile?.store_name || 'Mon compte'}</p>
                          <p className="text-xs text-ink-muted truncate">{user.email}</p>
                        </div>
                        {profile?.store_slug && (
                          <MenuItem icon={Store} onClick={() => { openStore(profile.store_slug!); setAccountOpen(false); }}>
                            Voir ma boutique
                          </MenuItem>
                        )}
                        <MenuItem icon={LayoutDashboard} onClick={() => { navigate('/admin'); setAccountOpen(false); }}>
                          Tableau de bord
                        </MenuItem>
                        <MenuItem icon={User} onClick={() => { navigate('/admin/settings'); setAccountOpen(false); }}>
                          Paramètres
                        </MenuItem>
                        <div className="my-1 border-t border-slate-100" />
                        <MenuItem icon={LogOut} onClick={() => { handleSignOut(); setAccountOpen(false); }} danger>
                          Déconnexion
                        </MenuItem>
                      </div>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={() => navigate('/auth')}
                  className="text-sm font-medium text-ink-soft hover:text-ink h-10 px-3.5 rounded-full hover:bg-surface-tint transition-colors"
                >
                  Connexion
                </button>
                <button
                  onClick={() => navigate('/auth')}
                  className="ml-1 flex items-center gap-1.5 bg-ink hover:bg-ink-soft text-white text-sm font-semibold px-4 h-10 rounded-full transition-all shadow-soft hover:shadow-elevated"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  Vendre
                </button>
              </>
            )}
          </div>

          {/* Mobile right actions */}
          <div className="md:hidden flex items-center gap-1">
            <IconButton label="Panier" onClick={() => setCartOpen(true)} badge={cartCount}>
              <ShoppingCart className="w-5 h-5" />
            </IconButton>
            <button
              className="p-2.5 rounded-full text-ink-soft hover:bg-surface-tint transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Menu"
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Secondary nav — desktop */}
        <div className="hidden md:flex items-center gap-1 h-10 -mt-1 mb-0.5">
          {quickLinks.map((l) => (
            <button
              key={l.label}
              onClick={() => navigate(l.path)}
              className="text-xs font-medium text-ink-muted hover:text-ink px-3 h-7 rounded-full hover:bg-surface-tint transition-colors"
            >
              {l.label}
            </button>
          ))}
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-mint animate-pulse" style={{ background: '#10b981' }} />
            Vendeurs en ligne 24/7
          </span>
        </div>
      </nav>

      {/* Mobile sheet */}
      {menuOpen && (
        <div className="md:hidden border-t border-slate-100 bg-white animate-slide-up">
          <div className="px-4 py-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {quickLinks.map((l) => (
                <button
                  key={l.label}
                  onClick={() => go(l.path)}
                  className="text-xs font-medium text-ink-soft px-3.5 py-1.5 rounded-full bg-surface-tint hover:bg-brand-50 hover:text-brand-700 transition-colors"
                >
                  {l.label}
                </button>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 space-y-1">
              <MobileLink icon={Store} onClick={() => go('/')}>
                Toutes les boutiques
              </MobileLink>
              <MobileLink icon={Heart} onClick={() => go('/')}>
                Mes favoris
              </MobileLink>
              {user ? (
                <>
                  <MobileLink icon={LayoutDashboard} onClick={() => go('/admin')}>
                    Tableau de bord
                  </MobileLink>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Déconnexion
                  </button>
                </>
              ) : (
                <button
                  onClick={() => go('/auth')}
                  className="w-full flex items-center justify-center gap-2 text-sm font-semibold bg-ink text-white px-4 py-3 rounded-2xl shadow-soft mt-2"
                >
                  <LogIn className="w-4 h-4" />
                  Connexion / Inscription
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </header>
  );
}

function IconButton({
  children,
  onClick,
  label,
  badge,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="relative w-10 h-10 grid place-items-center rounded-full text-ink-soft hover:text-ink hover:bg-surface-tint transition-colors"
    >
      {children}
      {!!badge && (
        <span className="absolute top-1 right-1 min-w-[1.1rem] h-[1.1rem] px-1 grid place-items-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

function MenuItem({
  children,
  onClick,
  icon: Icon,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-xl transition-colors ${
        danger ? 'text-rose-500 hover:bg-rose-50' : 'text-ink-soft hover:bg-surface-tint hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" />
      {children}
    </button>
  );
}

function MobileLink({
  icon: Icon,
  children,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 text-sm font-medium text-ink-soft hover:bg-surface-tint hover:text-ink rounded-xl transition-colors"
    >
      <Icon className="w-4 h-4 text-ink-muted" />
      {children}
    </button>
  );
}
