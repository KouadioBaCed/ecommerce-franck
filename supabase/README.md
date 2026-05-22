# Supabase Backend — Marketplace Multi-Vendeurs

Production-ready PostgreSQL schema for a multi-vendor e-commerce platform.
All tables protected by **Row Level Security**, all mutations validated by
**check constraints + triggers**, all hot paths covered by **indexes**, all
business logic exposed as **SECURITY DEFINER RPC functions** that respect roles.

---

## Migration order

| # | File | Purpose |
|---|------|---------|
| 00 | `20260520204105_create_ecommerce_schema.sql` | Original `profiles` + `products` (pre-existing) |
| 01 | `20260520210000_01_extensions_and_helpers.sql` | `pgcrypto`, `pg_trgm`, `unaccent`, `slugify`, `tg_set_updated_at` |
| 02 | `20260520210100_02_users_and_roles.sql` | `user_role` enum, profile extensions, KYC, `addresses`, `is_admin/is_vendor` helpers |
| 03 | `20260520210200_03_catalog.sql` | `categories`, `tags`, product extensions, `product_images`, `product_variants`, full-text search |
| 04 | `20260520210300_04_commerce.sql` | `carts`, `cart_items`, `orders`, `order_items`, `payments`, status history, `place_order` RPC |
| 05 | `20260520210400_05_engagement.sql` | `wishlists`, `reviews`, `review_responses`, `notifications`, auto-notify triggers |
| 06 | `20260520210500_06_storage_and_analytics.sql` | Storage buckets + policies, `vendor_dashboard_stats` view, analytics RPCs |
| 07 | `20260520210600_07_seed_categories.sql` | Seed 9 default categories, backfill `products.category_id` |

All files are **idempotent** — `CREATE … IF NOT EXISTS`, `DROP POLICY IF EXISTS`
before `CREATE POLICY`, `ON CONFLICT DO NOTHING/UPDATE`. Re-running won't break
an existing database.

### Apply

```bash
supabase db reset      # local: wipe + replay
supabase db push       # remote: apply pending migrations
```

---

## Domain map

```
┌──────────────┐                  ┌──────────────────┐
│ auth.users   │──1:1──▶          │ profiles         │  role: customer | vendor | admin
└──────────────┘                  │  + KYC fields    │  verification_status
                                  └────────┬─────────┘
                                           │
            ┌───────────────────────────────┼────────────────────────────────┐
            │                               │                                │
       ┌────▼────┐                    ┌─────▼─────┐                    ┌─────▼──────┐
       │addresses│                    │ products  │──N:M──▶ tags       │   carts    │
       └─────────┘                    │  + images │                    │  +items    │
                                      │  + variants│                   └────────────┘
                                      └─────┬─────┘
                                            │
                              ┌─────────────┼──────────────┐
                              │             │              │
                         ┌────▼────┐  ┌─────▼─────┐   ┌────▼─────┐
                         │ reviews │  │ wishlists │   │  orders  │
                         │ +reply  │  └───────────┘   │ +items   │
                         └─────────┘                  │ +history │
                                                      │ +payments│
                                                      └──────────┘

                                  ┌──────────────────┐
                                  │ notifications    │
                                  │ + preferences    │
                                  └──────────────────┘
```

---

## Roles & permissions matrix

| Domain            | Customer    | Vendor                 | Admin |
|-------------------|-------------|------------------------|-------|
| Own profile       | RW          | RW                     | RW    |
| Other profiles    | R (public)  | R (public)             | RW    |
| Categories / tags | R           | R                      | RW    |
| Own products      | —           | RW                     | RW    |
| Public products   | R           | R                      | RW    |
| Own cart          | RW          | RW                     | R     |
| Own orders        | RW (create) | R (as seller)          | RW    |
| Items in own orders | RW        | RW (own seller_id)     | RW    |
| Payments          | R (own)     | R (own seller_id)      | RW    |
| Own wishlist      | RW          | RW                     | —     |
| Own reviews       | RW          | RW                     | RW    |
| Reply to review   | —           | RW (on own product)    | RW    |
| Notifications     | R (own) + mark read | R (own) + mark read | RW |

All policies are RLS — there is **no application-side authorization**. Compromise
the client and the database still enforces the rules.

---

## Helper functions

| Function | Use |
|----------|-----|
| `is_admin(uid?)` | RLS: `USING (public.is_admin())` |
| `is_vendor(uid?)` | RLS: `USING (public.is_vendor())` |
| `current_user_role()` | Convenience |
| `slugify(text)` | Slug normalization |
| `generate_unique_slug(table, column, base)` | Unique slug with `-2, -3, …` suffix |
| `tg_set_updated_at()` | Reusable BEFORE UPDATE trigger |

The role helpers are **SECURITY DEFINER** so policies don't recurse into the
profiles RLS. They have `SET search_path = public` for safety.

---

## RPC reference (call from the frontend via `supabase.rpc(...)`)

### Catalog
- `search_products(query, category_id, seller_id, min_price, max_price, in_stock, featured, sort, limit, offset)`
  Returns paginated `id, name, price, ..., total_count`.
- `increment_product_view(product_id)`

### Vendor application
- `apply_for_vendor(documents jsonb)` → sets `verification_status='pending'`
- `approve_vendor(user_id)` / `reject_vendor(user_id, reason)` — admin only

### Cart & checkout
- `cart_add_item(product_id, variant_id?, quantity?)` — upsert + merge
- `place_order(shipping_address jsonb, billing_address?, notes?, provider?)` →
  atomic: snapshots prices, decrements stock, creates pending payment, clears cart.
- `cancel_order(order_id, reason?)` — buyer/seller/admin, restocks items.

### Engagement
- `toggle_wishlist(product_id)` → boolean (true = added)
- `mark_notifications_read(ids?)` → integer count

### Analytics
- `vendor_top_products(limit?, days?)`
- `vendor_daily_revenue(days?)`
- `public_homepage_feed(limit?)`
- `admin_platform_stats()` — admin only

### Views
- `vendor_dashboard_stats` — view with `security_invoker = true`; respects
  the caller's RLS. A vendor sees only rows they're allowed to see.

---

## Storage buckets

| Bucket | Public | Size | Path convention |
|--------|--------|------|------------------|
| `products` | ✅ | 10 MB | `<uid>/<product_id>/<filename>` |
| `avatars` | ✅ | 5 MB | `<uid>/avatar.<ext>` |
| `store_logos` | ✅ | 2 MB | `<uid>/logo.<ext>` |
| `store_banners` | ✅ | 10 MB | `<uid>/banner.<ext>` |
| `vendor_documents` | 🔒 | 20 MB | `<uid>/<doc_name>` — KYC, owner + admin only |

RLS extracts the owner from `storage.foldername(name)[1]`. **Always upload to
your own `<auth.uid()>/…` folder**, otherwise the policy will reject the write.

Uploading from the frontend:

```ts
const path = `${user.id}/${productId}/${file.name}`;
const { data, error } = await supabase.storage.from('products').upload(path, file, {
  cacheControl: '3600',
  upsert: false,
});
const url = supabase.storage.from('products').getPublicUrl(path).data.publicUrl;
```

---

## Triggers — what runs automatically

| When | Trigger | Effect |
|------|---------|--------|
| `auth.users` INSERT | `on_auth_user_created` | Create `profiles` row + `notification_preferences` |
| `profiles` UPDATE | `profiles_guard_role` | Reject self-promotion to vendor/admin and self-approval |
| Any table with `updated_at` | `*_set_updated_at` | Refresh `updated_at = now()` |
| `products` INSERT/UPDATE name/desc/category/sku/slug | `products_search_and_slug` | Recompute `search_vector` + auto-slug |
| `orders` INSERT/UPDATE status | `orders_status_history` (AFTER) | Append `order_status_history` row |
| `orders` UPDATE status | `orders_status_stamps` (BEFORE) | Set `confirmed_at`/`shipped_at`/… |
| `orders` UPDATE status | `orders_notify_status_change` | Notify buyer |
| `order_items` INSERT (first item of an order) | `order_items_notify_placed` | Notify seller(s) and buyer |
| `order_items` UPDATE status → delivered | `order_items_sales_rollup` | Bump `products.sales_count`, `profiles.sales_count` |
| `reviews` INSERT/UPDATE/DELETE | `reviews_rollup` | Recompute `products.rating_avg`, `rating_count` |
| `reviews` INSERT | `reviews_notify_seller` | Notify product's seller |
| `reviews` INSERT/UPDATE | `reviews_verify_purchase` | Auto-set `verified_purchase` when `order_item_id` matches |
| `products` UPDATE stock | `products_notify_low_stock` | Notify seller when crossing `low_stock_threshold` |
| `notifications` UPDATE | `notifications_guard_update` | Only `read_at` may change (clients) |

---

## Indexes (hot paths)

- `products(search_vector)` GIN — full-text search
- `products(name gin_trgm_ops)` GIN — fuzzy / ILIKE
- `products(seller_id, status)` — vendor dashboard listings
- `products(created_at DESC)` — newest first
- `products(rating_avg DESC, rating_count DESC)` — sort by rating
- `products(category_id) WHERE deleted_at IS NULL` — category browse
- `products(featured) WHERE featured` — partial idx for featured rail
- `order_items(seller_id, status)` — vendor orders board
- `orders(buyer_id)`, `orders(placed_at DESC)`
- `notifications(user_id, created_at DESC) WHERE read_at IS NULL` — unread count badge

---

## Security checklist (defaults applied)

- ✅ RLS enabled on every public table
- ✅ Every SECURITY DEFINER function has `SET search_path = public`
- ✅ `REVOKE … FROM PUBLIC` then `GRANT … TO authenticated/anon` (least privilege)
- ✅ Role escalation blocked at trigger level (not just at the app)
- ✅ Verification approval requires admin
- ✅ Payment writes restricted to admin / service role (real flows use webhooks)
- ✅ Storage paths enforce `<auth.uid()>/…` to prevent cross-user writes
- ✅ Order item insert is gated by ownership of the parent order
- ✅ Soft-delete via `deleted_at` (products, profiles) — never lose history
- ✅ All money in `numeric(12, 2)` with `CHECK (>= 0)` constraints

---

## Recommended Edge Functions (not included, easy to add)

- `POST /stripe-webhook` — verify signature, update `payments.status` using
  the service-role key (bypasses RLS, lets webhooks write anywhere).
- `POST /send-order-email` — listen to `notifications` insert via Realtime,
  format and send transactional email (Resend / Postmark).
- `POST /vendor-approve` — admin UI calls this, which calls `approve_vendor()`
  and also sends an email to the new vendor.

The schema is ready for these — payments are append-only-from-client and the
notification table acts as a durable event log.

---

## Conventions

| Topic | Convention |
|-------|------------|
| Naming | `snake_case` everywhere; tables plural (`orders`), enums singular (`order_status`) |
| Timestamps | `timestamptz` named `created_at`, `updated_at`, `*_at` |
| Money | `numeric(12, 2)` with non-negative `CHECK` |
| IDs | `uuid` primary keys, `DEFAULT gen_random_uuid()` |
| Soft delete | `deleted_at timestamptz` (nullable) — never expose deleted rows |
| Junction tables | composite PK (e.g. `product_tags(product_id, tag_id)`) |
| Trigger functions | prefix `tg_` |
| RLS policy names | `<table>_<role>_<action>` (e.g. `products_owner_update`) |

---

## Maintenance

- `REINDEX` the `products_search_vector_idx` quarterly if you load large datasets.
- Consider a `pg_cron` job to mark abandoned carts (`carts.updated_at < now() - '14 days'`)
  for cleanup, or to recompute `products.sales_count` from the source of truth.
- Add an `audit_log` table later if you need full row-level audit trail —
  the `order_status_history` pattern is the template.
