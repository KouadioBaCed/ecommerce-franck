// POST /api/subscription/webhook  (→ /.netlify/functions/geniuspay-webhook)
//
// Receives GeniusPay webhook events. Verifies the HMAC-SHA256 signature, then
// reconciles payment.* events into our DB (idempotent with the verify endpoint).
//
// Configure this URL in GeniusPay → Webhooks with events:
//   payment.success, payment.failed, payment.cancelled, payment.expired

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from '@netlify/functions';
import { serviceClient, reconcilePayment, json } from './lib/subscription.mts';

function safeEqualHex(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const secret = process.env.GENIUSPAY_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook secret not configured' }, 500);

  const signature = req.headers.get('x-webhook-signature') || '';
  const timestamp = req.headers.get('x-webhook-timestamp') || '';
  const event = req.headers.get('x-webhook-event') || '';
  const rawBody = await req.text();

  // Replay protection: reject timestamps older than 5 minutes.
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return json({ error: 'Timestamp too old' }, 400);
  }

  // signature = HMAC-SHA256(timestamp + "." + payload, secret).
  // We verify against the raw body first (most robust); if the sender signed a
  // re-encoded JSON (as in the docs' PHP example), fall back to that form.
  const expectedRaw = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  let ok = safeEqualHex(expectedRaw, signature);

  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (!ok) {
    const reencoded = createHmac('sha256', secret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');
    ok = safeEqualHex(reencoded, signature);
  }
  if (!ok) return json({ error: 'Invalid signature' }, 401);

  const eventName = event || payload?.event || '';
  const data = payload?.data ?? {};
  const reference: string | undefined = data?.reference;

  // Only handle store-subscription payments we know about.
  if (reference && eventName.startsWith('payment.')) {
    const svc = serviceClient();
    // Map webhook event → status when the payload status is coarse.
    const status =
      data?.status ||
      (eventName === 'payment.success'
        ? 'completed'
        : eventName === 'payment.failed'
        ? 'failed'
        : eventName === 'payment.cancelled'
        ? 'cancelled'
        : eventName === 'payment.expired'
        ? 'expired'
        : 'pending');

    await reconcilePayment(svc, reference, {
      status,
      payment_method: data?.payment_method ?? data?.provider,
      amount: data?.amount,
      metadata: data?.metadata,
    });
  }

  // Always 200 so GeniusPay does not retry a valid-but-unmatched event forever.
  return json({ received: true });
};
