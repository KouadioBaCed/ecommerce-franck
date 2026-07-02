import { supabase } from './supabase';
import type { Profile } from './types';

/** Business constants — keep in sync with netlify/functions/lib/subscription.mts */
export const SUBSCRIPTION_AMOUNT = 200;
export const SUBSCRIPTION_CURRENCY = 'XOF';
export const SUBSCRIPTION_PERIOD_DAYS = 30;
export const BRAND_NAME = 'Dunamis Boutique';

const LAST_REF_KEY = 'dunamis:lastSubscriptionRef';

// Call the Netlify functions directly (no dependency on the /api/* redirect).
const FN_CREATE = '/.netlify/functions/create-subscription-payment';
const FN_VERIFY = '/.netlify/functions/verify-subscription-payment';

export type SubscriptionState = {
  active: boolean;
  expiresAt: Date | null;
  daysLeft: number;
  /** true once the vendor has had at least one subscription (expired now). */
  expired: boolean;
};

/** Derive the live subscription state from a profile (client-side view). */
export function getSubscriptionState(profile: Profile | null): SubscriptionState {
  const expiresAt = profile?.subscription_expires_at
    ? new Date(profile.subscription_expires_at)
    : null;
  const active = !!expiresAt && expiresAt.getTime() > Date.now();
  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000))
    : 0;
  return {
    active,
    expiresAt,
    daysLeft,
    expired: !active && !!expiresAt,
  };
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Vous devez être connecté.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/**
 * Create a GeniusPay hosted checkout for the monthly subscription and redirect
 * the browser to it. The reference is stashed so we can verify on return.
 */
async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) {
    throw new Error(
      "Le service de paiement n'a pas répondu. Lancez l'app avec « netlify dev » " +
        '(les fonctions /api ne tournent pas avec « npm run dev »).'
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Réponse invalide du service de paiement (endpoint /api introuvable). " +
        'Utilisez « netlify dev » et vérifiez les variables d\'environnement.'
    );
  }
}

export async function startSubscriptionCheckout(): Promise<void> {
  const res = await fetch(FN_CREATE, {
    method: 'POST',
    headers: await authHeader(),
    body: '{}',
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) {
    const detail =
      data?.error ||
      data?.details?.error?.message ||
      data?.details?.message ||
      (data?.details ? JSON.stringify(data.details).slice(0, 300) : '');
    throw new Error(detail || "Impossible d'initier le paiement.");
  }
  if (data.reference) {
    try {
      localStorage.setItem(LAST_REF_KEY, data.reference);
    } catch {
      /* ignore storage errors */
    }
  }
  if (!data.checkout_url) throw new Error('Aucun lien de paiement reçu.');
  window.location.href = data.checkout_url;
}

/** Verify a payment by reference (server re-checks GeniusPay, then activates). */
export async function verifySubscriptionPayment(reference: string): Promise<{
  applied: boolean;
  status: string;
  subscription_expires_at: string | null;
}> {
  const res = await fetch(FN_VERIFY, {
    method: 'POST',
    headers: await authHeader(),
    body: JSON.stringify({ reference }),
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) throw new Error(data?.error || 'Vérification échouée.');
  return data;
}

export function popLastReference(): string | null {
  try {
    const ref = localStorage.getItem(LAST_REF_KEY);
    if (ref) localStorage.removeItem(LAST_REF_KEY);
    return ref;
  } catch {
    return null;
  }
}

export function formatXOF(amount: number): string {
  return `${Math.round(amount).toLocaleString('fr-FR')} FCFA`;
}

export function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
