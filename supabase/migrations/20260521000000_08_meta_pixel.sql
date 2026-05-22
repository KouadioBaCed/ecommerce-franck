/*
  # 08 — Meta (Facebook) Pixel per vendor

  Adds `meta_pixel_id` to profiles so each store can load its own Meta Pixel.

  Security
    - No new policy needed: the existing `profiles_self_update` lets a vendor
      edit their own pixel id, and `profiles_public_read` exposes it so the
      pixel can load for visitors on the public store.
    - Pixel IDs are inherently public (they appear in any page that uses them),
      so public read is not a leak.
    - The role guard trigger ignores this column.

  Idempotent: safe to re-run.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS meta_pixel_id text;
