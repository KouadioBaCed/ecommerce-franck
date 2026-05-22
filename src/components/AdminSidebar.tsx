import {
  LayoutDashboard,
  Package,
  Settings,
  ChevronRight,
  ExternalLink,
  BadgeCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { openStore } from '../lib/openStore';

interface AdminSidebarProps {
  navigate: (path: string) => void;
  currentRoute: string;
}

type NavItem = { path: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavSection = { title: string; items: NavItem[] };

export function AdminSidebar({ navigate, currentRoute }: AdminSidebarProps) {
  const { profile } = useAuth();

  const sections: NavSection[] = [
    { title: 'Pilotage',  items: [{ path: '/admin',          label: "Vue d'ensemble", icon: LayoutDashboard }] },
    { title: 'Catalogue', items: [{ path: '/admin/products', label: 'Mes produits',   icon: Package }] },
    { title: 'Boutique',  items: [{ path: '/admin/settings', label: 'Ma boutique',    icon: Settings }] },
    ...(profile?.role === 'admin'
      ? [{ title: 'Administration', items: [{ path: '/admin/users', label: 'Utilisateurs', icon: Users }] }]
      : []),
  ];

  return (
    <aside className="w-72 shrink-0 hidden lg:flex flex-col bg-white border-r border-slate-100 sticky top-32 self-start" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* Store header */}
      <div className="p-5 border-b border-slate-100">
        <button
          onClick={() => profile?.store_slug && openStore(profile.store_slug)}
          className="group w-full flex items-center gap-3 p-2 rounded-2xl hover:bg-surface-tint transition-colors text-left"
        >
          <div className="relative shrink-0">
            {profile?.store_logo_url ? (
              <img src={profile.store_logo_url} alt="" className="w-11 h-11 rounded-2xl object-cover ring-2 ring-white shadow-soft" />
            ) : (
              <span className="w-11 h-11 rounded-2xl bg-brand-gradient grid place-items-center text-white font-bold shadow-glowSm">
                {(profile?.store_name || 'B')[0]?.toUpperCase()}
              </span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 rounded-full border-2 border-white grid place-items-center">
              <BadgeCheck className="w-2.5 h-2.5 text-white" />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate">
              {profile?.store_name || 'Ma boutique'}
            </p>
            <p className="text-[11px] text-ink-muted flex items-center gap-1">
              Espace vendeur
              <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
            </p>
          </div>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-5 overflow-y-auto scrollbar-thin">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-subtle">
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ path, label, icon: Icon }) => {
                const active = currentRoute === path;
                return (
                  <button
                    key={path}
                    onClick={() => navigate(path)}
                    className={`group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      active
                        ? 'bg-ink text-white shadow-soft'
                        : 'text-ink-soft hover:bg-surface-tint hover:text-ink'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${active ? 'text-white' : 'text-ink-muted group-hover:text-ink'}`} />
                      {label}
                    </div>
                    <ChevronRight
                      className={`w-3.5 h-3.5 transition-transform ${
                        active ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer card */}
      <div className="p-3 border-t border-slate-100">
        <div className="bg-gradient-to-br from-brand-50 via-white to-pink-50 border border-brand-100 rounded-2xl p-4">
          <div className="w-9 h-9 rounded-xl bg-brand-gradient grid place-items-center shadow-glowSm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <p className="mt-3 text-sm font-bold text-ink leading-tight">Boostez votre boutique</p>
          <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
            Complétez votre profil pour gagner +3× plus de visibilité.
          </p>
          <button
            onClick={() => navigate('/admin/settings')}
            className="mt-3 w-full bg-ink hover:bg-brand-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
          >
            Compléter
          </button>
        </div>
      </div>
    </aside>
  );
}
