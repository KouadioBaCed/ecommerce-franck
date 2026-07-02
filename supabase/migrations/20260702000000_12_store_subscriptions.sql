/*
  # 12 — Store subscriptions (paywall via GeniusPay)

  Product decision: opening a store now requires a paid monthly subscription
  (200 FCFA / month). A store is only visible on the marketplace and its owner
  can only publish/manage products while the subscription is active
  (subscription_expires_at > now()). This is "blocage fort":

    1. profiles gains subscription_status / _started_at / _expires_at.
    2. subscription_payments records every GeniusPay transaction (history +
       receipts). Written server-side only (Netlify function w/ service role).
    3. is_subscription_active() drives both RLS and the UI.
    4. Public read policies on products / product_images / product_variants now
       require the seller's subscription to be active → unpaid stores disappear
       from the whole marketplace (home, store page, product page, search).
    5. A trigger blocks creating a product or publishing one without an active
       subscription (belt-and-suspenders with the UI paywall).
    6. admin_set_subscription() lets an admin manually activate / deactivate.
    7. Existing accounts are switched to 'inactive' — everyone must pay to
       (re)activate, per the owner's decision.

  Security notes
    - is_subscription_active() is SECURITY DEFINER so RLS policies can call it
      without recursing into profiles' own RLS.
    - Only admins (or trusted no-JWT contexts: service role / migrations) can
      change subscription_* columns, enforced by tg_profiles_guard_subscription.
      => users can never self-activate; activation only happens through the
         server-side GeniusPay verification/webhook (service role) or an admin.
*/

-- 1. Subscription columns on profiles ----------------------------------------
DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM ('inactive', 'active', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status     public.subscription_status NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS subscription_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_subscription_expires_idx
  ON public.profiles(subscription_expires_at)
  WHERE deleted_at IS NULL;

-- 2. Active-subscription helper ----------------------------------------------
-- SECURITY DEFINER → bypasses profiles RLS so it is safe to call from policies.
CREATE OR REPLACE FUNCTION public.is_subscription_active(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid
      AND deleted_at IS NULL
      AND subscription_expires_at IS NOT NULL
      AND subscription_expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION public.is_subscription_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_subscription_active(uuid) TO anon, authenticated;

-- 3. Payment history / receipts ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reference      text UNIQUE,                       -- GeniusPay MTX-XXXXXXXXXX
  provider       text NOT NULL DEFAULT 'geniuspay',
  amount         numeric(12, 2) NOT NULL,
  currency       text NOT NULL DEFAULT 'XOF',
  status         text NOT NULL DEFAULT 'pending',   -- pending|processing|completed|failed|expired|cancelled
  payment_method text,
  checkout_url   text,
  period_start   timestamptz,
  period_end     timestamptz,
  paid_at        timestamptz,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_payments_vendor_idx
  ON public.subscription_payments(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS subscription_payments_status_idx
  ON public.subscription_payments(status);
CREATE INDEX IF NOT EXISTS subscription_payments_created_idx
  ON public.subscription_payments(created_at DESC);

DROP TRIGGER IF EXISTS subscription_payments_set_updated_at ON public.subscription_payments;
CREATE TRIGGER subscription_payments_set_updated_at
  BEFORE UPDATE ON public.subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Vendors read their own history; admins read everything. Writes only happen
-- through the service role (Netlify functions) which bypasses RLS entirely —
-- so no INSERT/UPDATE policy is granted to end users on purpose.
DROP POLICY IF EXISTS "subscription_payments_owner_read" ON public.subscription_payments;
CREATE POLICY "subscription_payments_owner_read"
  ON public.subscription_payments FOR SELECT
  TO authenticated
  USING (vendor_id = auth.uid());

DROP POLICY IF EXISTS "subscription_payments_admin_all" ON public.subscription_payments;
CREATE POLICY "subscription_payments_admin_all"
  ON public.subscription_payments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 4. Guard: only admins / trusted contexts may touch subscription_* ----------
CREATE OR REPLACE FUNCTION public.tg_profiles_guard_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_acting uuid := auth.uid();
BEGIN
  -- No JWT (service role, migrations, SQL editor) or admin → trusted.
  IF v_acting IS NULL OR public.is_admin(v_acting) THEN
    RETURN NEW;
  END IF;

  IF NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
     OR NEW.subscription_started_at IS DISTINCT FROM OLD.subscription_started_at
     OR NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at
  THEN
    RAISE EXCEPTION 'subscription changes are not allowed for end users'
      USING errcode = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_subscription ON public.profiles;
CREATE TRIGGER profiles_guard_subscription
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_guard_subscription();

-- 5. Public read policies now require an active subscription ------------------
DROP POLICY IF EXISTS "products_public_read" ON public.products;
CREATE POLICY "products_public_read"
  ON public.products FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND status = 'published'
    AND public.is_subscription_active(seller_id)
  );

DROP POLICY IF EXISTS "product_images_public_read" ON public.product_images;
CREATE POLICY "product_images_public_read"
  ON public.product_images FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id
      AND p.status = 'published'
      AND p.deleted_at IS NULL
      AND public.is_subscription_active(p.seller_id)
  ));

DROP POLICY IF EXISTS "product_variants_public_read" ON public.product_variants;
CREATE POLICY "product_variants_public_read"
  ON public.product_variants FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = product_id
        AND p.status = 'published'
        AND p.deleted_at IS NULL
        AND public.is_subscription_active(p.seller_id)
    )
  );

-- 6. Block product creation / publishing without an active subscription ------
CREATE OR REPLACE FUNCTION public.tg_products_require_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acting uuid := auth.uid();
BEGIN
  -- Trusted contexts (service role / migrations) and admins are exempt.
  IF v_acting IS NULL OR public.is_admin(v_acting) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_subscription_active(NEW.seller_id) THEN
      RAISE EXCEPTION 'active store subscription required to add products'
        USING errcode = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Allow edits to drafts/archived, but block (re)publishing when inactive.
    IF NEW.status = 'published'
       AND OLD.status IS DISTINCT FROM 'published'
       AND NOT public.is_subscription_active(NEW.seller_id)
    THEN
      RAISE EXCEPTION 'active store subscription required to publish products'
        USING errcode = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_require_subscription ON public.products;
CREATE TRIGGER products_require_subscription
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_require_subscription();

-- 7. Admin manual activate / deactivate --------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_subscription(
  p_user_id uuid,
  p_active  boolean,
  p_days    integer DEFAULT 30
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.profiles;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING errcode = '42501';
  END IF;

  IF p_active THEN
    UPDATE public.profiles
    SET subscription_status     = 'active',
        subscription_started_at = COALESCE(subscription_started_at, now()),
        subscription_expires_at = GREATEST(COALESCE(subscription_expires_at, now()), now())
                                    + make_interval(days => GREATEST(p_days, 1))
    WHERE id = p_user_id
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.profiles
    SET subscription_status     = 'inactive',
        subscription_expires_at = now()   -- expire immediately
    WHERE id = p_user_id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_subscription(uuid, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_subscription(uuid, boolean, integer) TO authenticated;

-- 8. Admin history overview (one row per vendor + payment aggregates) ---------
CREATE OR REPLACE FUNCTION public.admin_subscription_overview()
RETURNS TABLE (
  vendor_id            uuid,
  email                text,
  full_name            text,
  store_name           text,
  store_slug           text,
  role                 public.user_role,
  deleted_at           timestamptz,
  subscription_status  public.subscription_status,
  subscription_expires_at timestamptz,
  is_active            boolean,
  total_paid           numeric,
  payments_count       bigint,
  last_payment_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.store_name,
    p.store_slug,
    p.role,
    p.deleted_at,
    p.subscription_status,
    p.subscription_expires_at,
    (p.subscription_expires_at IS NOT NULL AND p.subscription_expires_at > now()) AS is_active,
    COALESCE(SUM(sp.amount) FILTER (WHERE sp.status = 'completed'), 0) AS total_paid,
    COUNT(sp.id) FILTER (WHERE sp.status = 'completed') AS payments_count,
    MAX(sp.paid_at) AS last_payment_at
  FROM public.profiles p
  LEFT JOIN public.subscription_payments sp ON sp.vendor_id = p.id
  WHERE public.is_admin(auth.uid())      -- returns nothing for non-admins
  GROUP BY p.id
  ORDER BY p.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_subscription_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_subscription_overview() TO authenticated;

-- 9. Existing accounts must pay to (re)activate ------------------------------
UPDATE public.profiles
SET subscription_status = 'inactive',
    subscription_expires_at = NULL
WHERE role IN ('vendor', 'customer')
  AND subscription_status IS DISTINCT FROM 'active';
