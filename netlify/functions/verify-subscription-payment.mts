// POST /api/subscription/verify  (→ /.netlify/functions/verify-subscription-payment)
// Body: { reference: "MTX-..." }
//
// Called when the customer returns from the GeniusPay checkout. Re-checks the
// transaction status with GeniusPay (source of truth) and, if paid, activates
// the vendor's subscription for one month. Idempotent — safe to call repeatedly
// and works alongside the webhook.

import type { Context } from '@netlify/functions';
import {
  geniusBaseUrl,
  geniusHeaders,
  serviceClient,
  userFromRequest,
  reconcilePayment,
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

  let body: { reference?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const reference = body.reference?.trim();
  if (!reference) return json({ error: 'reference is required' }, 400);

  const svc = serviceClient();

  // The reference must belong to the caller — or the caller must be an admin.
  const { data: row } = await svc
    .from('subscription_payments')
    .select('vendor_id')
    .eq('reference', reference)
    .maybeSingle();
  if (!row) return json({ error: 'Transaction not found' }, 404);
  if (row.vendor_id !== user.id) {
    const { data: prof } = await svc
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (prof?.role !== 'admin') return json({ error: 'Transaction not found' }, 404);
  }

  // Ask GeniusPay for the authoritative status.
  let genius: any;
  try {
    const res = await fetch(`${geniusBaseUrl()}/payments/${encodeURIComponent(reference)}`, {
      headers: geniusHeaders(),
    });
    genius = await res.json();
    if (!res.ok || genius?.success === false) {
      const message = genius?.error?.message || genius?.message || 'GeniusPay lookup failed';
      return json({ error: message }, 502);
    }
  } catch (e) {
    return json({ error: `GeniusPay unreachable: ${(e as Error).message}` }, 502);
  }

  const data = genius.data ?? genius;
  const result = await reconcilePayment(svc, reference, {
    status: data?.status,
    payment_method: data?.payment_method ?? data?.payment_provider,
    amount: data?.amount,
    metadata: data?.metadata,
  });

  return json(result);
};
