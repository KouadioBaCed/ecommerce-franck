/*
  # 07 — Seed default categories

  Inserts the 9 categories used by the frontend (CATEGORY_VISUALS map).
  `icon` matches lucide-react icon names. Re-running is safe (ON CONFLICT).
*/

INSERT INTO public.categories (name, slug, icon, position) VALUES
  ('Vêtements',    'vetements',     'shirt',            1),
  ('Électronique', 'electronique',  'smartphone',       2),
  ('Alimentation', 'alimentation',  'utensils-crossed', 3),
  ('Beauté',       'beaute',        'sparkle',          4),
  ('Sport',        'sport',         'dumbbell',         5),
  ('Maison',       'maison',        'home',             6),
  ('Jouets',       'jouets',        'gamepad-2',        7),
  ('Livres',       'livres',        'book-open',        8),
  ('Autre',        'autre',         'tag',              9)
ON CONFLICT (slug) DO UPDATE
  SET name     = EXCLUDED.name,
      icon     = EXCLUDED.icon,
      position = EXCLUDED.position;

-- Backfill products.category_id from the legacy products.category text column.
-- Safe to re-run: only sets category_id when it's NULL and a matching category exists.
UPDATE public.products p
SET category_id = c.id
FROM public.categories c
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND p.category <> ''
  AND c.name = p.category;
