import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Loader2,
  Lock,
  Wallet,
  TrendingUp,
  Store,
  CheckCircle2,
  Ban,
  RotateCcw,
  Receipt as ReceiptIcon,
  Calendar,
  CreditCard,
  Power,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { SubscriptionPayment, Database } from '../../lib/types';
import { Modal } from '../../components/Modal';
import { Receipt } from '../../components/Receipt';
import { formatXOF, formatDate, formatDateTime, verifySubscriptionPayment } from '../../lib/subscription';

type Overview = Database['public']['Functions']['admin_subscription_overview']['Returns'][number];
type PaymentWithVendor = SubscriptionPayment & {
  profiles: { store_name: string; full_name: string; email: string | null } | null;
};

export function AdminPayments() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [vendors, setVendors] = useState<Overview[]>([]);
  const [payments, setPayments] = useState<PaymentWithVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PaymentWithVendor | null>(null);

  async function load() {
    setLoading(true);
    const [ov, pm] = await Promise.all([
      supabase.rpc('admin_subscription_overview'),
      supabase
        .from('subscription_payments')
        .select('*, profiles:vendor_id(store_name, full_name, email)')
        .order('created_at', { ascending: false }),
    ]);
    setVendors((ov.data ?? []) as Overview[]);
    setPayments((pm.data ?? []) as unknown as PaymentWithVendor[]);
    setLoading(false);
  }

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

  async function setSubscription(vendorId: string, active: boolean) {
    setBusyId(vendorId);
    await supabase.rpc('admin_set_subscription', { p_user_id: vendorId, p_active: active, p_days: 30 });
    await load();
    setBusyId(null);
  }

  async function setAccount(vendorId: string, enabled: boolean) {
    setBusyId(vendorId);
    await supabase
      .from('profiles')
      .update({ deleted_at: enabled ? null : new Date().toISOString() })
      .eq('id', vendorId);
    await load();
    setBusyId(null);
  }

  async function verifyPayment(reference: string) {
    setBusyId(reference);
    try {
      await verifySubscriptionPayment(reference);
    } catch {
      /* surfaced by reload below */
    }
    await load();
    setBusyId(null);
  }

  // Month buckets from completed payments.
  const months = useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number; revenue: number }>();
    for (const p of payments) {
      const d = new Date(p.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      const entry = map.get(key) || { key, label, count: 0, revenue: 0 };
      if (p.status === 'completed') {
        entry.count += 1;
        entry.revenue += Number(p.amount);
      }
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [payments]);

  const stats = useMemo(() => {
    const completed = payments.filter((p) => p.status === 'completed');
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const revenueMonth = completed
      .filter((p) => {
        const d = new Date(p.paid_at || p.created_at);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === thisKey;
      })
      .reduce((s, p) => s + Number(p.amount), 0);
    return {
      revenueTotal: completed.reduce((s, p) => s + Number(p.amount), 0),
      revenueMonth,
      activeStores: vendors.filter((v) => v.is_active).length,
      accounts: vendors.length,
    };
  }, [payments, vendors]);

  const visiblePayments = useMemo(() => {
    return payments.filter((p) => {
      if (month !== 'all') {
        const d = new Date(p.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key !== month) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${p.reference ?? ''} ${p.profiles?.store_name ?? ''} ${p.profiles?.full_name ?? ''} ${p.profiles?.email ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [payments, month, search]);

  const visibleVendors = useMemo(() => {
    if (!search) return vendors;
    const q = search.toLowerCase();
    return vendors.filter((v) =>
      `${v.email ?? ''} ${v.full_name} ${v.store_name}`.toLowerCase().includes(q)
    );
  }, [vendors, search]);

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
      <header>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink leading-tight">
          Paiements & abonnements
        </h1>
        <p className="text-ink-muted text-sm mt-1.5">
          Suivez les paiements par mois, activez ou désactivez les comptes.
        </p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={Wallet} tint="from-brand-100 to-brand-50 text-brand-600" label="Revenu total" value={formatXOF(stats.revenueTotal)} />
        <StatCard icon={TrendingUp} tint="from-emerald-100 to-emerald-50 text-emerald-600" label="Revenu ce mois" value={formatXOF(stats.revenueMonth)} />
        <StatCard icon={Store} tint="from-amber-100 to-amber-50 text-amber-600" label="Boutiques actives" value={String(stats.activeStores)} />
        <StatCard icon={CheckCircle2} tint="from-teal-100 to-teal-50 text-teal-600" label="Comptes" value={String(stats.accounts)} />
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-3 sm:p-4 flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par référence, nom, boutique, email..."
            className="w-full pl-11 pr-4 py-2.5 text-sm bg-surface-tint border border-transparent rounded-full text-ink placeholder-ink-subtle focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
          />
        </div>
        <div className="relative">
          <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="pl-11 pr-8 py-2.5 text-sm bg-surface-tint border border-transparent rounded-full text-ink focus:bg-white focus:border-brand-300 focus:ring-brand transition-all appearance-none capitalize"
          >
            <option value="all">Tous les mois</option>
            {months.map((m) => (
              <option key={m.key} value={m.key} className="capitalize">
                {m.label} — {formatXOF(m.revenue)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-3xl border border-slate-100 p-16 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-500 mx-auto" />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          {/* Vendors / accounts */}
          <div className="xl:col-span-3 bg-white rounded-3xl border border-slate-100 shadow-soft overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100">
              <h2 className="font-display font-bold text-ink">Comptes & abonnements</h2>
              <p className="text-xs text-ink-muted mt-0.5">Activer / désactiver l'abonnement ou le compte.</p>
            </div>
            <div className="divide-y divide-slate-50 max-h-[560px] overflow-y-auto scrollbar-thin">
              {visibleVendors.map((v) => {
                const banned = !!v.deleted_at;
                return (
                  <div key={v.vendor_id} className="px-5 py-4 flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-brand-gradient grid place-items-center text-white font-bold shrink-0">
                      {(v.store_name || v.full_name || v.email || '?')[0]?.toUpperCase()}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">
                        {v.store_name || v.full_name || 'Sans nom'}
                        {v.role === 'admin' && (
                          <span className="ml-2 text-[10px] font-bold text-brand-700">ADMIN</span>
                        )}
                      </p>
                      <p className="text-[11px] text-ink-muted truncate">{v.email || '—'}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {v.is_active ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            Actif · {formatDate(v.subscription_expires_at)}
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                            Inactif
                          </span>
                        )}
                        {banned && (
                          <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                            Compte désactivé
                          </span>
                        )}
                        <span className="text-[10px] text-ink-muted">
                          {v.payments_count} paiement{Number(v.payments_count) > 1 ? 's' : ''} · {formatXOF(Number(v.total_paid))}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {v.is_active ? (
                        <button
                          onClick={() => setSubscription(v.vendor_id, false)}
                          disabled={busyId === v.vendor_id}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                        >
                          {busyId === v.vendor_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                          Désactiver
                        </button>
                      ) : (
                        <button
                          onClick={() => setSubscription(v.vendor_id, true)}
                          disabled={busyId === v.vendor_id}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                        >
                          {busyId === v.vendor_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          Activer 30j
                        </button>
                      )}
                      <button
                        onClick={() => setAccount(v.vendor_id, banned)}
                        disabled={busyId === v.vendor_id}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted hover:text-ink bg-surface-tint hover:bg-slate-200 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
                      >
                        {banned ? <RotateCcw className="w-3 h-3" /> : <Power className="w-3 h-3" />}
                        {banned ? 'Réactiver' : 'Bannir'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {visibleVendors.length === 0 && (
                <p className="p-10 text-center text-sm text-ink-muted">Aucun compte.</p>
              )}
            </div>
          </div>

          {/* Payments feed */}
          <div className="xl:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-soft overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-2">
              <ReceiptIcon className="w-4 h-4 text-ink-muted" />
              <h2 className="font-display font-bold text-ink">
                Paiements {month !== 'all' && <span className="text-ink-muted font-normal">· {months.find((m) => m.key === month)?.label}</span>}
              </h2>
            </div>
            <div className="divide-y divide-slate-50 max-h-[560px] overflow-y-auto scrollbar-thin">
              {visiblePayments.map((p) => (
                <div key={p.id} className="px-5 py-3.5 flex items-center gap-3">
                  <span
                    className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${
                      p.status === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {p.profiles?.store_name || p.profiles?.full_name || p.profiles?.email || 'Client'}
                    </p>
                    <p className="text-[11px] text-ink-muted truncate">
                      {formatDateTime(p.paid_at || p.created_at)} · {p.status}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-ink tabular-nums shrink-0">{formatXOF(p.amount)}</span>
                  {p.status === 'completed' ? (
                    <button
                      onClick={() => setReceipt(p)}
                      className="text-[11px] font-semibold text-brand-700 hover:text-brand-800 shrink-0"
                    >
                      Reçu
                    </button>
                  ) : (p.status === 'pending' || p.status === 'processing') && p.reference ? (
                    <button
                      onClick={() => verifyPayment(p.reference!)}
                      disabled={busyId === p.reference}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink-muted hover:text-ink shrink-0 disabled:opacity-50"
                    >
                      {busyId === p.reference && <Loader2 className="w-3 h-3 animate-spin" />}
                      Vérifier
                    </button>
                  ) : null}
                </div>
              ))}
              {visiblePayments.length === 0 && (
                <p className="p-10 text-center text-sm text-ink-muted">Aucun paiement.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal open={!!receipt} onClose={() => setReceipt(null)} size="md">
        {receipt && (
          <div className="p-4">
            <Receipt payment={receipt} vendor={receipt.profiles ?? {}} />
          </div>
        )}
      </Modal>
    </div>
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
  value: string;
}) {
  return (
    <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-soft">
      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tint} grid place-items-center`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-xl font-display font-extrabold text-ink mt-3 tabular-nums leading-none">{value}</p>
      <p className="text-xs text-ink-muted mt-2">{label}</p>
    </div>
  );
}
