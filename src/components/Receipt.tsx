import { CheckCircle2, Printer, Download } from 'lucide-react';
import type { SubscriptionPayment } from '../lib/types';
import { BRAND_NAME, formatXOF, formatDate, formatDateTime } from '../lib/subscription';

type ReceiptVendor = {
  store_name?: string | null;
  full_name?: string | null;
  email?: string | null;
};

/** On-screen receipt card, branded "Dunamis Boutique". */
export function Receipt({
  payment,
  vendor,
}: {
  payment: SubscriptionPayment;
  vendor: ReceiptVendor;
}) {
  const paid = payment.status === 'completed';
  const customer = vendor.store_name || vendor.full_name || vendor.email || 'Client';

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-soft overflow-hidden">
      {/* Header */}
      <div className="relative bg-ink text-white px-6 py-6 sm:px-8">
        <div className="absolute -top-16 -right-10 w-56 h-56 bg-brand-500/25 rounded-full blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-xl font-extrabold tracking-tight">
              {BRAND_NAME}
            </p>
            <p className="text-white/60 text-xs mt-0.5">Reçu de paiement d'abonnement</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
              paid ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {paid ? 'Payé' : payment.status}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-6 py-6 sm:px-8 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Référence" value={payment.reference || '—'} mono />
          <Field label="Date de paiement" value={formatDateTime(payment.paid_at || payment.created_at)} />
          <Field label="Client" value={customer} />
          <Field
            label="Moyen de paiement"
            value={payment.payment_method ? payment.payment_method : 'GeniusPay'}
          />
        </div>

        <div className="border-t border-dashed border-slate-200 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">Abonnement boutique — 1 mois</p>
              <p className="text-xs text-ink-muted mt-0.5">
                Période : {formatDate(payment.period_start)} → {formatDate(payment.period_end)}
              </p>
            </div>
            <p className="text-sm font-bold text-ink tabular-nums">{formatXOF(payment.amount)}</p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-soft">Total réglé</p>
          <p className="font-display text-2xl font-extrabold text-ink tabular-nums">
            {formatXOF(payment.amount)}
          </p>
        </div>

        <p className="text-[11px] text-ink-muted leading-relaxed">
          Abonnement mensuel. Votre boutique reste active jusqu'au{' '}
          <span className="font-semibold text-ink-soft">{formatDate(payment.period_end)}</span>.
          Pensez à renouveler avant l'échéance pour éviter toute interruption. Merci de votre
          confiance — {BRAND_NAME}.
        </p>

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => printReceipt(payment, vendor)}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-ink hover:bg-brand-700 text-white text-sm font-semibold py-3 rounded-2xl transition-colors"
          >
            <Printer className="w-4 h-4" /> Imprimer
          </button>
          <button
            onClick={() => printReceipt(payment, vendor)}
            className="inline-flex items-center justify-center gap-2 bg-surface-tint hover:bg-slate-200 text-ink-soft text-sm font-semibold px-4 py-3 rounded-2xl transition-colors"
            aria-label="Télécharger le reçu"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">{label}</p>
      <p className={`text-sm text-ink mt-0.5 break-words ${mono ? 'font-mono' : 'font-medium'}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Open a clean, standalone print window with the receipt. Users can print or
 * "Save as PDF" from the browser dialog — no extra dependency needed.
 */
export function printReceipt(payment: SubscriptionPayment, vendor: ReceiptVendor) {
  const customer = vendor.store_name || vendor.full_name || vendor.email || 'Client';
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)
    );

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8" />
<title>Reçu ${esc(payment.reference || '')} — ${esc(BRAND_NAME)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; background: #f8fafc; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px -12px rgba(0,0,0,.18); }
  .head { background: #0f172a; color: #fff; padding: 28px 32px; display: flex; justify-content: space-between; align-items: flex-start; }
  .brand { font-size: 22px; font-weight: 800; }
  .sub { color: rgba(255,255,255,.6); font-size: 12px; margin-top: 4px; }
  .badge { background: rgba(16,185,129,.2); color: #6ee7b7; font-size: 11px; font-weight: 700; padding: 6px 12px; border-radius: 999px; }
  .body { padding: 28px 32px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .lbl { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: #94a3b8; font-weight: 700; }
  .val { font-size: 14px; margin-top: 2px; font-weight: 500; word-break: break-word; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .row { display: flex; justify-content: space-between; align-items: center; }
  .line { border-top: 1px dashed #e2e8f0; margin: 20px 0; }
  .total { font-size: 24px; font-weight: 800; }
  .note { font-size: 11px; color: #64748b; margin-top: 18px; line-height: 1.6; }
  @media print { body { background: #fff; padding: 0; } .card { box-shadow: none; } }
</style></head>
<body>
  <div class="card">
    <div class="head">
      <div><div class="brand">${esc(BRAND_NAME)}</div><div class="sub">Reçu de paiement d'abonnement</div></div>
      <div class="badge">${payment.status === 'completed' ? 'Payé' : esc(payment.status)}</div>
    </div>
    <div class="body">
      <div class="grid">
        <div><div class="lbl">Référence</div><div class="val mono">${esc(payment.reference || '—')}</div></div>
        <div><div class="lbl">Date de paiement</div><div class="val">${esc(formatDateTime(payment.paid_at || payment.created_at))}</div></div>
        <div><div class="lbl">Client</div><div class="val">${esc(customer)}</div></div>
        <div><div class="lbl">Moyen de paiement</div><div class="val">${esc(payment.payment_method || 'GeniusPay')}</div></div>
      </div>
      <div class="line"></div>
      <div class="row">
        <div>
          <div class="val" style="font-weight:600">Abonnement boutique — 1 mois</div>
          <div class="sub" style="color:#64748b">Période : ${esc(formatDate(payment.period_start))} → ${esc(formatDate(payment.period_end))}</div>
        </div>
        <div class="val" style="font-weight:700">${esc(formatXOF(payment.amount))}</div>
      </div>
      <div class="line"></div>
      <div class="row"><div class="val" style="font-weight:600">Total réglé</div><div class="total">${esc(formatXOF(payment.amount))}</div></div>
      <div class="note">Abonnement mensuel. Votre boutique reste active jusqu'au ${esc(formatDate(payment.period_end))}. Pensez à renouveler avant l'échéance. Merci de votre confiance — ${esc(BRAND_NAME)}.</div>
    </div>
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
</body></html>`;

  const w = window.open('', '_blank', 'width=640,height=800');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
