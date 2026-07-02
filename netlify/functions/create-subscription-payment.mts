// POST /api/subscription/create  (→ /.netlify/functions/create-subscription-payment)
//
// Creates a GeniusPay *hosted checkout* for the caller's monthly store
// subscription (500 FCFA) and records a pending row in subscription_payments.
// Returns { reference, checkout_url } — the frontend redirects to checkout_url.
//
// The GeniusPay secret key lives only in this server-side function.

import type { Context } from '@netlify/functions';
import {
  SUBSCRIPTION_AMOUNT,
  SUBSCRIPTION_CURRENCY,
  SUBSCRIPTION_PERIOD_DAYS,
  BRAND_NAME,
  geniusBaseUrl,
  geniusHeaders,
  serviceClient,
  userFromRequest,
  json,
} from './lib/subscription.mts';

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let user;
  try {
    user = await userFromRequest(req);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
  if (!user) return json({ error: 'Authentication required' }, 401);

  const svc = serviceClient();

  // Load the vendor profile for a nicer checkout (name / phone).
  const { data: profile } = await svc
    .from('profiles')
    .select('store_name, full_name, phone, whatsapp_number, email')
    .eq('id', user.id)
    .maybeSingle();

  // Where GeniusPay sends the customer back afterwards.
  const origin =
    process.env.SITE_URL ||
    req.headers.get('origin') ||
    new URL(req.url).origin;
  const successUrl = `${origin}/admin/subscription?status=success`;
  const errorUrl = `${origin}/admin/subscription?status=error`;

  // 1) Create the payment on GeniusPay (no payment_method → hosted checkout).
  let genius: any;
  try {
    const res = await fetch(`${geniusBaseUrl()}/payments`, {
      method: 'POST',
      headers: geniusHeaders(),
      body: JSON.stringify({
        amount: SUBSCRIPTION_AMOUNT,
        currency: SUBSCRIPTION_CURRENCY,
        description: `Abonnement boutique (1 mois) — ${BRAND_NAME}`,
        customer: {
          name: profile?.store_name || profile?.full_name || undefined,
          email: user.email || profile?.email || undefined,
          phone: profile?.whatsapp_number || profile?.phone || undefined,
        },
        success_url: successUrl,
        error_url: errorUrl,
        metadata: {
          vendor_id: user.id,
          type: 'store_subscription',
          period_days: SUBSCRIPTION_PERIOD_DAYS,
          brand: BRAND_NAME,
        },
      }),
    });
    genius = await res.json();
    if (!res.ok || genius?.success === false) {
      const message =
        genius?.error?.message || genius?.message || 'GeniusPay payment init failed';
      return json({ error: message, details: genius }, 502);
    }
  } catch (e) {
    return json({ error: `GeniusPay unreachable: ${(e as Error).message}` }, 502);
  }

  const data = genius.data ?? genius;
  const reference: string | undefined = data?.reference;
  const checkoutUrl: string | undefined = data?.checkout_url || data?.payment_url;

  if (!reference || !checkoutUrl) {
    return json({ error: 'GeniusPay returned no reference/checkout_url', details: genius }, 502);
  }

  // 2) Record a pending payment row (upsert on reference for idempotency).
  const { error: insErr } = await svc.from('subscription_payments').upsert(
    {
      vendor_id: user.id,
      reference,
      provider: 'geniuspay',
      amount: data?.amount ?? SUBSCRIPTION_AMOUNT,
      currency: data?.currency ?? SUBSCRIPTION_CURRENCY,
      status: data?.status ?? 'pending',
      checkout_url: checkoutUrl,
      metadata: data?.metadata ?? {},
    },
    { onConflict: 'reference' }
  );
  if (insErr) return json({ error: `DB error: ${insErr.message}` }, 500);

  return json({ reference, checkout_url: checkoutUrl });
};
