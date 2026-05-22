-- ============================================================
-- RUN_ALL_MIGRATIONS — migrations 01 → 07 (idempotentes, rejouables)
-- À coller en UNE fois dans le SQL Editor de Supabase, puis Run.
-- ============================================================

-- ▶ 20260520210000_01_extensions_and_helpers.sql
/*
  # 01 — Extensions & shared helpers

  Extensions
    - pgcrypto   : gen_random_uuid(), gen_random_bytes()
    - pg_trgm    : trigram indexes for fuzzy product search
    - unaccent   : diacritic-insensitive normalization for slugs and FTS

  Helper functions (used by every migration after this one)
    - tg_set_updated_at()         BEFORE UPDATE trigger to refresh updated_at
    - slugify(text)               kebab-case, accent-stripped, alphanum + dashes
    - generate_unique_slug(...)   suffixes -2, -3 ... until unique on a (table, column)

  Idempotent: safe to re-run.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- updated_at maintenance ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Slug generation -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slugify(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(
        unaccent(coalesce(input, '')),
        '[^a-zA-Z0-9]+', '-', 'g'
      ),
      '(^-|-$)', '', 'g'
    )
  );
$$;

-- Returns a slug guaranteed unique against (p_table, p_column).
-- Falls back to a random hex when input is empty.
CREATE OR REPLACE FUNCTION public.generate_unique_slug(
  p_table  text,
  p_column text,
  p_base   text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug      text := public.slugify(p_base);
  v_candidate text;
  v_exists    boolean;
  v_n         int := 1;
BEGIN
  IF v_slug IS NULL OR v_slug = '' THEN
    v_slug := encode(gen_random_bytes(4), 'hex');
  END IF;

  v_candidate := v_slug;

  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1)', p_table, p_column)
      INTO v_exists
      USING v_candidate;

    EXIT WHEN NOT v_exists;

    v_n := v_n + 1;
    v_candidate := v_slug || '-' || v_n;
  END LOOP;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_unique_slug(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_unique_slug(text, text, text) TO authenticated;


-- ▶ 20260520210100_02_users_and_roles.sql
/*
  # 02 — Users, roles, vendor verification, addresses

  Strategy
    `profiles` is *one row per auth user* (existing table). It carries:
      - shared identity: full_name, phone, avatar_url, email (denormalized)
      - the discriminating `role` (customer | vendor | admin)
      - vendor-only fields (store_name, store_slug, verification_status, ...)

    This avoids splitting customer vs vendor into two tables — every signup
    starts as `customer` and may upgrade to `vendor` after KYC.

  Security
    - `is_admin()` / `is_vendor()` are SECURITY DEFINER so policies can call them
      without recursing into profiles RLS.
    - A guard trigger blocks self-promotion: clients cannot change their own
      role unless admin, and verification approval requires admin.

  New tables
    - addresses : multi shipping address per user, with a single default per user
*/

-- Enums ----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('customer', 'vendor', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('unverified', 'pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend profiles ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role public.user_role NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS verification_status public.verification_status NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rating_avg numeric(3, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Lookup indexes
CREATE INDEX IF NOT EXISTS profiles_role_idx
  ON public.profiles(role) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_verification_idx
  ON public.profiles(verification_status) WHERE role = 'vendor';

CREATE INDEX IF NOT EXISTS profiles_email_idx
  ON public.profiles(lower(email));

-- updated_at trigger ---------------------------------------------------------
DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create a profile on signup (extends the existing function to copy email + role)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Profile is the critical row; it must always be created.
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'customer')
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email
    WHERE public.profiles.email IS DISTINCT FROM EXCLUDED.email;

  -- Default notification preferences are best-effort. Isolate in a sub-block so
  -- a failure here (e.g. table not yet created during the first migration run)
  -- never rolls back the profile insert above.
  BEGIN
    INSERT INTO public.notification_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  RETURN NEW;
END;
$$;

-- Role helpers (SECURITY DEFINER → bypass RLS) -------------------------------
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid
      AND role = 'admin'
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_vendor(uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid
      AND role IN ('vendor', 'admin')
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_vendor(uuid)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_role()       FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid)         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_vendor(uuid)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role()    TO authenticated;

-- Refine profiles RLS --------------------------------------------------------
DROP POLICY IF EXISTS "Public can read profiles"     ON public.profiles;
DROP POLICY IF EXISTS "Owners can update their profile" ON public.profiles;
DROP POLICY IF EXISTS "Owners can insert their profile" ON public.profiles;

DROP POLICY IF EXISTS "profiles_public_read" ON public.profiles;
CREATE POLICY "profiles_public_read"
  ON public.profiles FOR SELECT
  TO anon, authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
CREATE POLICY "profiles_self_update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_self_insert" ON public.profiles;
CREATE POLICY "profiles_self_insert"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all"
  ON public.profiles FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Guard trigger: prevent self-escalation to vendor/admin and self-approval of KYC
CREATE OR REPLACE FUNCTION public.tg_profiles_guard_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_acting uuid := auth.uid();
BEGIN
  -- Trusted server-side contexts (service_role, SQL editor, superuser, DB
  -- migrations) carry no JWT, so auth.uid() is NULL. End-user requests always
  -- carry a JWT. We trust the no-JWT path — it's how the first admin is
  -- bootstrapped and how approve_vendor()/Edge Functions operate. Regular users
  -- remain fully guarded, and RLS still prevents them from touching other rows.
  IF v_acting IS NULL OR public.is_admin(v_acting) THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'role change forbidden — use the verification flow'
      USING errcode = '42501';
  END IF;

  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NEW.verification_status IN ('approved', 'rejected')
  THEN
    RAISE EXCEPTION 'verification approval requires admin'
      USING errcode = '42501';
  END IF;

  -- Soft delete only by admin (or via SECURITY DEFINER function)
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'soft delete requires admin'
      USING errcode = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_role ON public.profiles;
CREATE TRIGGER profiles_guard_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_guard_role();

-- Vendor application RPC ------------------------------------------------------
-- A customer calls this to request becoming a vendor. We set
-- verification_status = 'pending' and store the documents. Approval is admin-only.
CREATE OR REPLACE FUNCTION public.apply_for_vendor(p_documents jsonb DEFAULT '[]'::jsonb)
RETURNS public.verification_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status public.verification_status;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  UPDATE public.profiles
  SET verification_status = 'pending',
      verification_submitted_at = now(),
      verification_documents = COALESCE(p_documents, '[]'::jsonb)
  WHERE id = v_user
    AND role = 'customer'
    AND verification_status IN ('unverified', 'rejected')
  RETURNING verification_status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'vendor application not allowed for current state';
  END IF;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_for_vendor(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_for_vendor(jsonb) TO authenticated;

-- Admin approves a vendor (promotes to role='vendor') -------------------------
CREATE OR REPLACE FUNCTION public.approve_vendor(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  UPDATE public.profiles
  SET role = 'vendor',
      verification_status = 'approved',
      verified_at = now()
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_vendor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_vendor(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_vendor(p_user_id uuid, p_reason text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  UPDATE public.profiles
  SET verification_status = 'rejected',
      verification_documents = verification_documents || jsonb_build_object('rejection_reason', p_reason, 'rejected_at', now())
  WHERE id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_vendor(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_vendor(uuid, text) TO authenticated;

-- Addresses ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.addresses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label        text NOT NULL DEFAULT '',
  full_name    text NOT NULL,
  phone        text NOT NULL,
  line1        text NOT NULL,
  line2        text NOT NULL DEFAULT '',
  city         text NOT NULL,
  region       text NOT NULL DEFAULT '',
  postal_code  text NOT NULL DEFAULT '',
  country      text NOT NULL DEFAULT 'MA',
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS addresses_user_idx ON public.addresses(user_id);

-- At most one default per user (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_user
  ON public.addresses(user_id) WHERE is_default;

DROP TRIGGER IF EXISTS addresses_set_updated_at ON public.addresses;
CREATE TRIGGER addresses_set_updated_at
  BEFORE UPDATE ON public.addresses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "addresses_owner_all" ON public.addresses;
CREATE POLICY "addresses_owner_all"
  ON public.addresses FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "addresses_admin_read" ON public.addresses;
CREATE POLICY "addresses_admin_read"
  ON public.addresses FOR SELECT
  TO authenticated
  USING (public.is_admin());


-- ▶ 20260520210200_03_catalog.sql
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


-- ▶ 20260520210300_04_commerce.sql
/*
  # 04 — Commerce (cart, orders, payments)

  Tables
    - carts                  one cart per user
    - cart_items             products waiting to be ordered
    - orders                 buyer-side order document with money snapshot
    - order_items            line items, each carrying its seller_id (multi-vendor split)
    - order_status_history   immutable audit trail of status transitions
    - payments               one or more payment attempts per order

  Design
    - Order totals are stored, not derived: prices change but past orders should not.
    - Each order_item knows its seller_id → a vendor only sees orders that contain
      at least one of their items, via RLS subqueries.
    - The `place_order` RPC is the single transactional path from cart → order:
      it snapshots prices, decrements stock, creates a pending payment, clears the cart.
    - Payment writes are restricted to admin/service-role to prevent client spoofing.
*/

-- Enums -----------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM (
    'pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM (
    'pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_provider AS ENUM (
    'whatsapp_manual', 'stripe', 'paypal', 'mobile_money', 'cash_on_delivery'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cart ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS carts_set_updated_at ON public.carts;
CREATE TRIGGER carts_set_updated_at
  BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carts_owner_all" ON public.carts;
CREATE POLICY "carts_owner_all"
  ON public.carts FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "carts_admin_all" ON public.carts;
CREATE POLICY "carts_admin_all"
  ON public.carts FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Cart items ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id     uuid NOT NULL REFERENCES public.carts(id)            ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id)         ON DELETE CASCADE,
  variant_id  uuid          REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity    integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  added_at    timestamptz NOT NULL DEFAULT now()
);

-- Same product+variant cannot appear twice in the same cart; UPSERT to merge qty.
CREATE UNIQUE INDEX IF NOT EXISTS cart_items_unique_line
  ON public.cart_items(cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS cart_items_cart_idx    ON public.cart_items(cart_id);
CREATE INDEX IF NOT EXISTS cart_items_product_idx ON public.cart_items(product_id);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cart_items_owner_all" ON public.cart_items;
CREATE POLICY "cart_items_owner_all"
  ON public.cart_items FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.carts c
    WHERE c.id = cart_id AND c.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.carts c
    WHERE c.id = cart_id AND c.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "cart_items_admin_all" ON public.cart_items;
CREATE POLICY "cart_items_admin_all"
  ON public.cart_items FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Convenience RPC: add (or merge) a product into the current user's cart -----
CREATE OR REPLACE FUNCTION public.cart_add_item(
  p_product_id uuid,
  p_variant_id uuid    DEFAULT NULL,
  p_quantity   integer DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_cart_id uuid;
  v_item_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1';
  END IF;

  -- Ensure a cart exists
  INSERT INTO public.carts (user_id) VALUES (v_user)
  ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_cart_id;

  -- Upsert the line (merge quantities)
  INSERT INTO public.cart_items (cart_id, product_id, variant_id, quantity)
  VALUES (v_cart_id, p_product_id, p_variant_id, p_quantity)
  ON CONFLICT (cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET quantity = public.cart_items.quantity + EXCLUDED.quantity
  RETURNING id INTO v_item_id;

  RETURN v_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cart_add_item(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cart_add_item(uuid, uuid, integer) TO authenticated;

-- Orders ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number      text NOT NULL UNIQUE,
  buyer_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  buyer_email       text,
  buyer_phone       text,
  status            public.order_status   NOT NULL DEFAULT 'pending',
  payment_status    public.payment_status NOT NULL DEFAULT 'pending',

  subtotal_amount   numeric(12, 2) NOT NULL DEFAULT 0,
  shipping_amount   numeric(12, 2) NOT NULL DEFAULT 0,
  discount_amount   numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount        numeric(12, 2) NOT NULL DEFAULT 0,
  total_amount      numeric(12, 2) NOT NULL DEFAULT 0,
  currency          text NOT NULL DEFAULT 'MAD',

  shipping_address  jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_address   jsonb,

  notes             text NOT NULL DEFAULT '',
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,

  placed_at         timestamptz NOT NULL DEFAULT now(),
  confirmed_at      timestamptz,
  shipped_at        timestamptz,
  delivered_at      timestamptz,
  cancelled_at      timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_amounts_non_negative CHECK (
    subtotal_amount >= 0 AND shipping_amount >= 0 AND discount_amount >= 0
    AND tax_amount >= 0 AND total_amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS orders_buyer_idx     ON public.orders(buyer_id);
CREATE INDEX IF NOT EXISTS orders_status_idx    ON public.orders(status);
CREATE INDEX IF NOT EXISTS orders_payment_status_idx ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS orders_placed_at_idx ON public.orders(placed_at DESC);

DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-generate order_number on insert: ORD-YYYYMM-XXXXXX
CREATE OR REPLACE FUNCTION public.tg_orders_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := 'ORD-' || to_char(now(), 'YYYYMM') || '-' ||
      upper(substring(encode(gen_random_bytes(4), 'hex') from 1 for 6));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_number ON public.orders;
CREATE TRIGGER orders_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_orders_number();

-- Order items -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id)             ON DELETE CASCADE,
  product_id          uuid          REFERENCES public.products(id)           ON DELETE SET NULL,
  variant_id          uuid          REFERENCES public.product_variants(id)  ON DELETE SET NULL,
  seller_id           uuid NOT NULL REFERENCES public.profiles(id)           ON DELETE RESTRICT,

  -- Snapshot of product data at order time (immutable)
  product_name        text NOT NULL,
  product_image_url   text NOT NULL DEFAULT '',
  variant_name        text,
  sku                 text,

  unit_price          numeric(10, 2) NOT NULL CHECK (unit_price >= 0),
  quantity            integer NOT NULL CHECK (quantity > 0),
  line_total          numeric(12, 2) NOT NULL,

  status              public.order_status NOT NULL DEFAULT 'pending',
  shipped_at          timestamptz,
  delivered_at        timestamptz,
  tracking_number     text,
  tracking_url        text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_order_idx        ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_seller_idx       ON public.order_items(seller_id);
CREATE INDEX IF NOT EXISTS order_items_seller_status_idx ON public.order_items(seller_id, status);
CREATE INDEX IF NOT EXISTS order_items_product_idx      ON public.order_items(product_id);
CREATE INDEX IF NOT EXISTS order_items_created_at_idx   ON public.order_items(created_at DESC);

DROP TRIGGER IF EXISTS order_items_set_updated_at ON public.order_items;
CREATE TRIGGER order_items_set_updated_at
  BEFORE UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-compute line_total
CREATE OR REPLACE FUNCTION public.tg_order_items_compute()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.line_total := NEW.unit_price * NEW.quantity;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_compute ON public.order_items;
CREATE TRIGGER order_items_compute
  BEFORE INSERT OR UPDATE OF unit_price, quantity
  ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_order_items_compute();

-- Order status history --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status  public.order_status,
  to_status    public.order_status NOT NULL,
  changed_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_status_history_order_idx
  ON public.order_status_history(order_id, created_at);

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

-- Stamp confirmed_at/shipped_at/... on status transition (BEFORE)
CREATE OR REPLACE FUNCTION public.tg_orders_status_stamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN NEW.confirmed_at := now(); END IF;
    IF NEW.status = 'shipped'   AND NEW.shipped_at   IS NULL THEN NEW.shipped_at   := now(); END IF;
    IF NEW.status = 'delivered' AND NEW.delivered_at IS NULL THEN NEW.delivered_at := now(); END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_status_stamps ON public.orders;
CREATE TRIGGER orders_status_stamps
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_orders_status_stamps();

-- Insert into history AFTER the order is committed
CREATE OR REPLACE FUNCTION public.tg_orders_status_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by)
    VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_status_history ON public.orders;
CREATE TRIGGER orders_status_history
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_orders_status_history();

-- Bump seller and product sales counters on delivered status -----------------
CREATE OR REPLACE FUNCTION public.tg_order_items_sales_rollup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
    -- Product sales_count
    IF NEW.product_id IS NOT NULL THEN
      UPDATE public.products
      SET sales_count = sales_count + NEW.quantity
      WHERE id = NEW.product_id;
    END IF;
    -- Seller sales_count
    UPDATE public.profiles
    SET sales_count = sales_count + NEW.quantity
    WHERE id = NEW.seller_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_items_sales_rollup ON public.order_items;
CREATE TRIGGER order_items_sales_rollup
  AFTER UPDATE OF status ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_order_items_sales_rollup();

-- Payments --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider            public.payment_provider NOT NULL,
  provider_payment_id text,
  amount              numeric(12, 2) NOT NULL CHECK (amount >= 0),
  currency            text NOT NULL DEFAULT 'MAD',
  status              public.payment_status NOT NULL DEFAULT 'pending',
  paid_at             timestamptz,
  refunded_at         timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_order_idx               ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS payments_provider_payment_id_idx ON public.payments(provider_payment_id);
CREATE INDEX IF NOT EXISTS payments_status_idx              ON public.payments(status);

DROP TRIGGER IF EXISTS payments_set_updated_at ON public.payments;
CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Cross-table access helpers --------------------------------------------------
-- IMPORTANT: orders and order_items reference each other in their RLS policies.
-- If those subqueries ran with RLS enabled they would recurse
-- (orders policy → order_items → orders → ...). These SECURITY DEFINER helpers
-- bypass RLS, breaking the cycle. This is the canonical Supabase pattern.
CREATE OR REPLACE FUNCTION public.is_order_buyer(p_order_id uuid, uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = p_order_id AND buyer_id = uid
  );
$$;

CREATE OR REPLACE FUNCTION public.is_order_seller(p_order_id uuid, uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = p_order_id AND seller_id = uid
  );
$$;

REVOKE ALL ON FUNCTION public.is_order_buyer(uuid, uuid)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_order_seller(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_order_buyer(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_order_seller(uuid, uuid) TO authenticated;

-- RLS: orders / items / history / payments -----------------------------------
ALTER TABLE public.orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments   ENABLE ROW LEVEL SECURITY;

-- Orders
DROP POLICY IF EXISTS "orders_buyer_read" ON public.orders;
CREATE POLICY "orders_buyer_read"
  ON public.orders FOR SELECT
  TO authenticated
  USING (buyer_id = auth.uid());

DROP POLICY IF EXISTS "orders_seller_read" ON public.orders;
CREATE POLICY "orders_seller_read"
  ON public.orders FOR SELECT
  TO authenticated
  USING (public.is_order_seller(id));

DROP POLICY IF EXISTS "orders_buyer_create" ON public.orders;
CREATE POLICY "orders_buyer_create"
  ON public.orders FOR INSERT
  TO authenticated
  WITH CHECK (buyer_id = auth.uid());

-- Buyer can cancel while still pending/confirmed
DROP POLICY IF EXISTS "orders_buyer_cancel" ON public.orders;
CREATE POLICY "orders_buyer_cancel"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (buyer_id = auth.uid() AND status IN ('pending', 'confirmed'))
  WITH CHECK (buyer_id = auth.uid() AND status IN ('pending', 'confirmed', 'cancelled'));

-- Seller can progress status (confirm → processing → shipped → delivered)
DROP POLICY IF EXISTS "orders_seller_update" ON public.orders;
CREATE POLICY "orders_seller_update"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (public.is_order_seller(id))
  WITH CHECK (public.is_order_seller(id));

DROP POLICY IF EXISTS "orders_admin_all" ON public.orders;
CREATE POLICY "orders_admin_all"
  ON public.orders FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Order items
DROP POLICY IF EXISTS "order_items_buyer_read" ON public.order_items;
CREATE POLICY "order_items_buyer_read"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (public.is_order_buyer(order_id));

DROP POLICY IF EXISTS "order_items_seller_read" ON public.order_items;
CREATE POLICY "order_items_seller_read"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "order_items_seller_update" ON public.order_items;
CREATE POLICY "order_items_seller_update"
  ON public.order_items FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- Insert is normally done by the place_order RPC; allowed via owner-cart relationship.
DROP POLICY IF EXISTS "order_items_buyer_insert" ON public.order_items;
CREATE POLICY "order_items_buyer_insert"
  ON public.order_items FOR INSERT
  TO authenticated
  WITH CHECK (public.is_order_buyer(order_id));

DROP POLICY IF EXISTS "order_items_admin_all" ON public.order_items;
CREATE POLICY "order_items_admin_all"
  ON public.order_items FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Status history
DROP POLICY IF EXISTS "order_status_history_buyer_read" ON public.order_status_history;
CREATE POLICY "order_status_history_buyer_read"
  ON public.order_status_history FOR SELECT
  TO authenticated
  USING (public.is_order_buyer(order_id));

DROP POLICY IF EXISTS "order_status_history_seller_read" ON public.order_status_history;
CREATE POLICY "order_status_history_seller_read"
  ON public.order_status_history FOR SELECT
  TO authenticated
  USING (public.is_order_seller(order_id));

DROP POLICY IF EXISTS "order_status_history_admin_all" ON public.order_status_history;
CREATE POLICY "order_status_history_admin_all"
  ON public.order_status_history FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Payments — read by buyer/seller of the order; writes only by admin
-- (real-world: writes come from server-side webhooks using the service role key).
DROP POLICY IF EXISTS "payments_buyer_read" ON public.payments;
CREATE POLICY "payments_buyer_read"
  ON public.payments FOR SELECT
  TO authenticated
  USING (public.is_order_buyer(order_id));

DROP POLICY IF EXISTS "payments_seller_read" ON public.payments;
CREATE POLICY "payments_seller_read"
  ON public.payments FOR SELECT
  TO authenticated
  USING (public.is_order_seller(order_id));

DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
CREATE POLICY "payments_admin_all"
  ON public.payments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Checkout RPC — single transaction: cart → order ----------------------------
CREATE OR REPLACE FUNCTION public.place_order(
  p_shipping_address jsonb,
  p_billing_address  jsonb                  DEFAULT NULL,
  p_notes            text                   DEFAULT '',
  p_payment_provider public.payment_provider DEFAULT 'whatsapp_manual'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_cart_id   uuid;
  v_order_id  uuid;
  v_subtotal  numeric(12, 2) := 0;
  v_item      record;
  v_line_price numeric(10, 2);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF p_shipping_address IS NULL OR p_shipping_address = '{}'::jsonb THEN
    RAISE EXCEPTION 'shipping address required';
  END IF;

  SELECT id INTO v_cart_id FROM public.carts WHERE user_id = v_user;
  IF v_cart_id IS NULL THEN
    RAISE EXCEPTION 'cart not found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.cart_items WHERE cart_id = v_cart_id) THEN
    RAISE EXCEPTION 'cart is empty';
  END IF;

  -- Create the order shell
  INSERT INTO public.orders (buyer_id, shipping_address, billing_address, notes)
  VALUES (v_user, p_shipping_address, p_billing_address, COALESCE(p_notes, ''))
  RETURNING id INTO v_order_id;

  -- Snapshot each cart line into an order item
  FOR v_item IN
    SELECT
      ci.quantity,
      p.id          AS product_id,
      p.seller_id,
      p.name        AS product_name,
      p.image_url   AS product_image_url,
      p.price,
      p.in_stock,
      p.stock_quantity,
      p.status,
      p.deleted_at,
      v.id          AS variant_id,
      v.name        AS variant_name,
      v.sku         AS variant_sku,
      v.price_modifier,
      v.stock_quantity AS variant_stock,
      v.is_active  AS variant_active
    FROM public.cart_items ci
    JOIN public.products p ON p.id = ci.product_id
    LEFT JOIN public.product_variants v ON v.id = ci.variant_id
    WHERE ci.cart_id = v_cart_id
    FOR UPDATE OF p
  LOOP
    -- Validate product
    IF v_item.deleted_at IS NOT NULL OR v_item.status <> 'published' THEN
      RAISE EXCEPTION 'product % no longer available', v_item.product_id;
    END IF;

    -- Stock check
    IF v_item.variant_id IS NOT NULL THEN
      IF NOT v_item.variant_active OR v_item.variant_stock < v_item.quantity THEN
        RAISE EXCEPTION 'insufficient stock for variant %', v_item.variant_id;
      END IF;
    ELSE
      IF NOT v_item.in_stock
         OR (v_item.stock_quantity > 0 AND v_item.stock_quantity < v_item.quantity)
      THEN
        RAISE EXCEPTION 'insufficient stock for product %', v_item.product_id;
      END IF;
    END IF;

    v_line_price := v_item.price + COALESCE(v_item.price_modifier, 0);

    INSERT INTO public.order_items (
      order_id, product_id, variant_id, seller_id,
      product_name, product_image_url, variant_name, sku,
      unit_price, quantity
    ) VALUES (
      v_order_id, v_item.product_id, v_item.variant_id, v_item.seller_id,
      v_item.product_name, v_item.product_image_url, v_item.variant_name, v_item.variant_sku,
      v_line_price, v_item.quantity
    );

    v_subtotal := v_subtotal + (v_line_price * v_item.quantity);

    -- Decrement stock
    IF v_item.variant_id IS NOT NULL THEN
      UPDATE public.product_variants
      SET stock_quantity = stock_quantity - v_item.quantity
      WHERE id = v_item.variant_id;
    ELSE
      UPDATE public.products
      SET stock_quantity = GREATEST(0, stock_quantity - v_item.quantity),
          in_stock = (GREATEST(0, stock_quantity - v_item.quantity) > 0)
      WHERE id = v_item.product_id;
    END IF;
  END LOOP;

  -- Update order totals (shipping/tax/discount can be applied later)
  UPDATE public.orders
  SET subtotal_amount = v_subtotal,
      total_amount    = v_subtotal,
      buyer_email     = (SELECT email FROM public.profiles WHERE id = v_user),
      buyer_phone     = (SELECT phone FROM public.profiles WHERE id = v_user)
  WHERE id = v_order_id;

  -- Initial pending payment row
  INSERT INTO public.payments (order_id, provider, amount, status)
  VALUES (v_order_id, p_payment_provider, v_subtotal, 'pending');

  -- Clear the cart
  DELETE FROM public.cart_items WHERE cart_id = v_cart_id;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.place_order(jsonb, jsonb, text, public.payment_provider) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, public.payment_provider) TO authenticated;

-- Cancel order RPC (buyer or seller) -----------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_reason text DEFAULT '')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_order    record;
  v_is_seller boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  SELECT id, buyer_id, status INTO v_order
  FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  v_is_seller := EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = p_order_id AND seller_id = v_user
  );

  IF v_order.buyer_id <> v_user AND NOT v_is_seller AND NOT public.is_admin(v_user) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  IF v_order.status IN ('shipped', 'delivered', 'cancelled', 'refunded') THEN
    RAISE EXCEPTION 'order cannot be cancelled in status %', v_order.status;
  END IF;

  -- Restock items
  UPDATE public.products p
  SET stock_quantity = p.stock_quantity + oi.quantity,
      in_stock = true
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.product_id = p.id AND oi.variant_id IS NULL;

  UPDATE public.product_variants v
  SET stock_quantity = v.stock_quantity + oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.variant_id = v.id;

  UPDATE public.orders
  SET status = 'cancelled', cancelled_at = now()
  WHERE id = p_order_id;

  UPDATE public.order_items
  SET status = 'cancelled'
  WHERE order_id = p_order_id;

  INSERT INTO public.order_status_history (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_order_id, v_order.status, 'cancelled', v_user, COALESCE(p_reason, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, text) TO authenticated;


-- ▶ 20260520210400_05_engagement.sql
/*
  # 05 — Engagement (wishlist, reviews, notifications)

  Tables
    - wishlists                  : user ❤ product (composite PK)
    - reviews                    : verified-purchase friendly, with rollup trigger
                                    that maintains products.rating_avg / rating_count
    - review_responses           : one vendor reply per review
    - notifications              : in-app feed (also used as the source of truth
                                    for any email / push channel built later)
    - notification_preferences   : per-channel opt-ins

  RPCs
    - mark_notifications_read(ids?)  bulk mark
    - toggle_wishlist(product_id)    add/remove single product

  Auto-notifications
    - When an order is placed, a notification is created for the buyer and for
      each distinct seller in the order.
*/

-- Wishlist --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wishlists (
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS wishlists_product_idx ON public.wishlists(product_id);
CREATE INDEX IF NOT EXISTS wishlists_user_added_idx ON public.wishlists(user_id, added_at DESC);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wishlists_owner_all" ON public.wishlists;
CREATE POLICY "wishlists_owner_all"
  ON public.wishlists FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.toggle_wishlist(p_product_id uuid)
RETURNS boolean   -- true = added, false = removed
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_existed boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  DELETE FROM public.wishlists
  WHERE user_id = v_user AND product_id = p_product_id
  RETURNING true INTO v_existed;

  IF v_existed THEN
    RETURN false;
  END IF;

  INSERT INTO public.wishlists (user_id, product_id) VALUES (v_user, p_product_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_wishlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_wishlist(uuid) TO authenticated;

-- Reviews ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.review_status AS ENUM ('pending', 'published', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_item_id       uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  rating              smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title               text NOT NULL DEFAULT '',
  body                text NOT NULL DEFAULT '',
  photos              jsonb NOT NULL DEFAULT '[]'::jsonb,
  helpful_count       integer NOT NULL DEFAULT 0,
  verified_purchase   boolean NOT NULL DEFAULT false,
  status              public.review_status NOT NULL DEFAULT 'published',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS reviews_product_published_idx
  ON public.reviews(product_id, created_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS reviews_user_idx     ON public.reviews(user_id);
CREATE INDEX IF NOT EXISTS reviews_status_idx   ON public.reviews(status);
CREATE INDEX IF NOT EXISTS reviews_rating_idx   ON public.reviews(rating);

DROP TRIGGER IF EXISTS reviews_set_updated_at ON public.reviews;
CREATE TRIGGER reviews_set_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Maintain products.rating_avg / rating_count
CREATE OR REPLACE FUNCTION public.tg_reviews_rollup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id uuid;
  v_avg numeric(3, 2);
  v_count integer;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT
    COALESCE(round(avg(rating)::numeric, 2), 0),
    COUNT(*)
  INTO v_avg, v_count
  FROM public.reviews
  WHERE product_id = v_product_id AND status = 'published';

  UPDATE public.products
  SET rating_avg   = v_avg,
      rating_count = v_count
  WHERE id = v_product_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS reviews_rollup ON public.reviews;
CREATE TRIGGER reviews_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_reviews_rollup();

-- Mark verified_purchase automatically when order_item_id is linked
CREATE OR REPLACE FUNCTION public.tg_reviews_verify_purchase()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_item_id IS NOT NULL THEN
    NEW.verified_purchase := EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = NEW.order_item_id
        AND o.buyer_id = NEW.user_id
        AND oi.product_id = NEW.product_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_verify_purchase ON public.reviews;
CREATE TRIGGER reviews_verify_purchase
  BEFORE INSERT OR UPDATE OF order_item_id ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_reviews_verify_purchase();

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_public_read" ON public.reviews;
CREATE POLICY "reviews_public_read"
  ON public.reviews FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "reviews_owner_read" ON public.reviews;
CREATE POLICY "reviews_owner_read"
  ON public.reviews FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_seller_read" ON public.reviews;
CREATE POLICY "reviews_seller_read"
  ON public.reviews FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ));

DROP POLICY IF EXISTS "reviews_owner_insert" ON public.reviews;
CREATE POLICY "reviews_owner_insert"
  ON public.reviews FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_owner_update" ON public.reviews;
CREATE POLICY "reviews_owner_update"
  ON public.reviews FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_owner_delete" ON public.reviews;
CREATE POLICY "reviews_owner_delete"
  ON public.reviews FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_admin_all" ON public.reviews;
CREATE POLICY "reviews_admin_all"
  ON public.reviews FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Review responses (vendor reply) ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid NOT NULL UNIQUE REFERENCES public.reviews(id)  ON DELETE CASCADE,
  seller_id   uuid NOT NULL REFERENCES public.profiles(id)        ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_responses_seller_idx ON public.review_responses(seller_id);

DROP TRIGGER IF EXISTS review_responses_set_updated_at ON public.review_responses;
CREATE TRIGGER review_responses_set_updated_at
  BEFORE UPDATE ON public.review_responses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.review_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_responses_public_read" ON public.review_responses;
CREATE POLICY "review_responses_public_read"
  ON public.review_responses FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "review_responses_seller_write" ON public.review_responses;
CREATE POLICY "review_responses_seller_write"
  ON public.review_responses FOR INSERT
  TO authenticated
  WITH CHECK (
    seller_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.reviews r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.id = review_id AND p.seller_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "review_responses_seller_update" ON public.review_responses;
CREATE POLICY "review_responses_seller_update"
  ON public.review_responses FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS "review_responses_seller_delete" ON public.review_responses;
CREATE POLICY "review_responses_seller_delete"
  ON public.review_responses FOR DELETE
  TO authenticated
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "review_responses_admin_all" ON public.review_responses;
CREATE POLICY "review_responses_admin_all"
  ON public.review_responses FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Notifications ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled',
    'payment_received', 'payment_failed',
    'product_review', 'product_low_stock',
    'vendor_verification_approved', 'vendor_verification_rejected',
    'promotion', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        public.notification_type NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_owner_read" ON public.notifications;
CREATE POLICY "notifications_owner_read"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Only allow marking as read (i.e. setting read_at). The trigger below enforces
-- that no other column changes.
DROP POLICY IF EXISTS "notifications_owner_update" ON public.notifications;
CREATE POLICY "notifications_owner_update"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_admin_all" ON public.notifications;
CREATE POLICY "notifications_admin_all"
  ON public.notifications FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.tg_notifications_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.type   IS DISTINCT FROM OLD.type
     OR NEW.title  IS DISTINCT FROM OLD.title
     OR NEW.body   IS DISTINCT FROM OLD.body
     OR NEW.data   IS DISTINCT FROM OLD.data
  THEN
    RAISE EXCEPTION 'only read_at may be updated' USING errcode = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_guard_update ON public.notifications;
CREATE TRIGGER notifications_guard_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_guard_update();

-- Notification preferences ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_orders      boolean NOT NULL DEFAULT true,
  email_promotions  boolean NOT NULL DEFAULT false,
  email_reviews     boolean NOT NULL DEFAULT true,
  push_orders       boolean NOT NULL DEFAULT true,
  push_promotions   boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS notification_preferences_set_updated_at ON public.notification_preferences;
CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_preferences_owner_all" ON public.notification_preferences;
CREATE POLICY "notification_preferences_owner_all"
  ON public.notification_preferences FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Mark notifications read RPC
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_ids IS NULL THEN
    UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = auth.uid() AND read_at IS NULL;
  ELSE
    UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = auth.uid() AND read_at IS NULL AND id = ANY(p_ids);
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- Auto-notify on order events -------------------------------------------------
-- We fire on the FIRST payment row of an order, NOT on order_items. Reason:
-- place_order() inserts all order_items first, then the initial payment last,
-- so by the time the payment row exists every seller's item is present and a
-- single trigger invocation can notify all distinct sellers + the buyer exactly
-- once (a per-item trigger would only see the first inserted item).
CREATE OR REPLACE FUNCTION public.tg_notify_order_placed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  public.orders;
  r        record;
BEGIN
  -- Only on the very first payment of the order (ignore retries/webhooks)
  IF (SELECT count(*) FROM public.payments WHERE order_id = NEW.order_id) > 1 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- One notification per distinct seller in the order
  FOR r IN
    SELECT DISTINCT seller_id FROM public.order_items WHERE order_id = v_order.id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.seller_id,
      'order_placed',
      'Nouvelle commande',
      'Vous avez reçu une nouvelle commande #' || v_order.order_number,
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number)
    );
  END LOOP;

  IF v_order.buyer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_order.buyer_id,
      'order_placed',
      'Commande enregistrée',
      'Votre commande #' || v_order.order_number || ' a bien été reçue.',
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_notify_order_placed ON public.payments;
CREATE TRIGGER payments_notify_order_placed
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_order_placed();

-- Notify on order status change
CREATE OR REPLACE FUNCTION public.tg_notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.notification_type;
  v_title text;
  v_body  text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'confirmed' THEN v_type := 'order_confirmed';
                          v_title := 'Commande confirmée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' a été confirmée.';
    WHEN 'shipped'   THEN v_type := 'order_shipped';
                          v_title := 'Commande expédiée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' est en route.';
    WHEN 'delivered' THEN v_type := 'order_delivered';
                          v_title := 'Commande livrée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' a été livrée.';
    WHEN 'cancelled' THEN v_type := 'order_cancelled';
                          v_title := 'Commande annulée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' a été annulée.';
    ELSE
      RETURN NEW;
  END CASE;

  IF NEW.buyer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.buyer_id, v_type, v_title, v_body,
            jsonb_build_object('order_id', NEW.id, 'order_number', NEW.order_number));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_notify_status_change ON public.orders;
CREATE TRIGGER orders_notify_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_order_status_change();

-- Notify on new review (to the product's seller)
CREATE OR REPLACE FUNCTION public.tg_notify_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seller uuid;
BEGIN
  SELECT seller_id INTO v_seller FROM public.products WHERE id = NEW.product_id;
  IF v_seller IS NOT NULL AND v_seller <> NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_seller,
      'product_review',
      'Nouvel avis client',
      'Un client a laissé un avis ' || NEW.rating || '★ sur votre produit.',
      jsonb_build_object('product_id', NEW.product_id, 'review_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_notify_seller ON public.reviews;
CREATE TRIGGER reviews_notify_seller
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_review();

-- Low stock alert (notify seller when stock crosses low_stock_threshold)
CREATE OR REPLACE FUNCTION public.tg_notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity <= NEW.low_stock_threshold
     AND OLD.stock_quantity > NEW.low_stock_threshold
     AND NEW.status = 'published'
  THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      NEW.seller_id,
      'product_low_stock',
      'Stock bas',
      'Le produit "' || NEW.name || '" passe sous le seuil (' || NEW.stock_quantity || ' restants).',
      jsonb_build_object('product_id', NEW.id, 'stock_quantity', NEW.stock_quantity)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_notify_low_stock ON public.products;
CREATE TRIGGER products_notify_low_stock
  AFTER UPDATE OF stock_quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_low_stock();


-- ▶ 20260520210500_06_storage_and_analytics.sql
/*
  # 06 — Storage buckets, storage RLS, analytics views/RPCs

  Buckets
    - products         (public)    product gallery
    - avatars          (public)    user avatars
    - store_logos      (public)    vendor store logos
    - store_banners    (public)    vendor store banners
    - vendor_documents (private)   KYC documents — owner + admin only

  Upload convention
    Every file path MUST start with `<auth.uid()>/...`. RLS uses
    `storage.foldername(name)[1]` to enforce that a user can only write
    inside their own folder.

  Analytics
    - vendor_dashboard_stats (view)    aggregated per-seller stats
    - vendor_top_products (RPC)        top products in the last N days
    - vendor_daily_revenue (RPC)       per-day revenue series
    - public_homepage_feed (RPC)       trending + featured products
*/

-- Buckets ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('products',         'products',         true,  10485760, ARRAY['image/jpeg','image/png','image/webp','image/avif']),
  ('avatars',          'avatars',          true,   5242880, ARRAY['image/jpeg','image/png','image/webp']),
  ('store_logos',      'store_logos',      true,   2097152, ARRAY['image/jpeg','image/png','image/webp']),
  ('store_banners',    'store_banners',    true,  10485760, ARRAY['image/jpeg','image/png','image/webp']),
  ('vendor_documents', 'vendor_documents', false, 20971520, ARRAY['image/jpeg','image/png','application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Helper to extract the first folder segment of a storage path (= owner uid)
-- (storage.foldername already exists; this is just a reminder of the convention).

-- products bucket -------------------------------------------------------------
DROP POLICY IF EXISTS "products_public_read"     ON storage.objects;
DROP POLICY IF EXISTS "products_vendor_insert"   ON storage.objects;
DROP POLICY IF EXISTS "products_vendor_update"   ON storage.objects;
DROP POLICY IF EXISTS "products_vendor_delete"   ON storage.objects;

DROP POLICY IF EXISTS "products_public_read" ON storage.objects;
CREATE POLICY "products_public_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'products');

DROP POLICY IF EXISTS "products_vendor_insert" ON storage.objects;
CREATE POLICY "products_vendor_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND public.is_vendor()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "products_vendor_update" ON storage.objects;
CREATE POLICY "products_vendor_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING  (bucket_id = 'products' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'products' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "products_vendor_delete" ON storage.objects;
CREATE POLICY "products_vendor_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'products' AND (storage.foldername(name))[1] = auth.uid()::text);

-- avatars bucket --------------------------------------------------------------
DROP POLICY IF EXISTS "avatars_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING  (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- store_logos + store_banners (vendor-only writes, public read) ---------------
DROP POLICY IF EXISTS "store_assets_public_read"  ON storage.objects;
DROP POLICY IF EXISTS "store_assets_vendor_insert" ON storage.objects;
DROP POLICY IF EXISTS "store_assets_vendor_update" ON storage.objects;
DROP POLICY IF EXISTS "store_assets_vendor_delete" ON storage.objects;

DROP POLICY IF EXISTS "store_assets_public_read" ON storage.objects;
CREATE POLICY "store_assets_public_read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('store_logos', 'store_banners'));

CREATE POLICY "store_assets_vendor_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('store_logos', 'store_banners')
    AND public.is_vendor()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "store_assets_vendor_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING  (bucket_id IN ('store_logos', 'store_banners') AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id IN ('store_logos', 'store_banners') AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "store_assets_vendor_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('store_logos', 'store_banners') AND (storage.foldername(name))[1] = auth.uid()::text);

-- vendor_documents — private (KYC) -------------------------------------------
DROP POLICY IF EXISTS "vendor_documents_owner_read"   ON storage.objects;
DROP POLICY IF EXISTS "vendor_documents_owner_insert" ON storage.objects;
DROP POLICY IF EXISTS "vendor_documents_owner_update" ON storage.objects;
DROP POLICY IF EXISTS "vendor_documents_owner_delete" ON storage.objects;

DROP POLICY IF EXISTS "vendor_documents_owner_read" ON storage.objects;
CREATE POLICY "vendor_documents_owner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'vendor_documents'
    AND ((storage.foldername(name))[1] = auth.uid()::text OR public.is_admin())
  );

CREATE POLICY "vendor_documents_owner_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vendor_documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "vendor_documents_owner_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING  (bucket_id = 'vendor_documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'vendor_documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "vendor_documents_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'vendor_documents' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Vendor dashboard view -------------------------------------------------------
DROP VIEW IF EXISTS public.vendor_dashboard_stats;
CREATE VIEW public.vendor_dashboard_stats
WITH (security_invoker = true)
AS
SELECT
  p.id                                                          AS seller_id,
  p.store_name,
  COUNT(DISTINCT pr.id)
    FILTER (WHERE pr.deleted_at IS NULL AND pr.status = 'published') AS products_published,
  COUNT(DISTINCT pr.id)
    FILTER (WHERE pr.deleted_at IS NULL AND pr.status = 'published' AND pr.in_stock) AS products_in_stock,
  COUNT(DISTINCT pr.id)
    FILTER (WHERE pr.deleted_at IS NULL AND pr.stock_quantity <= pr.low_stock_threshold AND pr.status = 'published') AS products_low_stock,
  COALESCE(SUM(oi.line_total)
    FILTER (WHERE oi.status NOT IN ('cancelled','refunded')), 0)  AS total_revenue,
  COUNT(DISTINCT oi.order_id)
    FILTER (WHERE oi.status NOT IN ('cancelled','refunded'))      AS orders_count,
  COALESCE(SUM(oi.quantity)
    FILTER (WHERE oi.status NOT IN ('cancelled','refunded')), 0)  AS items_sold,
  COUNT(DISTINCT oi.order_id)
    FILTER (WHERE oi.status = 'pending')                          AS orders_pending,
  COUNT(DISTINCT oi.order_id)
    FILTER (WHERE oi.status = 'shipped')                          AS orders_shipped,
  p.rating_avg,
  p.rating_count
FROM public.profiles p
LEFT JOIN public.products    pr ON pr.seller_id = p.id
LEFT JOIN public.order_items oi ON oi.seller_id = p.id
WHERE p.role IN ('vendor', 'admin') AND p.deleted_at IS NULL
GROUP BY p.id;

GRANT SELECT ON public.vendor_dashboard_stats TO authenticated;

-- Top products RPC (last N days, current vendor) -----------------------------
CREATE OR REPLACE FUNCTION public.vendor_top_products(p_limit integer DEFAULT 5, p_days integer DEFAULT 30)
RETURNS TABLE (
  product_id    uuid,
  product_name  text,
  units_sold    bigint,
  revenue       numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    oi.product_id,
    MAX(oi.product_name) AS product_name,
    SUM(oi.quantity)::bigint AS units_sold,
    SUM(oi.line_total)       AS revenue
  FROM public.order_items oi
  WHERE oi.seller_id = auth.uid()
    AND oi.created_at >= now() - make_interval(days => p_days)
    AND oi.status NOT IN ('cancelled', 'refunded')
  GROUP BY oi.product_id
  ORDER BY units_sold DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.vendor_top_products(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vendor_top_products(integer, integer) TO authenticated;

-- Daily revenue series (last N days, current vendor) -------------------------
CREATE OR REPLACE FUNCTION public.vendor_daily_revenue(p_days integer DEFAULT 30)
RETURNS TABLE (
  day      date,
  revenue  numeric,
  orders   bigint,
  items    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH days AS (
    SELECT generate_series(
      (current_date - (p_days - 1))::date,
      current_date,
      interval '1 day'
    )::date AS day
  )
  SELECT
    d.day,
    COALESCE(SUM(oi.line_total), 0) AS revenue,
    COUNT(DISTINCT oi.order_id)     AS orders,
    COALESCE(SUM(oi.quantity), 0)::bigint AS items
  FROM days d
  LEFT JOIN public.order_items oi
    ON date_trunc('day', oi.created_at)::date = d.day
    AND oi.seller_id = auth.uid()
    AND oi.status NOT IN ('cancelled', 'refunded')
  GROUP BY d.day
  ORDER BY d.day;
$$;

REVOKE ALL ON FUNCTION public.vendor_daily_revenue(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vendor_daily_revenue(integer) TO authenticated;

-- Public homepage feed: trending + featured + new ----------------------------
CREATE OR REPLACE FUNCTION public.public_homepage_feed(p_limit integer DEFAULT 12)
RETURNS TABLE (
  bucket          text,             -- 'trending' | 'featured' | 'newest'
  id              uuid,
  seller_id       uuid,
  name            text,
  slug            text,
  price           numeric,
  compare_at_price numeric,
  image_url       text,
  category        text,
  rating_avg      numeric,
  rating_count    integer,
  sales_count     integer
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  (
    SELECT 'trending'::text, p.id, p.seller_id, p.name, p.slug, p.price, p.compare_at_price,
           p.image_url, p.category, p.rating_avg, p.rating_count, p.sales_count
    FROM public.products p
    WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.in_stock
    ORDER BY p.sales_count DESC NULLS LAST, p.view_count DESC NULLS LAST
    LIMIT p_limit
  )
  UNION ALL
  (
    SELECT 'featured'::text, p.id, p.seller_id, p.name, p.slug, p.price, p.compare_at_price,
           p.image_url, p.category, p.rating_avg, p.rating_count, p.sales_count
    FROM public.products p
    WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.featured AND p.in_stock
    ORDER BY p.created_at DESC
    LIMIT p_limit
  )
  UNION ALL
  (
    SELECT 'newest'::text, p.id, p.seller_id, p.name, p.slug, p.price, p.compare_at_price,
           p.image_url, p.category, p.rating_avg, p.rating_count, p.sales_count
    FROM public.products p
    WHERE p.status = 'published' AND p.deleted_at IS NULL AND p.in_stock
    ORDER BY p.created_at DESC
    LIMIT p_limit
  );
$$;

REVOKE ALL ON FUNCTION public.public_homepage_feed(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_homepage_feed(integer) TO anon, authenticated;

-- Admin platform stats RPC ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_platform_stats()
RETURNS TABLE (
  total_users        bigint,
  total_vendors      bigint,
  pending_vendors    bigint,
  total_products     bigint,
  total_orders       bigint,
  gmv_30d            numeric,
  orders_30d         bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.profiles WHERE deleted_at IS NULL),
    (SELECT count(*) FROM public.profiles WHERE role = 'vendor' AND deleted_at IS NULL),
    (SELECT count(*) FROM public.profiles WHERE verification_status = 'pending'),
    (SELECT count(*) FROM public.products WHERE deleted_at IS NULL AND status = 'published'),
    (SELECT count(*) FROM public.orders),
    (SELECT COALESCE(sum(total_amount), 0) FROM public.orders
       WHERE created_at >= now() - interval '30 days' AND status NOT IN ('cancelled','refunded')),
    (SELECT count(*) FROM public.orders WHERE created_at >= now() - interval '30 days')
  WHERE public.is_admin(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.admin_platform_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_platform_stats() TO authenticated;


-- ▶ 20260520210600_07_seed_categories.sql
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

