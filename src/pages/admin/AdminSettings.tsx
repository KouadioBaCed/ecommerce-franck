import { useEffect, useState } from 'react';
import {
  Store,
  Loader2,
  UploadCloud,
  X,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  AlertCircle,
  Link2,
  BarChart3,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { openStore } from '../../lib/openStore';
import { isValidPixelId } from '../../lib/metaPixel';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

type Field = 'store_logo_url' | 'banner_url';

export function AdminSettings() {
  const { user, profile, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    store_name: '',
    store_slug: '',
    store_description: '',
    whatsapp_number: '',
    store_logo_url: '',
    banner_url: '',
    meta_pixel_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<Field | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (profile) {
      setForm({
        store_name: profile.store_name || '',
        store_slug: profile.store_slug || '',
        store_description: profile.store_description || '',
        whatsapp_number: profile.whatsapp_number || '',
        store_logo_url: profile.store_logo_url || '',
        banner_url: profile.banner_url || '',
        meta_pixel_id: profile.meta_pixel_id || '',
      });
    }
  }, [profile]);

  async function uploadImage(bucket: string, field: Field, file: File) {
    if (!user) return;
    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit être une image');
      return;
    }
    if (file.size > 2 * 1024 * 1024 && bucket === 'store_logos') {
      setError('Le logo doit faire moins de 2 Mo. Choisis une image plus légère.');
      return;
    }
    setUploadingField(field);
    setError('');
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/${field}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(bucket)
        .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      setForm((f) => ({ ...f, [field]: data.publicUrl }));
    } catch (e) {
      const msg = (e as { message?: string })?.message || 'erreur inconnue';
      setError(`Échec de l'upload : ${msg}`);
    } finally {
      setUploadingField(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!form.store_name.trim()) {
      setError('Le nom de la boutique est requis');
      return;
    }

    const pixel = form.meta_pixel_id.trim();
    if (pixel && !isValidPixelId(pixel)) {
      setError('Le Meta Pixel ID doit être numérique (10 à 20 chiffres).');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess(false);

    const slug = slugify(form.store_slug || form.store_name);

    const { error: upErr } = await supabase
      .from('profiles')
      .update({
        store_name: form.store_name.trim(),
        store_slug: slug || null,
        store_description: form.store_description.trim(),
        whatsapp_number: form.whatsapp_number.trim(),
        store_logo_url: form.store_logo_url,
        banner_url: form.banner_url,
        meta_pixel_id: pixel || null,
      })
      .eq('id', user.id);

    if (upErr) {
      if ((upErr as { code?: string }).code === '23505') {
        setError('Ce nom d\'URL de boutique est déjà pris. Choisis-en un autre.');
      } else {
        setError('Erreur lors de la sauvegarde');
      }
    } else {
      await refreshProfile();
      setForm((f) => ({ ...f, store_slug: slug }));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2800);
    }
    setSaving(false);
  }

  const waPreview = form.whatsapp_number.replace(/\D/g, '');

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink leading-tight">Ma boutique</h1>
          <p className="text-ink-muted text-sm mt-1.5">Personnalise ta vitrine et tes coordonnées de commande.</p>
        </div>
        {profile?.store_slug && (
          <button
            onClick={() => openStore(profile.store_slug!)}
            className="inline-flex items-center gap-2 bg-white border border-slate-200 text-ink-soft hover:text-ink hover:border-slate-300 text-sm font-semibold px-4 py-2.5 rounded-full transition-colors shrink-0"
          >
            <ExternalLink className="w-4 h-4" /> Voir ma boutique
          </button>
        )}
      </header>

      <form onSubmit={handleSave} className="space-y-5">
        {error && (
          <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-600 text-sm px-4 py-3 rounded-2xl animate-pop">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 rounded-2xl animate-pop">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Boutique mise à jour avec succès.
          </div>
        )}

        {/* Banner + logo card */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-soft overflow-hidden">
          {/* Banner */}
          <div className="relative h-40 bg-brand-gradient-2">
            {form.banner_url && <img src={form.banner_url} alt="" className="w-full h-full object-cover" />}
            <div className="absolute inset-0 bg-grid opacity-20" />
            <label className="absolute top-3 right-3 cursor-pointer inline-flex items-center gap-1.5 bg-white/90 backdrop-blur-sm text-ink text-xs font-semibold px-3 py-1.5 rounded-full shadow-soft hover:bg-white transition-colors">
              {uploadingField === 'banner_url' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              Bannière
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage('store_banners', 'banner_url', f); e.target.value = ''; }}
              />
            </label>
            {form.banner_url && (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, banner_url: '' }))}
                className="absolute top-3 right-28 bg-white/90 text-rose-500 w-7 h-7 grid place-items-center rounded-full shadow-soft hover:bg-white"
                aria-label="Retirer la bannière"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Logo */}
          <div className="px-6 pb-6">
            <div className="relative -mt-10 w-20 h-20">
              <div className="w-20 h-20 rounded-3xl bg-white border-4 border-white shadow-elevated overflow-hidden grid place-items-center">
                {form.store_logo_url ? (
                  <img src={form.store_logo_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full bg-brand-gradient grid place-items-center text-white text-2xl font-extrabold font-display">
                    {(form.store_name || 'B')[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <label className="absolute -bottom-1 -right-1 cursor-pointer w-8 h-8 grid place-items-center bg-ink text-white rounded-full shadow-soft hover:bg-brand-700 transition-colors">
                {uploadingField === 'store_logo_url' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage('store_logos', 'store_logo_url', f); e.target.value = ''; }}
                />
              </label>
            </div>
            <p className="text-[11px] text-ink-muted mt-2">Logo carré (PNG/JPG) et bannière large recommandés.</p>
          </div>
        </div>

        {/* Identity */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-6 space-y-5">
          <Field label="Nom de la boutique" required>
            <input
              type="text"
              required
              value={form.store_name}
              onChange={(e) => setForm({ ...form, store_name: e.target.value })}
              onBlur={() => { if (!form.store_slug && form.store_name) setForm((f) => ({ ...f, store_slug: slugify(f.store_name) })); }}
              placeholder="Ex: Atelier Aurora"
              className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
            />
          </Field>

          <Field label="URL de la boutique">
            <div className="flex items-center gap-2 bg-surface-tint rounded-2xl px-4 py-3 border border-transparent focus-within:bg-white focus-within:border-brand-300 transition-all">
              <Link2 className="w-4 h-4 text-ink-subtle shrink-0" />
              <span className="text-sm text-ink-subtle">/store/</span>
              <input
                type="text"
                value={form.store_slug}
                onChange={(e) => setForm({ ...form, store_slug: slugify(e.target.value) })}
                placeholder="atelier-aurora"
                className="flex-1 bg-transparent text-sm outline-none text-ink"
              />
            </div>
            <p className="text-[11px] text-ink-muted mt-1.5">Identifiant unique dans l'URL publique de ta boutique.</p>
          </Field>

          <Field label="Description">
            <textarea
              value={form.store_description}
              onChange={(e) => setForm({ ...form, store_description: e.target.value })}
              rows={3}
              placeholder="Présente ta boutique en quelques mots..."
              className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all resize-none"
            />
          </Field>
        </div>

        {/* WhatsApp */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-6 space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 grid place-items-center shrink-0">
              <MessageCircle className="w-5 h-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Numéro WhatsApp de commande</p>
              <p className="text-[11px] text-ink-muted">C'est ici que tes clients t'enverront leurs commandes.</p>
            </div>
          </div>
          <input
            type="tel"
            value={form.whatsapp_number}
            onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })}
            placeholder="212612345678"
            className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all tabular-nums"
          />
          <p className="text-[11px] text-ink-muted">
            Format international, indicatif inclus, sans + ni espaces. Ex (Maroc) : <span className="font-semibold text-ink-soft">212612345678</span>.
            {waPreview && waPreview.startsWith('0') && (
              <span className="block text-amber-600 mt-1">⚠ Un numéro commençant par 0 ne fonctionnera pas sur WhatsApp : remplace le 0 par l'indicatif pays (212).</span>
            )}
          </p>
        </div>

        {/* Marketing — Meta Pixel */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-6 space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 grid place-items-center shrink-0">
              <BarChart3 className="w-5 h-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">Meta Pixel (Facebook)</p>
              <p className="text-[11px] text-ink-muted">Suis tes visiteurs et conversions pour tes pubs Facebook/Instagram.</p>
            </div>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={form.meta_pixel_id}
            onChange={(e) => setForm({ ...form, meta_pixel_id: e.target.value.replace(/[^\d]/g, '') })}
            placeholder="Ex: 1234567890123456"
            className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all tabular-nums"
          />
          <p className="text-[11px] text-ink-muted">
            Colle l'ID de ton Pixel (numérique, 15–16 chiffres) depuis le Gestionnaire d'événements Meta.
            Laisse vide pour ne charger aucun script de suivi.
          </p>
        </div>

        {/* Save */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={saving || !!uploadingField}
            className="inline-flex items-center justify-center gap-2 bg-ink hover:bg-brand-700 disabled:opacity-50 text-white font-semibold px-6 py-3 rounded-full text-sm transition-colors shadow-soft"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />}
            Enregistrer ma boutique
          </button>
        </div>
      </form>
    </div>
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
