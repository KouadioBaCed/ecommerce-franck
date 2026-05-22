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
