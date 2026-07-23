import { isMetaInAppBrowser } from './inAppBrowser';

export interface CartMessageItem {
  name: string;
  size: string | null;
  qty: number;
  unitPrice: number;
  productUrl: string;
}

export interface OrderCustomer {
  firstName: string;
  lastName: string;
  phone: string;
  address?: string;
}

export function buildCartOrderMessage(params: {
  storeName: string;
  items: CartMessageItem[];
  customer: OrderCustomer;
}): string {
  const { storeName, items, customer } = params;
  const total = items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);

  const lines: string[] = [`Bonjour ${storeName} !`, '', 'Je souhaite passer commande :'];

  items.forEach((it, i) => {
    lines.push('');
    lines.push(`${i + 1}. *${it.name}*${it.size ? ` (${it.size})` : ''}`);
    lines.push(`Lien : ${it.productUrl}`);
    lines.push(`Prix unitaire : ${it.unitPrice.toLocaleString('fr-FR')} FCFA`);
    lines.push(`Quantité : ${it.qty}`);
    lines.push(`Sous-total : ${(it.unitPrice * it.qty).toLocaleString('fr-FR')} FCFA`);
  });

  lines.push('', `Total : ${total.toLocaleString('fr-FR')} FCFA`, '');
  lines.push('Mes informations :');
  lines.push(`Nom : ${customer.lastName.trim()}`);
  lines.push(`Prénom : ${customer.firstName.trim()}`);
  lines.push(`Téléphone : ${customer.phone.trim()}`);
  if (customer.address?.trim()) lines.push(`Adresse : ${customer.address.trim()}`);
  lines.push('', 'Merci de me confirmer la disponibilité 🙏');

  return lines.join('\n');
}

/**
 * api.whatsapp.com/send is the direct click-to-chat endpoint — wa.me is just
 * an alias that 302-redirects to it, and that extra hop is where Facebook's
 * in-app browser tends to drop the `text` query param. Inside that in-app
 * WebView, window.open() popups are also blocked/mishandled, so we navigate
 * top-level (same tab) there instead.
 */
export function openWhatsAppChat(phoneDigits: string, message: string): void {
  const url = `https://api.whatsapp.com/send?phone=${phoneDigits}&text=${encodeURIComponent(message)}`;
  if (isMetaInAppBrowser()) {
    window.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
