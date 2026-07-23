import { useMemo, useState } from 'react';
import {
  ShoppingCart,
  Package,
  Minus,
  Plus,
  Trash2,
  MessageCircle,
  ArrowLeft,
  XCircle,
  CheckCircle2,
  Store,
} from 'lucide-react';
import { Modal } from './Modal';
import { InAppBrowserNotice } from './InAppBrowserNotice';
import { useCart, type CartLine } from '../context/CartContext';
import { isMetaInAppBrowser } from '../lib/inAppBrowser';
import { buildCartOrderMessage, openWhatsAppChat } from '../lib/whatsappOrder';

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface SellerGroup {
  sellerId: string;
  storeName: string;
  storeSlug: string | null;
  whatsappNumber: string | null;
  items: CartLine[];
  subtotal: number;
}

export function CartDrawer({ open, onClose }: CartDrawerProps) {
  const { items, removeItem, setQty, clear } = useCart();
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [cust, setCust] = useState({ firstName: '', lastName: '', phone: '', address: '' });
  const [error, setError] = useState('');
  const [sentSellers, setSentSellers] = useState<Set<string>>(new Set());
  const inAppBrowser = useMemo(() => isMetaInAppBrowser(), []);

  const groups = useMemo<SellerGroup[]>(() => {
    const map = new Map<string, SellerGroup>();
    for (const it of items) {
      let g = map.get(it.sellerId);
      if (!g) {
        g = {
          sellerId: it.sellerId,
          storeName: it.storeName,
          storeSlug: it.storeSlug,
          whatsappNumber: it.whatsappNumber,
          items: [],
          subtotal: 0,
        };
        map.set(it.sellerId, g);
      }
      g.items.push(it);
      g.subtotal += it.price * it.qty;
    }
    return Array.from(map.values());
  }, [items]);

  const grandTotal = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const allSent = groups.length > 0 && groups.every((g) => sentSellers.has(g.sellerId));

  function close() {
    onClose();
    setStep('cart');
    setError('');
  }

  function goCheckout() {
    setError('');
    if (items.length === 0) return;
    setStep('checkout');
  }

  function sendToSeller(group: SellerGroup) {
    setError('');
    if (!cust.firstName.trim() || !cust.lastName.trim() || !cust.phone.trim()) {
      setError('Renseigne ton prénom, nom et numéro de téléphone.');
      return;
    }
    const phone = group.whatsappNumber?.replace(/\D/g, '');
    if (!phone) {
      setError(`${group.storeName} n'a pas configuré de numéro WhatsApp.`);
      return;
    }
    const message = buildCartOrderMessage({
      storeName: group.storeName,
      items: group.items.map((it) => ({
        name: it.name,
        size: it.size,
        qty: it.qty,
        unitPrice: it.price,
        productUrl: `${window.location.origin}/product/${it.productId}`,
      })),
      customer: cust,
    });
    openWhatsAppChat(phone, message);
    setSentSellers((prev) => new Set(prev).add(group.sellerId));
  }

  function finish() {
    clear();
    setSentSellers(new Set());
    setCust({ firstName: '', lastName: '', phone: '', address: '' });
    close();
  }

  return (
    <Modal open={open} onClose={close} size="lg">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-5">
          {step === 'checkout' && (
            <button
              onClick={() => setStep('cart')}
              aria-label="Retour"
              className="w-9 h-9 grid place-items-center rounded-full text-ink-soft hover:bg-surface-tint transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <span className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 grid place-items-center shrink-0">
            <ShoppingCart className="w-5 h-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-extrabold text-ink leading-tight">
              {step === 'cart' ? 'Mon panier' : 'Finaliser ma commande'}
            </h2>
            <p className="text-[11px] text-ink-muted">
              {step === 'cart'
                ? `${items.reduce((s, i) => s + i.qty, 0)} article(s)`
                : 'Un message WhatsApp par boutique sera préparé.'}
            </p>
          </div>
        </div>

        {step === 'cart' ? (
          items.length === 0 ? (
            <div className="text-center py-10">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-tint grid place-items-center">
                <Package className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-sm text-ink-muted mt-4">Ton panier est vide.</p>
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <div key={group.sellerId} className="border border-slate-100 rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-2 bg-surface-tint px-4 py-2.5">
                    <Store className="w-3.5 h-3.5 text-ink-muted" />
                    <span className="text-xs font-semibold text-ink truncate">{group.storeName}</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {group.items.map((it) => (
                      <div key={it.key} className="flex items-center gap-3 px-4 py-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-surface-tint shrink-0 ring-1 ring-slate-100">
                          {it.image ? (
                            <img src={it.image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full grid place-items-center">
                              <Package className="w-5 h-5 text-slate-300" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ink truncate">{it.name}</p>
                          <p className="text-xs text-ink-muted">
                            {it.size ? `Taille ${it.size} · ` : ''}
                            {it.price.toLocaleString('fr-FR')} FCFA
                          </p>
                        </div>
                        <div className="flex items-center gap-1 bg-surface-tint rounded-full p-1 shrink-0">
                          <button
                            onClick={() => setQty(it.key, it.qty - 1)}
                            className="w-7 h-7 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink transition-all"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="min-w-[1.75rem] text-center text-xs font-bold text-ink tabular-nums">{it.qty}</span>
                          <button
                            onClick={() => setQty(it.key, it.qty + 1)}
                            className="w-7 h-7 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink transition-all"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(it.key)}
                          aria-label="Retirer"
                          className="w-8 h-8 grid place-items-center rounded-full text-ink-subtle hover:text-rose-500 hover:bg-rose-50 transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 bg-surface-tint/60 text-xs">
                    <span className="text-ink-muted">Sous-total</span>
                    <span className="font-bold text-ink tabular-nums">{group.subtotal.toLocaleString('fr-FR')} FCFA</span>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between pt-1">
                <span className="text-sm font-semibold text-ink-soft">Total</span>
                <span className="text-lg font-extrabold text-ink tabular-nums">
                  {grandTotal.toLocaleString('fr-FR')} <span className="text-xs text-ink-muted font-semibold">FCFA</span>
                </span>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={clear}
                  className="py-3 px-4 rounded-2xl text-sm font-semibold text-ink-soft bg-surface-tint hover:bg-slate-200 transition-colors"
                >
                  Vider
                </button>
                <button
                  onClick={goCheckout}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-[0_8px_20px_-8px_rgba(16,185,129,0.55)]"
                >
                  <MessageCircle className="w-4 h-4" />
                  Valider ma commande
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="space-y-4">
            {inAppBrowser && <InAppBrowserNotice />}

            {error && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-600 text-sm px-4 py-3 rounded-2xl animate-pop">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Prénom" required>
                <input
                  type="text"
                  required
                  value={cust.firstName}
                  onChange={(e) => setCust({ ...cust, firstName: e.target.value })}
                  placeholder="Sara"
                  className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
                />
              </Field>
              <Field label="Nom" required>
                <input
                  type="text"
                  required
                  value={cust.lastName}
                  onChange={(e) => setCust({ ...cust, lastName: e.target.value })}
                  placeholder="El Amrani"
                  className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
                />
              </Field>
            </div>

            <Field label="Téléphone" required>
              <input
                type="tel"
                required
                value={cust.phone}
                onChange={(e) => setCust({ ...cust, phone: e.target.value })}
                placeholder="0612345678"
                className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all tabular-nums"
              />
            </Field>

            <Field label="Adresse / précisions (optionnel)">
              <textarea
                value={cust.address}
                onChange={(e) => setCust({ ...cust, address: e.target.value })}
                rows={2}
                placeholder="Ville, quartier, point de repère..."
                className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all resize-none"
              />
            </Field>

            <div className="space-y-2.5 pt-1">
              <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
                Envoyer à chaque boutique
              </p>
              {groups.map((group) => {
                const sent = sentSellers.has(group.sellerId);
                return (
                  <div
                    key={group.sellerId}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                      sent ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 bg-white'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{group.storeName}</p>
                      <p className="text-xs text-ink-muted">
                        {group.items.length} produit(s) · {group.subtotal.toLocaleString('fr-FR')} FCFA
                      </p>
                    </div>
                    {sent ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                        Envoyé
                      </span>
                    ) : (
                      <button
                        onClick={() => sendToSeller(group)}
                        className="inline-flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-3.5 py-2 rounded-full transition-colors shrink-0"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Envoyer
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {allSent && (
              <button
                onClick={finish}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-white bg-ink hover:bg-brand-700 transition-colors"
              >
                Terminer et vider le panier
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-ink-soft uppercase tracking-wider flex items-center gap-1">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}
