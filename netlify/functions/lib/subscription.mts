// Shared server-side helpers for the store-subscription flow.
// Files under netlify/functions/lib/ are NOT deployed as their own functions
// (only top-level files in netlify/functions are), so this is a safe module.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Monthly price of a store subscription, in XOF. */
export const SUBSCRIPTION_AMOUNT = 500;
export const SUBSCRIPTION_CURRENCY = 'XOF';
export const SUBSCRIPTION_PERIOD_DAYS = 30;
export const BRAND_NAME = 'Dunamis Boutique';

export function geniusBaseUrl(): string {
  return (
    process.env.GENIUSPAY_BASE_URL || 'https://geniuspay.ci/api/v1/merchant'
  ).replace(/\/+$/, '');
}

export function geniusHeaders(): Record<string, string> {
  const key = process.env.GENIUSPAY_API_KEY;
  const secret = process.env.GENIUSPAY_API_SECRET;
  if (!key || !secret) {
    throw new Error('GENIUSPAY_API_KEY / GENIUSPAY_API_SECRET are not configured');
  }
  return {
    'X-API-Key': key,
    'X-API-Secret': secret,
    'Content-Type': 'application/json',
  };
}

/** Service-role client — bypasses RLS. NEVER expose this key to the browser. */
export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve the authenticated user from a `Authorization: Bearer <jwt>` header. */
export async function userFromRequest(
  req: Request
): Promise<{ id: string; email: string | null } | null> {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  const token = auth?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase URL / anon key not configured');

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

type GeniusStatus =
  | 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'cancelled' | 'refunded';

/** GeniusPay statuses that mean "money received → grant a month". */
export function isPaidStatus(status?: string | null): boolean {
  return status === 'completed';
}

/**
 * Idempotently reconcile a GeniusPay transaction into our DB.
 * - Updates the subscription_payments row (status, method, paid_at, period).
 * - On the first transition to `completed`, extends the vendor's subscription
 *   by one month from max(now, current expiry).
 * Returns the fresh subscription_expires_at (or null).
 */
export async function reconcilePayment(
  svc: SupabaseClient,
  reference: string,
  genius: {
    status?: string | null;
    payment_method?: string | null;
    amount?: number | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<{ applied: boolean; status: string; subscription_expires_at: string | null }> {
  const { data: row } = await svc
    .from('subscription_payments')
    .select('id, vendor_id, status, period_end')
    .eq('reference', reference)
    .maybeSingle();

  if (!row) {
    return { applied: false, status: genius.status ?? 'unknown', subscription_expires_at: null };
  }

  const status = (genius.status as GeniusStatus) ?? 'pending';
  const alreadyCompleted = row.status === 'completed';
  const nowIso = new Date().toISOString();

  // Extend the subscription only on the first completion.
  let periodStart: string | null = null;
  let periodEnd: string | null = row.period_end ?? null;
  let expiresAt: string | null = null;

  if (isPaidStatus(status) && !alreadyCompleted) {
    const { data: prof } = await svc
      .from('profiles')
      .select('subscription_expires_at')
      .eq('id', row.vendor_id)
      .maybeSingle();

    const current = prof?.subscription_expires_at
      ? new Date(prof.subscription_expires_at as string)
      : null;
    const base = current && current.getTime() > Date.now() ? current : new Date();
    const end = new Date(base.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    periodStart = nowIso;
    periodEnd = end.toISOString();
    expiresAt = end.toISOString();

    await svc
      .from('profiles')
      .update({
        subscription_status: 'active',
        subscription_started_at: nowIso,
        subscription_expires_at: end.toISOString(),
      })
      .eq('id', row.vendor_id);
  }

  await svc
    .from('subscription_payments')
    .update({
      status,
      payment_method: genius.payment_method ?? undefined,
      amount: typeof genius.amount === 'number' ? genius.amount : undefined,
      paid_at: isPaidStatus(status) ? nowIso : undefined,
      period_start: periodStart ?? undefined,
      period_end: periodEnd ?? undefined,
      metadata: genius.metadata ?? undefined,
    })
    .eq('id', row.id);

  return {
    applied: isPaidStatus(status) && !alreadyCompleted,
    status,
    subscription_expires_at: expiresAt,
  };
}

/** Small helper to build JSON responses with CORS for same-origin calls. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
