import { LayoutDashboard, Package, Settings, Store, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { openStore } from '../lib/openStore';

interface AdminMobileNavProps {
  navigate: (path: string) => void;
  currentRoute: string;
}

export function AdminMobileNav({ navigate, currentRoute }: AdminMobileNavProps) {
  const { profile } = useAuth();

  const links = [
    { path: '/admin',          label: 'Accueil',  icon: LayoutDashboard },
    { path: '/admin/products', label: 'Produits', icon: Package },
    ...(profile?.role === 'admin'
      ? [{ path: '/admin/users', label: 'Users', icon: Users }]
      : []),
    { path: '/admin/settings', label: 'Boutique', icon: Settings },
  ];

  return (
    <>
      <nav className="lg:hidden fixed bottom-3 inset-x-3 z-40 glass border border-slate-200/80 rounded-3xl shadow-elevated flex items-stretch p-1.5">
        {links.map(({ path, label, icon: Icon }) => {
          const active = currentRoute === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl text-[10px] font-semibold transition-all ${
                active
                  ? 'bg-ink text-white shadow-soft'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          );
        })}
        {profile?.store_slug && (
          <button
            onClick={() => profile.store_slug && openStore(profile.store_slug)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-2xl text-[10px] font-semibold text-ink-muted hover:text-ink transition-colors"
          >
            <Store className="w-5 h-5" />
            Voir
          </button>
        )}
      </nav>
    </>
  );
}
