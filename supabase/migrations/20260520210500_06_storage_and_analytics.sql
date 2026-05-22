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
