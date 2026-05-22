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
