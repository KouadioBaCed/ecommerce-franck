import { MessageCircle } from 'lucide-react';

export function InAppBrowserNotice() {
  return (
    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs px-4 py-3 rounded-2xl">
      <MessageCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        Tu es dans l'appli Facebook/Instagram : si WhatsApp ne s'ouvre pas avec ta commande pré-remplie,
        appuie sur <strong>⋯</strong> en haut à droite puis <strong>« Ouvrir dans le navigateur »</strong> avant d'envoyer.
      </span>
    </div>
  );
}
