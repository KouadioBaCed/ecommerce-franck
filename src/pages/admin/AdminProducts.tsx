import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Package,
  X,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  UploadCloud,
  Search,
  Filter,
  Tag,
  DollarSign,
  ChevronDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { Product } from '../../lib/types';
import { Modal } from '../../components/Modal';

const CATEGORIES = ['Vêtements', 'Chaussures', 'Électronique', 'Alimentation', 'Beauté', 'Sport', 'Maison', 'Jouets', 'Livres', 'Autre'];

// Categories that require a size/pointure picker, with their preset values.
const SIZE_PRESETS: Record<string, string[]> = {
  'Vêtements':  ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  'Chaussures': ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
};
const needsSizes = (cat: string) => cat in SIZE_PRESETS;
const sizeNoun = (cat: string) => (cat === 'Chaussures' ? 'Pointures' : 'Tailles');

const MAX_IMAGES = 6;

interface ProductFormData {
  name: string;
  description: string;
  price: string;
  images: string[];
  category: string;
  in_stock: boolean;
  sizes: string[];
  sizeStock: Record<string, number>;
}

const defaultForm: ProductFormData = {
  name: '',
  description: '',
  price: '',
  images: [],
  category: '',
  in_stock: true,
  sizes: [],
  sizeStock: {},
};

export function AdminProducts() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormData>(defaultForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [categoryFilter, setCategoryFilter] = useState('');

  async function loadProducts() {
    if (!user) return;
    const { data } = await supabase
      .from('products')
      .select('*')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false });
    setProducts(data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadProducts(); }, [user]);

  const visible = useMemo(() => products.filter((p) => {
    if (filter === 'in' && !p.in_stock) return false;
    if (filter === 'out' && p.in_stock) return false;
    if (categoryFilter && p.category !== categoryFilter) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [products, filter, categoryFilter, search]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))],
    [products]
  );

  function openNew() {
    setEditing(null);
    setForm(defaultForm);
    setError('');
    setShowForm(true);
  }

  async function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description,
      price: String(p.price),
      images: p.image_url ? [p.image_url] : [],
      category: p.category,
      in_stock: p.in_stock,
      sizes: p.sizes ?? [],
      sizeStock: p.size_stock ?? {},
    });
    setError('');
    setShowForm(true);

    // Load the full image gallery (falls back to the cover above if none)
    const { data } = await supabase
      .from('product_images')
      .select('url, position')
      .eq('product_id', p.id)
      .order('position', { ascending: true });
    if (data && data.length) {
      setForm((f) => ({ ...f, images: data.map((r) => r.url) }));
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!form.name.trim()) { setError('Le nom est requis'); return; }
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) < 0) {
      setError('Prix invalide');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      image_url: (form.images[0] || '').trim(), // first image = cover (used in listings)
      category: form.category,
      in_stock: form.in_stock,
      // Only persist sizes for categories that use them; clear otherwise.
      sizes: needsSizes(form.category) ? form.sizes : [],
      // Keep only stock entries for the selected sizes.
      size_stock: needsSizes(form.category)
        ? Object.fromEntries(form.sizes.map((s) => [s, Math.max(0, form.sizeStock[s] ?? 0)]))
        : {},
      seller_id: user.id,
    };

    let productId = editing?.id;
    let err;
    if (editing) {
      const res = await supabase.from('products').update(payload).eq('id', editing.id);
      err = res.error;
    } else {
      const res = await supabase.from('products').insert(payload).select('id').single();
      err = res.error;
      productId = res.data?.id;
    }

    // Sync the gallery (product_images): replace all rows for this product.
    if (!err && productId) {
      await supabase.from('product_images').delete().eq('product_id', productId);
      if (form.images.length) {
        const rows = form.images.map((url, i) => ({ product_id: productId!, url, position: i }));
        const { error: imgErr } = await supabase.from('product_images').insert(rows);
        if (imgErr) err = imgErr;
      }
    }

    if (err) {
      setError('Erreur lors de la sauvegarde');
    } else {
      setShowForm(false);
      await loadProducts();
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await supabase.from('products').delete().eq('id', id);
    setDeleteId(null);
    await loadProducts();
  }

  async function uploadOne(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) {
      setError('Seules les images sont acceptées');
      return null;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Chaque image doit faire moins de 10 Mo");
      return null;
    }
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${user!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('products')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (upErr) throw upErr;
    return supabase.storage.from('products').getPublicUrl(path).data.publicUrl;
  }

  async function handleImageUpload(files: FileList) {
    if (!user) return;
    const room = MAX_IMAGES - form.images.length;
    if (room <= 0) {
      setError(`Maximum ${MAX_IMAGES} images par produit`);
      return;
    }
    const list = Array.from(files).slice(0, room);

    setUploading(true);
    setError('');
    try {
      for (const file of list) {
        const url = await uploadOne(file);
        if (url) setForm((f) => ({ ...f, images: [...f.images, url] }));
      }
    } catch (e) {
      const msg = (e as { message?: string })?.message || 'erreur inconnue';
      setError(`Échec de l'upload : ${msg}`);
    } finally {
      setUploading(false);
    }
  }

  function removeImage(index: number) {
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== index) }));
  }

  function makeCover(index: number) {
    setForm((f) => {
      if (index === 0) return f;
      const next = [...f.images];
      const [picked] = next.splice(index, 1);
      next.unshift(picked);
      return { ...f, images: next };
    });
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-ink leading-tight">Mes produits</h1>
          <p className="text-ink-muted text-sm mt-1.5">
            <span className="font-semibold text-ink">{products.length}</span> produit{products.length > 1 ? 's' : ''} dans votre catalogue
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 bg-ink hover:bg-brand-700 text-white text-sm font-semibold px-4 py-2.5 rounded-full transition-all shadow-soft hover:shadow-elevated"
        >
          <Plus className="w-4 h-4" /> Nouveau produit
        </button>
      </header>

      {/* Toolbar */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-soft p-3 sm:p-4 flex flex-col lg:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un produit..."
            className="w-full pl-11 pr-4 py-2.5 text-sm bg-surface-tint border border-transparent rounded-full text-ink placeholder-ink-subtle focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
          />
        </div>

        {/* Status pills */}
        <div className="flex items-center bg-surface-tint rounded-full p-1">
          {(['all','in','out'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
                filter === f ? 'bg-white text-ink shadow-soft' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {f === 'all' ? 'Tous' : f === 'in' ? 'En stock' : 'Rupture'}
            </button>
          ))}
        </div>

        {/* Category select */}
        {categories.length > 0 && (
          <div className="relative">
            <Filter className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none w-full pl-11 pr-10 py-2.5 text-sm bg-surface-tint border border-transparent rounded-full text-ink focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
            >
              <option value="">Toutes catégories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
          </div>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map((i) => (
            <div key={i} className="bg-white rounded-3xl p-4 border border-slate-100 flex gap-4">
              <div className="w-16 h-16 rounded-2xl animate-shimmer shrink-0" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-4 w-1/3 rounded-full animate-shimmer" />
                <div className="h-3 w-1/4 rounded-full animate-shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-16 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-brand-50 grid place-items-center mb-4">
            <Package className="w-7 h-7 text-brand-500" />
          </div>
          <h3 className="font-display text-lg font-bold text-ink">
            {products.length === 0 ? 'Aucun produit pour l\'instant' : 'Aucun résultat'}
          </h3>
          <p className="text-sm text-ink-muted mt-1.5">
            {products.length === 0
              ? 'Ajoutez votre premier produit pour commencer à vendre.'
              : 'Modifiez vos filtres pour voir d\'autres produits.'}
          </p>
          <button
            onClick={products.length === 0 ? openNew : () => { setSearch(''); setFilter('all'); setCategoryFilter(''); }}
            className="mt-5 inline-flex items-center gap-2 bg-ink text-white text-sm font-semibold px-5 py-2.5 rounded-full hover:bg-brand-700 transition-colors"
          >
            {products.length === 0 ? <><Plus className="w-4 h-4" /> Ajouter un produit</> : 'Réinitialiser'}
          </button>
        </div>
      ) : (
        <div className="space-y-3 stagger">
          {visible.map((p, i) => (
            <div
              key={p.id}
              style={{ animationDelay: `${Math.min(i * 30, 240)}ms` }}
              className="group bg-white rounded-3xl border border-slate-100 shadow-soft hover:shadow-card hover:border-brand-100 transition-all p-3 sm:p-4 flex items-center gap-3 sm:gap-4 animate-fade-in"
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-surface-tint shrink-0 ring-1 ring-slate-100">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center">
                    <Package className="w-6 h-6 text-slate-300" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-ink text-sm truncate">{p.name}</h3>
                  {p.category && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-ink-soft bg-surface-tint px-2 py-0.5 rounded-full">
                      <Tag className="w-2.5 h-2.5" /> {p.category}
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="text-xs text-ink-muted line-clamp-1 mt-0.5">{p.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-sm font-bold text-ink tabular-nums">
                    {Number(p.price).toLocaleString('fr-FR')} <span className="text-xs text-ink-muted font-semibold">FCFA</span>
                  </span>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${p.in_stock ? 'text-emerald-600' : 'text-rose-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.in_stock ? 'bg-emerald-500' : 'bg-rose-400'}`} />
                    {p.in_stock ? 'En stock' : 'Rupture'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => openEdit(p)}
                  className="w-10 h-10 grid place-items-center text-ink-muted hover:text-brand-700 hover:bg-brand-50 rounded-xl transition-colors"
                  aria-label="Modifier"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeleteId(p.id)}
                  className="w-10 h-10 grid place-items-center text-ink-muted hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                  aria-label="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} size="lg">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-extrabold text-ink">
                  {editing ? 'Modifier le produit' : 'Nouveau produit'}
                </h2>
                <p className="text-[11px] text-ink-muted mt-0.5">
                  {editing ? 'Mettez à jour les informations' : 'Ajoutez un produit à votre catalogue'}
                </p>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="w-9 h-9 grid place-items-center hover:bg-surface-tint rounded-xl transition-colors"
                aria-label="Fermer"
              >
                <X className="w-5 h-5 text-ink-muted" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-5">
              {error && (
                <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-600 text-sm px-4 py-3 rounded-2xl animate-pop">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <FormField label="Nom du produit" required>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: T-shirt en coton bio"
                  className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Prix (FCFA)" required>
                  <div className="relative">
                    <DollarSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={form.price}
                      onChange={(e) => setForm({ ...form, price: e.target.value })}
                      placeholder="0.00"
                      className="w-full pl-10 pr-3 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all tabular-nums"
                    />
                  </div>
                </FormField>
                <FormField label="Catégorie">
                  <div className="relative">
                    <select
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      className="appearance-none w-full pl-4 pr-10 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all"
                    >
                      <option value="">Choisir...</option>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
                  </div>
                </FormField>
              </div>

              <FormField label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Décrivez votre produit avec soin — matières, dimensions, points forts..."
                  rows={3}
                  className="w-full px-4 py-3 bg-surface-tint border border-transparent rounded-2xl text-sm focus:bg-white focus:border-brand-300 focus:ring-brand transition-all resize-none"
                />
              </FormField>

              {/* Sizes / pointures + per-size stock — only for clothing & shoes */}
              {needsSizes(form.category) && (
                <SizesEditor
                  category={form.category}
                  sizes={form.sizes}
                  stock={form.sizeStock}
                  onChange={(sizes, sizeStock) => setForm((f) => ({ ...f, sizes, sizeStock }))}
                />
              )}

              {/* Image gallery (multi) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
                    Photos du produit
                  </p>
                  <span className="text-[11px] text-ink-muted">{form.images.length}/{MAX_IMAGES}</span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {form.images.map((url, i) => (
                    <div
                      key={url}
                      className="relative aspect-square rounded-2xl overflow-hidden bg-surface-tint border border-slate-200 group"
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-ink/0 group-hover:bg-ink/30 transition-colors" />
                      {i === 0 ? (
                        <span className="absolute top-1.5 left-1.5 bg-ink text-white text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full">
                          Couverture
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => makeCover(i)}
                          className="absolute bottom-1.5 left-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-white/90 backdrop-blur-sm text-ink text-[10px] font-semibold py-1 rounded-full shadow-soft transition-opacity"
                        >
                          Définir couverture
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImage(i)}
                        className="absolute top-1.5 right-1.5 bg-white/90 backdrop-blur-sm text-rose-500 w-6 h-6 grid place-items-center rounded-full shadow-soft hover:bg-white transition-colors"
                        aria-label="Retirer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {form.images.length < MAX_IMAGES && (
                    <label
                      className={`relative flex flex-col items-center justify-center gap-1.5 aspect-square rounded-2xl border-2 border-dashed cursor-pointer transition-colors ${
                        uploading
                          ? 'border-brand-300 bg-brand-50/50'
                          : 'border-slate-200 bg-surface-tint hover:border-brand-300 hover:bg-brand-50/40'
                      }`}
                    >
                      {uploading ? (
                        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
                      ) : (
                        <>
                          <UploadCloud className="w-6 h-6 text-brand-500" />
                          <span className="text-[10px] font-semibold text-ink-muted text-center px-1">Ajouter</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={uploading}
                        className="hidden"
                        onChange={(e) => { if (e.target.files?.length) handleImageUpload(e.target.files); e.target.value = ''; }}
                      />
                    </label>
                  )}
                </div>
                <p className="text-[11px] text-ink-muted">
                  JPG, PNG, WebP — 10 Mo / image. La 1ʳᵉ image est la couverture.
                </p>
              </div>

              {/* Stock toggle */}
              <div className="flex items-center justify-between bg-surface-tint rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <span className={`w-9 h-9 rounded-xl grid place-items-center transition-colors ${form.in_stock ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500'}`}>
                    {form.in_stock ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">Disponible en stock</p>
                    <p className="text-[11px] text-ink-muted">Visible sur la marketplace</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, in_stock: !form.in_stock })}
                  className={`relative w-12 h-7 rounded-full transition-colors ${form.in_stock ? 'bg-ink' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full shadow-soft transition-transform ${form.in_stock ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Footer actions */}
              <div className="sticky bottom-0 -mx-6 -mb-6 px-6 py-4 bg-white/95 backdrop-blur-md border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-3 rounded-2xl text-sm font-semibold text-ink-soft bg-surface-tint hover:bg-slate-200 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving || uploading}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-semibold text-white bg-ink hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-soft"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? 'Enregistrer' : 'Publier'}
                </button>
              </div>
            </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} size="sm">
        <div className="p-6">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-100 text-rose-500 grid place-items-center">
            <Trash2 className="w-6 h-6" />
          </div>
          <h3 className="font-display text-lg font-bold text-ink text-center mt-4">Supprimer ce produit ?</h3>
          <p className="text-sm text-ink-muted text-center mt-1.5">Cette action est définitive et ne peut pas être annulée.</p>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setDeleteId(null)}
              className="flex-1 py-3 rounded-2xl text-sm font-semibold text-ink-soft bg-surface-tint hover:bg-slate-200 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={() => deleteId && handleDelete(deleteId)}
              className="flex-1 py-3 rounded-2xl text-sm font-semibold text-white bg-rose-500 hover:bg-rose-600 transition-colors"
            >
              Supprimer
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FormField({
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

function SizesEditor({
  category,
  sizes,
  stock,
  onChange,
}: {
  category: string;
  sizes: string[];
  stock: Record<string, number>;
  onChange: (sizes: string[], stock: Record<string, number>) => void;
}) {
  const [custom, setCustom] = useState('');
  const presets = SIZE_PRESETS[category] ?? [];
  const noun = sizeNoun(category); // "Tailles" | "Pointures"
  const totalUnits = sizes.reduce((sum, s) => sum + (stock[s] ?? 0), 0);

  function toggle(s: string) {
    if (sizes.includes(s)) {
      const nextStock = { ...stock };
      delete nextStock[s];
      onChange(sizes.filter((v) => v !== s), nextStock);
    } else {
      onChange([...sizes, s], { ...stock, [s]: stock[s] ?? 1 });
    }
  }

  function addCustom() {
    const s = custom.trim();
    if (s && !sizes.includes(s)) onChange([...sizes, s], { ...stock, [s]: 1 });
    setCustom('');
  }

  function setStock(s: string, n: number) {
    onChange(sizes, { ...stock, [s]: Math.max(0, n) });
  }

  return (
    <div className="space-y-3 bg-surface-tint rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
          {noun} &amp; stock
        </p>
        <span className="text-[11px] text-ink-muted">
          {sizes.length} {noun.toLowerCase()} · {totalUnits} unité{totalUnits > 1 ? 's' : ''}
        </span>
      </div>

      {/* Pick which sizes exist */}
      <div className="flex flex-wrap gap-2">
        {presets.map((s) => {
          const active = sizes.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                active
                  ? 'bg-ink text-white border-ink shadow-soft'
                  : 'bg-white text-ink-soft border-slate-200 hover:border-brand-300 hover:text-brand-700'
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Add a custom value (e.g. an unusual size / pointure) */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
          placeholder={category === 'Chaussures' ? 'Autre pointure (ex: 47)' : 'Autre taille (ex: 4XL)'}
          className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl text-sm focus:border-brand-300 focus:ring-brand transition-all"
        />
        <button
          type="button"
          onClick={addCustom}
          className="px-4 py-2.5 rounded-2xl text-sm font-semibold text-white bg-ink hover:bg-brand-700 transition-colors shrink-0"
        >
          Ajouter
        </button>
      </div>

      {/* Stock per selected size */}
      {sizes.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">
            Stock par {noun.toLowerCase().slice(0, -1)}
          </p>
          {sizes.map((s) => {
            const n = stock[s] ?? 0;
            return (
              <div
                key={s}
                className="flex items-center justify-between bg-white rounded-2xl px-3 py-2 border border-slate-100"
              >
                <span className="text-sm font-semibold text-ink min-w-[3rem]">{s}</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 bg-surface-tint rounded-full p-1">
                    <button
                      type="button"
                      onClick={() => setStock(s, n - 1)}
                      className="w-7 h-7 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink hover:border-brand-200 transition-all"
                    >
                      <span className="text-base leading-none">−</span>
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={n}
                      onChange={(e) => setStock(s, Math.floor(Number(e.target.value) || 0))}
                      className="w-12 text-center text-sm font-bold text-ink tabular-nums bg-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setStock(s, n + 1)}
                      className="w-7 h-7 grid place-items-center rounded-full bg-white border border-slate-100 text-ink-soft hover:text-ink hover:border-brand-200 transition-all"
                    >
                      <span className="text-base leading-none">+</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggle(s)}
                    className="w-8 h-8 grid place-items-center text-ink-muted hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                    aria-label="Retirer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-ink-muted">
        Le client choisit ses {noun.toLowerCase()} à la commande, sans dépasser le stock indiqué.
      </p>
    </div>
  );
}
