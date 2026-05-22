/*
  # 05 — Engagement (wishlist, reviews, notifications)

  Tables
    - wishlists                  : user ❤ product (composite PK)
    - reviews                    : verified-purchase friendly, with rollup trigger
                                    that maintains products.rating_avg / rating_count
    - review_responses           : one vendor reply per review
    - notifications              : in-app feed (also used as the source of truth
                                    for any email / push channel built later)
    - notification_preferences   : per-channel opt-ins

  RPCs
    - mark_notifications_read(ids?)  bulk mark
    - toggle_wishlist(product_id)    add/remove single product

  Auto-notifications
    - When an order is placed, a notification is created for the buyer and for
      each distinct seller in the order.
*/

-- Wishlist --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wishlists (
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS wishlists_product_idx ON public.wishlists(product_id);
CREATE INDEX IF NOT EXISTS wishlists_user_added_idx ON public.wishlists(user_id, added_at DESC);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wishlists_owner_all" ON public.wishlists;
CREATE POLICY "wishlists_owner_all"
  ON public.wishlists FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.toggle_wishlist(p_product_id uuid)
RETURNS boolean   -- true = added, false = removed
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_existed boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  DELETE FROM public.wishlists
  WHERE user_id = v_user AND product_id = p_product_id
  RETURNING true INTO v_existed;

  IF v_existed THEN
    RETURN false;
  END IF;

  INSERT INTO public.wishlists (user_id, product_id) VALUES (v_user, p_product_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_wishlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_wishlist(uuid) TO authenticated;

-- Reviews ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.review_status AS ENUM ('pending', 'published', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  order_item_id       uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  rating              smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title               text NOT NULL DEFAULT '',
  body                text NOT NULL DEFAULT '',
  photos              jsonb NOT NULL DEFAULT '[]'::jsonb,
  helpful_count       integer NOT NULL DEFAULT 0,
  verified_purchase   boolean NOT NULL DEFAULT false,
  status              public.review_status NOT NULL DEFAULT 'published',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, user_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS reviews_product_published_idx
  ON public.reviews(product_id, created_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS reviews_user_idx     ON public.reviews(user_id);
CREATE INDEX IF NOT EXISTS reviews_status_idx   ON public.reviews(status);
CREATE INDEX IF NOT EXISTS reviews_rating_idx   ON public.reviews(rating);

DROP TRIGGER IF EXISTS reviews_set_updated_at ON public.reviews;
CREATE TRIGGER reviews_set_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Maintain products.rating_avg / rating_count
CREATE OR REPLACE FUNCTION public.tg_reviews_rollup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_product_id uuid;
  v_avg numeric(3, 2);
  v_count integer;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);

  SELECT
    COALESCE(round(avg(rating)::numeric, 2), 0),
    COUNT(*)
  INTO v_avg, v_count
  FROM public.reviews
  WHERE product_id = v_product_id AND status = 'published';

  UPDATE public.products
  SET rating_avg   = v_avg,
      rating_count = v_count
  WHERE id = v_product_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS reviews_rollup ON public.reviews;
CREATE TRIGGER reviews_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_reviews_rollup();

-- Mark verified_purchase automatically when order_item_id is linked
CREATE OR REPLACE FUNCTION public.tg_reviews_verify_purchase()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_item_id IS NOT NULL THEN
    NEW.verified_purchase := EXISTS (
      SELECT 1
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
      WHERE oi.id = NEW.order_item_id
        AND o.buyer_id = NEW.user_id
        AND oi.product_id = NEW.product_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_verify_purchase ON public.reviews;
CREATE TRIGGER reviews_verify_purchase
  BEFORE INSERT OR UPDATE OF order_item_id ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_reviews_verify_purchase();

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_public_read" ON public.reviews;
CREATE POLICY "reviews_public_read"
  ON public.reviews FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "reviews_owner_read" ON public.reviews;
CREATE POLICY "reviews_owner_read"
  ON public.reviews FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_seller_read" ON public.reviews;
CREATE POLICY "reviews_seller_read"
  ON public.reviews FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = product_id AND p.seller_id = auth.uid()
  ));

DROP POLICY IF EXISTS "reviews_owner_insert" ON public.reviews;
CREATE POLICY "reviews_owner_insert"
  ON public.reviews FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_owner_update" ON public.reviews;
CREATE POLICY "reviews_owner_update"
  ON public.reviews FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_owner_delete" ON public.reviews;
CREATE POLICY "reviews_owner_delete"
  ON public.reviews FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "reviews_admin_all" ON public.reviews;
CREATE POLICY "reviews_admin_all"
  ON public.reviews FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Review responses (vendor reply) ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_responses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid NOT NULL UNIQUE REFERENCES public.reviews(id)  ON DELETE CASCADE,
  seller_id   uuid NOT NULL REFERENCES public.profiles(id)        ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_responses_seller_idx ON public.review_responses(seller_id);

DROP TRIGGER IF EXISTS review_responses_set_updated_at ON public.review_responses;
CREATE TRIGGER review_responses_set_updated_at
  BEFORE UPDATE ON public.review_responses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.review_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_responses_public_read" ON public.review_responses;
CREATE POLICY "review_responses_public_read"
  ON public.review_responses FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "review_responses_seller_write" ON public.review_responses;
CREATE POLICY "review_responses_seller_write"
  ON public.review_responses FOR INSERT
  TO authenticated
  WITH CHECK (
    seller_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.reviews r
      JOIN public.products p ON p.id = r.product_id
      WHERE r.id = review_id AND p.seller_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "review_responses_seller_update" ON public.review_responses;
CREATE POLICY "review_responses_seller_update"
  ON public.review_responses FOR UPDATE
  TO authenticated
  USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

DROP POLICY IF EXISTS "review_responses_seller_delete" ON public.review_responses;
CREATE POLICY "review_responses_seller_delete"
  ON public.review_responses FOR DELETE
  TO authenticated
  USING (seller_id = auth.uid());

DROP POLICY IF EXISTS "review_responses_admin_all" ON public.review_responses;
CREATE POLICY "review_responses_admin_all"
  ON public.review_responses FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Notifications ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled',
    'payment_received', 'payment_failed',
    'product_review', 'product_low_stock',
    'vendor_verification_approved', 'vendor_verification_rejected',
    'promotion', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        public.notification_type NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON public.notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_owner_read" ON public.notifications;
CREATE POLICY "notifications_owner_read"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Only allow marking as read (i.e. setting read_at). The trigger below enforces
-- that no other column changes.
DROP POLICY IF EXISTS "notifications_owner_update" ON public.notifications;
CREATE POLICY "notifications_owner_update"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_admin_all" ON public.notifications;
CREATE POLICY "notifications_admin_all"
  ON public.notifications FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.tg_notifications_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.type   IS DISTINCT FROM OLD.type
     OR NEW.title  IS DISTINCT FROM OLD.title
     OR NEW.body   IS DISTINCT FROM OLD.body
     OR NEW.data   IS DISTINCT FROM OLD.data
  THEN
    RAISE EXCEPTION 'only read_at may be updated' USING errcode = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_guard_update ON public.notifications;
CREATE TRIGGER notifications_guard_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_guard_update();

-- Notification preferences ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  email_orders      boolean NOT NULL DEFAULT true,
  email_promotions  boolean NOT NULL DEFAULT false,
  email_reviews     boolean NOT NULL DEFAULT true,
  push_orders       boolean NOT NULL DEFAULT true,
  push_promotions   boolean NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS notification_preferences_set_updated_at ON public.notification_preferences;
CREATE TRIGGER notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_preferences_owner_all" ON public.notification_preferences;
CREATE POLICY "notification_preferences_owner_all"
  ON public.notification_preferences FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Mark notifications read RPC
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  IF p_ids IS NULL THEN
    UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = auth.uid() AND read_at IS NULL;
  ELSE
    UPDATE public.notifications
    SET read_at = now()
    WHERE user_id = auth.uid() AND read_at IS NULL AND id = ANY(p_ids);
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- Auto-notify on order events -------------------------------------------------
-- We fire on the FIRST payment row of an order, NOT on order_items. Reason:
-- place_order() inserts all order_items first, then the initial payment last,
-- so by the time the payment row exists every seller's item is present and a
-- single trigger invocation can notify all distinct sellers + the buyer exactly
-- once (a per-item trigger would only see the first inserted item).
CREATE OR REPLACE FUNCTION public.tg_notify_order_placed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  public.orders;
  r        record;
BEGIN
  -- Only on the very first payment of the order (ignore retries/webhooks)
  IF (SELECT count(*) FROM public.payments WHERE order_id = NEW.order_id) > 1 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- One notification per distinct seller in the order
  FOR r IN
    SELECT DISTINCT seller_id FROM public.order_items WHERE order_id = v_order.id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      r.seller_id,
      'order_placed',
      'Nouvelle commande',
      'Vous avez reçu une nouvelle commande #' || v_order.order_number,
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number)
    );
  END LOOP;

  IF v_order.buyer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_order.buyer_id,
      'order_placed',
      'Commande enregistrée',
      'Votre commande #' || v_order.order_number || ' a bien été reçue.',
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_notify_order_placed ON public.payments;
CREATE TRIGGER payments_notify_order_placed
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_order_placed();

-- Notify on order status change
CREATE OR REPLACE FUNCTION public.tg_notify_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.notification_type;
  v_title text;
  v_body  text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  CASE NEW.status
    WHEN 'confirmed' THEN v_type := 'order_confirmed';
                          v_title := 'Commande confirmée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' a été confirmée.';
    WHEN 'shipped'   THEN v_type := 'order_shipped';
                          v_title := 'Commande expédiée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' est en route.';
    WHEN 'delivered' THEN v_type := 'order_delivered';
                          v_title := 'Commande livrée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' a été livrée.';
    WHEN 'cancelled' THEN v_type := 'order_cancelled';
                          v_title := 'Commande annulée';
                          v_body  := 'Votre commande #' || NEW.order_number || ' a été annulée.';
    ELSE
      RETURN NEW;
  END CASE;

  IF NEW.buyer_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (NEW.buyer_id, v_type, v_title, v_body,
            jsonb_build_object('order_id', NEW.id, 'order_number', NEW.order_number));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_notify_status_change ON public.orders;
CREATE TRIGGER orders_notify_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_order_status_change();

-- Notify on new review (to the product's seller)
CREATE OR REPLACE FUNCTION public.tg_notify_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seller uuid;
BEGIN
  SELECT seller_id INTO v_seller FROM public.products WHERE id = NEW.product_id;
  IF v_seller IS NOT NULL AND v_seller <> NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_seller,
      'product_review',
      'Nouvel avis client',
      'Un client a laissé un avis ' || NEW.rating || '★ sur votre produit.',
      jsonb_build_object('product_id', NEW.product_id, 'review_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_notify_seller ON public.reviews;
CREATE TRIGGER reviews_notify_seller
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_review();

-- Low stock alert (notify seller when stock crosses low_stock_threshold)
CREATE OR REPLACE FUNCTION public.tg_notify_low_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_quantity <= NEW.low_stock_threshold
     AND OLD.stock_quantity > NEW.low_stock_threshold
     AND NEW.status = 'published'
  THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      NEW.seller_id,
      'product_low_stock',
      'Stock bas',
      'Le produit "' || NEW.name || '" passe sous le seuil (' || NEW.stock_quantity || ' restants).',
      jsonb_build_object('product_id', NEW.id, 'stock_quantity', NEW.stock_quantity)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_notify_low_stock ON public.products;
CREATE TRIGGER products_notify_low_stock
  AFTER UPDATE OF stock_quantity ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_low_stock();
