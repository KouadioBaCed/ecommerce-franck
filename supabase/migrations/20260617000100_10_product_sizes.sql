/*
  # 10 — Product sizes / pointures

  Adds an array of available sizes to products:
    - clothing  (category "Vêtements")  → sizes  (XS, S, M, L, ...)
    - shoes     (category "Chaussures") → pointures (36, 37, 38, ...)

  Empty ('{}') for any category that does not need it. The storefront uses this
  to make the buyer pick a size before ordering on WhatsApp.
*/
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sizes text[] NOT NULL DEFAULT '{}';
