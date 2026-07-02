/*
  # 09 — Auto-promote signups to vendor

  Product decision: this is a self-service marketplace ("Ouvrir ma boutique en
  2 minutes — sans commission"). Every new account becomes a vendor immediately
  so it can manage its store (logo, banner, products) without an admin approval
  step. This supersedes the customer → apply_for_vendor → admin-approval flow
  from migration 02 for the default signup path.

  Changes
    1. handle_new_user() now creates profiles with role = 'vendor' (approved).
    2. Existing 'customer' accounts are promoted in-place so they too can upload
       store assets and products (all of which require public.is_vendor()).

  Note: the guard trigger tg_profiles_guard_role only fires on UPDATE and is
  bypassed when auth.uid() IS NULL (migrations / service role), so the in-place
  promotion below is allowed.
*/

-- 1. New signups become vendors ----------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Profile is the critical row; it must always be created.
  INSERT INTO public.profiles (id, email, role, verification_status, verified_at)
  VALUES (NEW.id, NEW.email, 'vendor', 'approved', now())
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email
    WHERE public.profiles.email IS DISTINCT FROM EXCLUDED.email;

  -- Default notification preferences are best-effort. Isolate in a sub-block so
  -- a failure here never rolls back the profile insert above.
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

-- 2. Promote existing customers ----------------------------------------------
UPDATE public.profiles
SET role = 'vendor',
    verification_status = 'approved',
    verified_at = COALESCE(verified_at, now())
WHERE role = 'customer'
  AND deleted_at IS NULL;
