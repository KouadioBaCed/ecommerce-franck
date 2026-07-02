/*
  # 11 — Per-size stock

  Adds a per-size stock map alongside `sizes`:
    size_stock  jsonb   e.g. {"40": 5, "41": 3, "42": 0}

  - keys mirror the entries of products.sizes
  - value = units available for that size / pointure (0 = sold out)
  Empty ('{}') for products that don't use sizes. The storefront caps the
  quantity a buyer can order per size to this value.
*/
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS size_stock jsonb NOT NULL DEFAULT '{}'::jsonb;
