import { ReactNode, useState } from 'react';
import { Lock, CreditCard, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBSCRIPTION_AMOUNT,
  getSubscriptionState,
  startSubscriptionCheckout,
  formatXOF,
  BRAND_NAME,
} from '../lib/subscription';

/**
 * Wraps gated admin content. Admins and vendors with an active subscription see
 * their content; everyone else hits a paywall (frontend half of "blocage fort"
 * — the DB RLS/triggers enforce the rest).
 */
export function SubscriptionGate({
  navigate,
  children,
}: {
  navigate: (path: string) => void;
  children: ReactNode;
}) {
  const { profile, loading } = useAuth();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const state = getSubscriptionState(profile);

  if (loading) return <>{children}</>;
  if (profile?.role === 'admin' || state.active) return <>{children}</>;

  async function pay() {
    setError('');
    setStarting(true);
    try {
      await startSubscriptionCheckout();
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-8 sm:py-14 animate-fade-in">
      <div className="relative overflow-hidden bg-ink text-white rounded-3xl p-7 sm:p-10">
        <div className="absolute -top-20 -right-16 w-72 h-72 bg-brand-500/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-16 w-72 h-72 bg-accent-rose/20 rounded-full blur-3xl" />
        <div className="relative">
          <span className="w-14 h-14 grid place-items-center rounded-2xl bg-white/10 border border-white/15">
            <Lock className="w-7 h-7 text-amber-300" />
          </span>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold mt-5 leading-tight">
            {state.expired ? 'Votre abonnement a expiré' : 'Activez votre boutique'}
          </h1>
          <p className="text-white/70 text-sm mt-2 max-w-md">
            Pour publier vos produits et rendre votre boutique visible, un abonnement de{' '}
            <span className="font-semibold text-white">{formatXOF(SUBSCRIPTION_AMOUNT)} / mois</span>{' '}
            est requis. Paiement sécurisé via {BRAND_NAME}.
          </p>

          <ul className="mt-6 space-y-2.5">
            {[
              'Boutique visible sur le marketplace',
              'Produits illimités + page personnalisée',
              'Reçu de paiement téléchargeable',
            ].map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-white/90">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          {error && (
            <p className="mt-5 text-sm text-rose-100 bg-rose-500/20 rounded-xl px-3 py-2">{error}</p>
          )}

          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <button
              onClick={pay}
              disabled={starting}
              className="inline-flex items-center justify-center gap-2 bg-white text-ink text-sm font-bold px-6 py-3 rounded-full hover:bg-amber-50 transition-colors disabled:opacity-60"
            >
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Payer {formatXOF(SUBSCRIPTION_AMOUNT)}
            </button>
            <button
              onClick={() => navigate('/admin/subscription')}
              className="inline-flex items-center justify-center gap-2 bg-white/10 border border-white/15 text-white text-sm font-semibold px-6 py-3 rounded-full hover:bg-white/15 transition-colors"
            >
              <Sparkles className="w-4 h-4" /> Détails & historique
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
