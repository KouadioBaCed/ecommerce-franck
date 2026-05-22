import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Store,
  User,
  Ban,
  RotateCcw,
  Loader2,
  BadgeCheck,
  Clock,
  Users as UsersIcon,
  Crown,
  Lock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { Profile, UserRole } from '../../lib/types';
import { Modal } from '../../components/Modal';

type Row = Pick<
  Profile,
  | 'id' | 'email' | 'full_name' | 'store_name' | 'role'
  | 'verification_status' | 'deleted_at' | 'created_at' | 'avatar_url'
>;

type StatusFilter = 'all' | 'active' | 'inactive';
type RoleFilter = 'all' | UserRole;

export function AdminUsers() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<Row | null>(null);

  const isAdmin = profile?.role === 'admin';

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, email, full_name, store_name, role, verification_status, deleted_at, created_at, avatar_url')
      .order('created_at', { ascending: false });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

  async function setActive(row: Row, active: boolean) {
    setBusyId(row.id);
    const { error } = await supabase
      .from('profiles')
      .update({ deleted_at: active ? null : new Date().toISOString() })
      .eq('id', row.id);
    if (!error) {
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, deleted_at: active ? null : new Date().toISOString() } : r))
      );
    }
    setBusyId(null);
    setConfirmTarget(null);
  }

  const stats = useMemo(() => {
    return {
      total: rows.length,
      vendors: rows.filter((r) => r.role === 'vendor').length,
      pending: rows.filter((r) => r.verification_status === 'pending').length,
      inactive: rows.filter((r) => r.deleted_at).length,
    };
  }, [rows]);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (status === 'active' && r.deleted_at) return false;
        if (status === 'inactive' && !r.deleted_at) return false;
        if (roleFilter !== 'all' && r.role !== roleFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const hay = `${r.email ?? ''} ${r.full_name} ${r.store_name}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [rows, status, roleFilter, search]
  );

  // Access guard
  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto py-20 text-center animate-fade-in">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 grid place-items-center">
          <Lock className="w-7 h-7 text-rose-400" />
        </div>
        <h1 className="font-display text-2xl font-bold text-ink mt-4">Accès réservé</h1>
        <p className="text-sm text-ink-muted mt-2">Cette page est réservée aux administrateurs.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <header>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink leading-tight">Utilisateurs</h1>
        <p className="text-ink-muted text-sm mt-1.5">Gérez les comptes : rôles, vérifications, activation.</p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={UsersIcon} tint="from-brand-100 to-brand-50 text-brand-600" label="Comptes" value={stats.total} />
        <StatCard icon={Store} tint="from-emerald-100 to-emerald-50 text-emerald-600" label="Vendeurs" value={stats.vendors} />
        <StatCard icon={Clock} tint="from-amber-100 to-amber-50 text-amber-600" label="Vérif. en attente" value={stats.pending} />
        <StatCard icon={Ban} tint="from-rose-100 to-rose-50 text-rose-500" label="Désactivés" value={stats.inactive} />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-3 sm:p-4 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par email, nom, boutique..."
            className="w-full pl-11 pr-4 py-2.5 text-sm bg-surface-tint border border-transparent rounded-full text-ink placeholder-ink-subtle focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
          />
        </div>

        <div className="flex items-center bg-surface-tint rounded-full p-1">
          {(['all', 'active', 'inactive'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
                status === s ? 'bg-white text-ink shadow-soft' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {s === 'all' ? 'Tous' : s === 'active' ? 'Actifs' : 'Désactivés'}
            </button>
          ))}
        </div>

        <div className="flex items-center bg-surface-tint rounded-full p-1">
          {(['all', 'customer', 'vendor', 'admin'] as RoleFilter[]).map((r) => (
            <button
              key={r}
              onClick={() => setRoleFilter(r)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all capitalize ${
                roleFilter === r ? 'bg-white text-ink shadow-soft' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {r === 'all' ? 'Rôles' : r === 'customer' ? 'Clients' : r === 'vendor' ? 'Vendeurs' : 'Admins'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-3xl p-4 border border-slate-100 flex gap-4">
              <div className="w-11 h-11 rounded-full animate-shimmer shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 w-1/3 rounded-full animate-shimmer" />
                <div className="h-3 w-1/4 rounded-full animate-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-16 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-brand-50 grid place-items-center mb-4">
            <UsersIcon className="w-7 h-7 text-brand-500" />
          </div>
          <h3 className="font-display text-lg font-bold text-ink">Aucun utilisateur</h3>
          <p className="text-sm text-ink-muted mt-1.5">Modifie tes filtres pour voir d'autres comptes.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => {
            const inactive = !!r.deleted_at;
            const isSelf = r.id === user?.id;
            return (
              <div
                key={r.id}
                className={`bg-white rounded-3xl border shadow-soft transition-all p-3 sm:p-4 flex items-center gap-3 sm:gap-4 ${
                  inactive ? 'border-rose-100 opacity-75' : 'border-slate-100 hover:shadow-card'
                }`}
              >
                {/* Avatar */}
                <div className="shrink-0">
                  {r.avatar_url ? (
                    <img src={r.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover ring-2 ring-white shadow-soft" />
                  ) : (
                    <span className="w-11 h-11 rounded-full bg-brand-gradient grid place-items-center text-white font-bold">
                      {(r.full_name || r.store_name || r.email || '?')[0]?.toUpperCase()}
                    </span>
                  )}
                </div>

                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-ink truncate">
                      {r.full_name || r.store_name || 'Sans nom'}
                    </p>
                    <RoleBadge role={r.role} />
                    {r.role === 'vendor' && r.verification_status === 'pending' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                        <Clock className="w-2.5 h-2.5" /> Vérif. en attente
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted truncate mt-0.5">{r.email || '—'}</p>
                </div>

                {/* Status */}
                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${inactive ? 'bg-rose-400' : 'bg-emerald-500'}`} />
                  <span className={`text-xs font-semibold ${inactive ? 'text-rose-500' : 'text-emerald-600'}`}>
                    {inactive ? 'Désactivé' : 'Actif'}
                  </span>
                </div>

                {/* Action */}
                <div className="shrink-0">
                  {isSelf ? (
                    <span className="text-[11px] text-ink-subtle italic px-3">vous</span>
                  ) : inactive ? (
                    <button
                      onClick={() => setActive(r, true)}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3.5 py-2 rounded-full transition-colors disabled:opacity-50"
                    >
                      {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                      Réactiver
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmTarget(r)}
                      disabled={busyId === r.id}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3.5 py-2 rounded-full transition-colors disabled:opacity-50"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Désactiver
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Deactivate confirmation */}
      <Modal open={!!confirmTarget} onClose={() => setConfirmTarget(null)} size="sm">
        <div className="p-6">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-100 text-rose-500 grid place-items-center">
            <Ban className="w-6 h-6" />
          </div>
          <h3 className="font-display text-lg font-bold text-ink text-center mt-4">Désactiver ce compte ?</h3>
          <p className="text-sm text-ink-muted text-center mt-1.5">
            <span className="font-medium text-ink-soft">{confirmTarget?.email}</span> sera masqué de la marketplace.
            Tu peux le réactiver à tout moment.
          </p>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setConfirmTarget(null)}
              className="flex-1 py-3 rounded-2xl text-sm font-semibold text-ink-soft bg-surface-tint hover:bg-slate-200 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={() => confirmTarget && setActive(confirmTarget, false)}
              disabled={!!busyId}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 transition-colors disabled:opacity-50"
            >
              {busyId ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Désactiver'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
        <Crown className="w-2.5 h-2.5" /> Admin
      </span>
    );
  }
  if (role === 'vendor') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
        <BadgeCheck className="w-2.5 h-2.5" /> Vendeur
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-ink-soft bg-surface-tint px-2 py-0.5 rounded-full">
      <User className="w-2.5 h-2.5" /> Client
    </span>
  );
}

function StatCard({
  icon: Icon,
  tint,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-soft">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tint} grid place-items-center`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-display font-extrabold text-ink mt-3 tabular-nums leading-none">{value}</p>
      <p className="text-xs text-ink-muted mt-2">{label}</p>
    </div>
  );
}
