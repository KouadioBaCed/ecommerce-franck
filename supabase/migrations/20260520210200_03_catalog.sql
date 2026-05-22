/*
  # 03 — Catalog

  Adds the full catalog layer on top of the existing `products` table:
    - categories         (hierarchical, slugged, with icon for the UI)
    - tags               (flat, many-to-many with products)
    - product extensions (slug, sku, stock_quantity, status, featured, ratings,
                          compare_at_price, view/sales counts, search_vector, soft delete)
    - product_images     (multi-image gallery)
    - product_variants   (color/size/etc., with their own SKU + stock + price modifier)
    - product_tags       (junction)

  Search
    - GIN index on search_vector (weighted: name=A, description=B, category=C, sku=D)
    - GIN trigram index on name for fuzzy matching
    - `search_products(...)` RPC: combined full-text + filters + sort

  Backwards compatibility
    - Keeps the legacy `category` text column so the current frontend keeps working
      while `category_id` (FK to categories) is gradually populated.
*/

-- Categories -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  description  text NOT NULL DEFAULT '',
  icon         text NOT NULL DEFAULT '',          -- lucide icon name used by the frontend
  image_url    text NOT NULL DEFAULT '',
  position     integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categories_parent_idx ON public.categories(parent_id);
CREATE INDEX IF NOT EXISTS categories_active_idx ON public.categories(is_active, position);

DROP TRIGGER IF EXISTS categories_set_updated_at ON public.categories;
CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_public_read" ON public.categories;
CREATE POLICY "categories_public_read"
  ON public.categories FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "categories_admin_all" ON public.categories;
CREATE POLICY "categories_admin_all"
  ON public.categories FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Tags -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tags_public_read" ON public.tags;
CREATE POLICY "tags_public_read"
  ON public.tags FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "tags_admin_write" ON public.tags;
CREATE POLICY "tags_admin_write"
  ON public.tags FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "tags_admin_update" ON public.tags;
CREATE POLICY "tags_admin_update"
  ON public.tags FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "tags_admin_delete" ON public.tags;
CREATE POLICY "tags_admin_delete"
  ON public.tags FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- Product status enum --------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.product_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend products ------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS slug                text,
  ADD COLUMN IF NOT EXISTS sku                 text,
  ADD COLUMN IF NOT EXISTS compare_at_price    numeric(10, 2),
  ADD COLUMN IF NOT EXISTS cost_price          numeric(10, 2),
  ADD COLUMN IF NOT EXISTS stock_quantity      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS category_id         uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status              public.product_status NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS featured            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS view_count          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_count         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_avg          numeric(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight_grams        integer,
  ADD COLUMN IF NOT EXISTS meta_title          text,
  ADD COLUMN IF NOT EXISTS meta_description    text,
  ADD COLUMN IF NOT EXISTS deleted_at          timestamptz,
  ADD COLUMN IF NOT EXISTS search_vector       tsvector;

-- Validation constraints
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_price_positive,
  ADD  CONSTRAINT products_price_positive CHECK (price >= 0);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_stock_non_negative,
  ADD  CONSTRAINT products_stock_non_negative CHECK (stock_quantity >= 0);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_compare_gte_price,
  ADD  CONSTRAINT products_compare_gte_price CHECK (compare_at_price IS NULL OR compare_at_price >= price);

-- Unique slug per seller (avoid collisions across vendors; nicer URLs)
CREATE UNIQUE INDEX IF NOT EXISTS products_seller_slug_uq
  ON public.products(seller_id, slug)
  WHERE slug IS NOT NULL AND deleted_at IS NULL;

-- Hot-path indexes
CREATE INDEX IF NOT EXISTS products_category_id_idx
  ON public.products(category_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_status_idx
  ON public.products(status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_featured_idx
  ON public.products(featured) WHERE featured AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_sponsored_idx
  ON public.products(sponsored) WHERE sponsored AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_created_at_desc_idx
  ON public.products(created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_rating_idx
  ON public.products(rating_avg DESC, rating_count DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_price_idx
  ON public.products(price) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_seller_status_idx
  ON public.products(seller_id, status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_search_vector_idx
  ON public.products USING gin(search_vector);

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON public.products USING gin(name gin_trgm_ops);

-- Search vector + auto slug trigger ------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_products_search_and_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Recompute weighted search vector
  NEW.search_vector :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))),         'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.description, ''))),  'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.category, ''))),     'C') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.sku, ''))),          'D');

  -- Auto-fill slug from name when missing or whitespace-only
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    NEW.slug := public.slugify(NEW.name);
  ELSE
    NEW.slug := public.slugify(NEW.slug);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_search_and_slug ON public.products;
CREATE TRIGGER products_search_and_slug
  BEFORE INSERT OR UPDATE OF name, description, category, sku, slug
  ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_search_and_slug();

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Backfill search vectors for pre-existing rows
UPDATE public.products SET name = name WHERE search_vector IS NULL;

-- Refine products RLS --------------------------------------------------------
DROP POLICY IF EXISTS "Public can read in-stock products"  ON public.products;
DROP POLICY IF EXISTS "Sellers can read all their products" ON public.products;
DROP POLICY IF EXISTS "Sellers can insert their products"   ON public.products;
DROP POLICY IF EXISTS "Sellers can update their products"   ON public.products;
DROP POLICY IF EXISTS "Sellers can delete their products"   ON public.products;

DROP POLICY IF EXISTS "products_public_read" ON public.products;
CREATE POLICY "products_public_read"
  ON public.products FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND status = 'published'
  );

DROP POLICY IF EXISTS "products_owner_read" ON public.products;
CREATE POLICY "products_owner_read"
  ON public.products FOR SELECT
  TO authenticated
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "products_owner_insert" ON public.products;
CREATE POLICY "products_owner_insert"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (
    seller_id = auth.uid()
    AND public.is_vendor()
  );

DROP POLICY IF EXISTS "products_owner_update" ON public.products;
CREATE POLICY "products_owner_update"
  ON public.products FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS "products_owner_delete" ON public.products;
CREATE POLICY "products_owner_delete"
  ON public.products FOR DELETE
  TO authenticated
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "products_admin_all" ON public.products;
CREATE POLICY "products_admin_all"
  ON public.products FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Product images -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt_text    text NOT NULL DEFAULT '',
  position    smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_images_product_idx
  ON public.product_images(product_id, position);

ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_images_public_read" ON public.product_images;
CREATE POLICY "product_images_public_read"
  ON public.product_images FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id
      AND p.status = 'published'
      AND p.deleted_at IS NULL
  ));

DROP POLICY IF EXISTS "product_images_owner_all" ON public.product_images;
CREATE POLICY "product_images_owner_all"
  ON public.product_images FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ));

DROP POLICY IF EXISTS "product_images_admin_all" ON public.product_images;
CREATE POLICY "product_images_admin_all"
  ON public.product_images FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Product variants -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku             text,
  name            text NOT NULL,
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,    -- e.g. {"color":"red","size":"M"}
  price_modifier  numeric(10, 2) NOT NULL DEFAULT 0,
  stock_quantity  integer NOT NULL DEFAULT 0,
  image_url       text NOT NULL DEFAULT '',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_variants_stock_non_negative CHECK (stock_quantity >= 0)
);

CREATE INDEX IF NOT EXISTS product_variants_product_idx ON public.product_variants(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_variants_sku_uq
  ON public.product_variants(sku) WHERE sku IS NOT NULL;

DROP TRIGGER IF EXISTS product_variants_set_updated_at ON public.product_variants;
CREATE TRIGGER product_variants_set_updated_at
  BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_variants_public_read" ON public.product_variants;
CREATE POLICY "product_variants_public_read"
  ON public.product_variants FOR SELECT
  TO anon, authenticated
  USING (
    is_active
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_id
        AND p.status = 'published'
        AND p.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "product_variants_owner_all" ON public.product_variants;
CREATE POLICY "product_variants_owner_all"
  ON public.product_variants FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ));

DROP POLICY IF EXISTS "product_variants_admin_all" ON public.product_variants;
CREATE POLICY "product_variants_admin_all"
  ON public.product_variants FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Product <-> Tags (junction) -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_tags (
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  tag_id     uuid NOT NULL REFERENCES public.tags(id)     ON DELETE CASCADE,
  PRIMARY KEY (product_id, tag_id)
);

CREATE INDEX IF NOT EXISTS product_tags_tag_idx ON public.product_tags(tag_id);

ALTER TABLE public.product_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_tags_public_read" ON public.product_tags;
CREATE POLICY "product_tags_public_read"
  ON public.product_tags FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "product_tags_owner_write" ON public.product_tags;
CREATE POLICY "product_tags_owner_write"
  ON public.product_tags FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ));

-- Increment product view counter ---------------------------------------------
-- SECURITY DEFINER so anon visitors can bump it without UPDATE on products.
CREATE OR REPLACE FUNCTION public.increment_product_view(p_product_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.products
  SET view_count = view_count + 1
  WHERE id = p_product_id
    AND status = 'published'
    AND deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.increment_product_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_product_view(uuid) TO anon, authenticated;

-- Search RPC (paginated, sortable, filterable) -------------------------------
CREATE OR REPLACE FUNCTION public.search_products(
  p_query       text       DEFAULT NULL,
  p_category_id uuid       DEFAULT NULL,
  p_seller_id   uuid       DEFAULT NULL,
  p_min_price   numeric    DEFAULT NULL,
  p_max_price   numeric    DEFAULT NULL,
  p_in_stock    boolean    DEFAULT NULL,
  p_featured    boolean    DEFAULT NULL,
  p_sort        text       DEFAULT 'relevance',  -- relevance|newest|price_asc|price_desc|rating|popular
  p_limit       integer    DEFAULT 24,
  p_offset      integer    DEFAULT 0
) RETURNS TABLE (
  id              uuid,
  seller_id       uuid,
  name            text,
  slug            text,
  description     text,
  price           numeric,
  compare_at_price numeric,
  image_url       text,
  category        text,
  category_id     uuid,
  rating_avg      numeric,
  rating_count    integer,
  sales_count     integer,
  view_count      integer,
  in_stock        boolean,
  stock_quantity  integer,
  featured        boolean,
  created_at      timestamptz,
  total_count     bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      p.*,
      CASE
        WHEN p_query IS NOT NULL AND p_query <> ''
          THEN ts_rank(p.search_vector, plainto_tsquery('simple', unaccent(p_query)))
        ELSE 0
      END AS rank
    FROM public.products p
    WHERE p.deleted_at IS NULL
      AND p.status = 'published'
      AND (
        p_query IS NULL OR p_query = ''
        OR p.search_vector @@ plainto_tsquery('simple', unaccent(p_query))
        OR p.name ILIKE '%' || p_query || '%'
      )
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
      AND (p_seller_id   IS NULL OR p.seller_id   = p_seller_id)
      AND (p_min_price   IS NULL OR p.price       >= p_min_price)
      AND (p_max_price   IS NULL OR p.price       <= p_max_price)
      AND (p_in_stock    IS NULL OR p.in_stock     = p_in_stock)
      AND (p_featured    IS NULL OR p.featured     = p_featured)
  ),
  counted AS (SELECT count(*) AS n FROM base)
  SELECT
    b.id, b.seller_id, b.name, b.slug, b.description, b.price, b.compare_at_price,
    b.image_url, b.category, b.category_id,
    b.rating_avg, b.rating_count, b.sales_count, b.view_count,
    b.in_stock, b.stock_quantity, b.featured, b.created_at,
    c.n AS total_count
  FROM base b, counted c
  ORDER BY
    CASE WHEN p_sort = 'relevance'  THEN b.rank        END DESC NULLS LAST,
    CASE WHEN p_sort = 'newest'     THEN b.created_at  END DESC NULLS LAST,
    CASE WHEN p_sort = 'price_asc'  THEN b.price       END ASC  NULLS LAST,
    CASE WHEN p_sort = 'price_desc' THEN b.price       END DESC NULLS LAST,
    CASE WHEN p_sort = 'rating'     THEN b.rating_avg  END DESC NULLS LAST,
    CASE WHEN p_sort = 'popular'    THEN b.sales_count END DESC NULLS LAST,
    b.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;

REVOKE ALL ON FUNCTION public.search_products(text, uuid, uuid, numeric, numeric, boolean, boolean, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products(text, uuid, uuid, numeric, numeric, boolean, boolean, text, integer, integer) TO anon, authenticated;
