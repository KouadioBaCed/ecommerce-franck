import { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck,
  Loader2,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Receipt as ReceiptIcon,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { SubscriptionPayment } from '../../lib/types';
import {
  SUBSCRIPTION_AMOUNT,
  SUBSCRIPTION_PERIOD_DAYS,
  BRAND_NAME,
  getSubscriptionState,
  startSubscriptionCheckout,
  verifySubscriptionPayment,
  popLastReference,
  formatXOF,
  formatDate,
  formatDateTime,
} from '../../lib/subscription';
import { Receipt } from '../../components/Receipt';
import { Modal } from '../../components/Modal';

export function AdminSubscription() {
  const { profile, refreshProfile } = useAuth();
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [receipt, setReceipt] = useState<SubscriptionPayment | null>(null);

  const state = getSubscriptionState(profile);

  const loadPayments = useCallback(async () => {
    const { data } = await supabase
      .from('subscription_payments')
      .select('*')
      .order('created_at', { ascending: false });
    setPayments((data ?? []) as SubscriptionPayment[]);
    setLoading(false);
  }, []);

  // On return from GeniusPay checkout: verify the pending payment.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get('status');
    const ref = params.get('ref') || popLastReference();

    async function run() {
      if (statusParam === 'error') {
        setNotice({ type: 'error', text: 'Le paiement a été annulé ou a échoué. Réessayez.' });
      }
      if (ref && statusParam !== 'error') {
        setVerifying(true);
        try {
          const res = await verifySubscriptionPayment(ref);
          if (res.applied || res.status === 'completed') {
            await refreshProfile();
            setNotice({ type: 'success', text: 'Paiement confirmé ! Votre boutique est active.' });
          } else if (res.status === 'pending' || res.status === 'processing') {
            setNotice({
              type: 'info',
              text: 'Paiement en cours de traitement. Cette page se mettra à jour automatiquement.',
            });
          } else {
            setNotice({ type: 'error', text: `Statut du paiement : ${res.status}.` });
          }
        } catch (e) {
          setNotice({ type: 'error', text: (e as Error).message });
        } finally {
          setVerifying(false);
        }
      }
      // Clean the URL so a refresh doesn't re-trigger verification.
      if (statusParam || params.get('ref')) {
        window.history.replaceState({}, '', '/admin/subscription');
      }
      loadPayments();
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePay() {
    setError('');
    setStarting(true);
    try {
      await startSubscriptionCheckout(); // redirects the browser
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  async function handleManualVerify(ref: string) {
    setVerifying(true);
    try {
      const res = await verifySubscriptionPayment(ref);
      if (res.applied || res.status === 'completed') await refreshProfile();
      await loadPayments();
      setNotice({
        type: res.status === 'completed' ? 'success' : 'info',
        text: `Statut : ${res.status}.`,
      });
    } catch (e) {
      setNotice({ type: 'error', text: (e as Error).message });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink leading-tight">
          Abonnement
        </h1>
        <p className="text-ink-muted text-sm mt-1.5">
          Activez votre boutique pour {formatXOF(SUBSCRIPTION_AMOUNT)} / mois via {BRAND_NAME}.
        </p>
      </header>

      {notice && (
        <div
          className={`flex items-start gap-2 text-sm px-4 py-3 rounded-2xl border animate-pop ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : notice.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-600'
              : 'bg-brand-50 border-brand-200 text-brand-700'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : notice.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <Clock className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Status card */}
      <div
        className={`relative overflow-hidden rounded-3xl p-6 sm:p-8 text-white ${
          state.active ? 'bg-emerald-600' : 'bg-ink'
        }`}
      >
        <div className="absolute -top-16 -right-12 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
          <span className="w-14 h-14 grid place-items-center rounded-2xl bg-white/15 shrink-0">
            <ShieldCheck className="w-7 h-7" />
          </span>
          <div className="flex-1">
            <p className="text-white/70 text-xs font-semibold uppercase tracking-wider">
              Statut de la boutique
            </p>
            <h2 className="font-display text-2xl font-extrabold mt-0.5">
              {verifying
                ? 'Vérification…'
                : state.active
                ? 'Boutique active'
                : state.expired
                ? 'Abonnement expiré'
                : 'Boutique inactive'}
            </h2>
            <p className="text-white/80 text-sm mt-1">
              {state.active
                ? `Active jusqu'au ${formatDate(state.expiresAt)} · ${state.daysLeft} jour${
                    state.daysLeft > 1 ? 's' : ''
                  } restant${state.daysLeft > 1 ? 's' : ''}`
                : 'Payez votre abonnement pour rendre votre boutique et vos produits visibles.'}
            </p>
          </div>
          <button
            onClick={handlePay}
            disabled={starting}
            className="inline-flex items-center justify-center gap-2 bg-white text-ink text-sm font-bold px-6 py-3 rounded-full hover:bg-white/90 transition-colors disabled:opacity-60 shrink-0"
          >
            {starting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4" />
            )}
            {state.active ? 'Renouveler' : `Payer ${formatXOF(SUBSCRIPTION_AMOUNT)}`}
          </button>
        </div>
        {error && <p className="relative mt-4 text-sm text-rose-100 bg-rose-500/20 rounded-xl px-3 py-2">{error}</p>}
      </div>

      {/* What you get */}
      {!state.active && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-6">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-600" />
            <h3 className="font-display font-bold text-ink">Ce que comprend l'abonnement</h3>
          </div>
          <ul className="mt-4 grid sm:grid-cols-2 gap-3 text-sm text-ink-soft">
            {[
              'Boutique visible sur le marketplace',
              'Publication illimitée de produits',
              'Page boutique personnalisée + WhatsApp',
              `Valable ${SUBSCRIPTION_PERIOD_DAYS} jours, renouvelable`,
            ].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Payment history */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-soft overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <ReceiptIcon className="w-4 h-4 text-ink-muted" />
            <h2 className="font-display font-bold text-ink">Historique de paiement</h2>
          </div>
          <button
            onClick={() => { setLoading(true); loadPayments(); }}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="divide-y divide-slate-50">
            {[1, 2].map((i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl animate-shimmer" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded-full animate-shimmer" />
                  <div className="h-3 w-1/5 rounded-full animate-shimmer" />
                </div>
              </div>
            ))}
          </div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-50 grid place-items-center mb-3">
              <ReceiptIcon className="w-6 h-6 text-brand-500" />
            </div>
            <p className="font-display font-bold text-ink">Aucun paiement</p>
            <p className="text-sm text-ink-muted mt-1">Vos reçus apparaîtront ici après paiement.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {payments.map((p) => (
              <div key={p.id} className="px-6 py-4 flex items-center gap-4 hover:bg-surface-tint transition-colors">
                <span
                  className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
                    p.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-600'
                      : p.status === 'failed' || p.status === 'cancelled' || p.status === 'expired'
                      ? 'bg-rose-50 text-rose-500'
                      : 'bg-amber-50 text-amber-600'
                  }`}
                >
                  <CreditCard className="w-5 h-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink">{formatXOF(p.amount)}</p>
                  <p className="text-[11px] text-ink-muted truncate">
                    {p.reference || '—'} · {formatDateTime(p.paid_at || p.created_at)}
                  </p>
                </div>
                <StatusChip status={p.status} />
                {p.status === 'completed' ? (
                  <button
                    onClick={() => setReceipt(p)}
                    className="text-xs font-semibold text-brand-700 hover:text-brand-800 shrink-0"
                  >
                    Reçu
                  </button>
                ) : (
                  <button
                    onClick={() => p.reference && handleManualVerify(p.reference)}
                    disabled={verifying || !p.reference}
                    className="text-xs font-semibold text-ink-muted hover:text-ink shrink-0 disabled:opacity-50"
                  >
                    Vérifier
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Receipt modal */}
      <Modal open={!!receipt} onClose={() => setReceipt(null)} size="md">
        {receipt && (
          <div className="p-4">
            <Receipt payment={receipt} vendor={profile ?? {}} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatusChip({ status }: { status: SubscriptionPayment['status'] }) {
  const map: Record<string, { cls: string; label: string }> = {
    completed: { cls: 'bg-emerald-50 text-emerald-700', label: 'Payé' },
    pending: { cls: 'bg-amber-50 text-amber-700', label: 'En attente' },
    processing: { cls: 'bg-amber-50 text-amber-700', label: 'En cours' },
    failed: { cls: 'bg-rose-50 text-rose-600', label: 'Échoué' },
    cancelled: { cls: 'bg-rose-50 text-rose-600', label: 'Annulé' },
    expired: { cls: 'bg-slate-100 text-ink-muted', label: 'Expiré' },
    refunded: { cls: 'bg-slate-100 text-ink-muted', label: 'Remboursé' },
  };
  const s = map[status] || map.pending;
  return (
    <span className={`hidden sm:inline-flex text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 ${s.cls}`}>
      {s.label}
    </span>
  );
}
