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
