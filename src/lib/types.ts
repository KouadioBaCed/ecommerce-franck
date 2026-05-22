export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

/* ----------------------------------------------------------------------------
 * Enums (mirror the PostgreSQL enums defined in supabase/migrations)
 * ------------------------------------------------------------------------- */
export type UserRole = 'customer' | 'vendor' | 'admin';
export type VerificationStatus = 'unverified' | 'pending' | 'approved' | 'rejected';
export type ProductStatus = 'draft' | 'published' | 'archived';
export type OrderStatus =
  | 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
export type PaymentStatus =
  | 'pending' | 'authorized' | 'paid' | 'failed' | 'refunded' | 'partially_refunded';
export type PaymentProvider =
  | 'whatsapp_manual' | 'stripe' | 'paypal' | 'mobile_money' | 'cash_on_delivery';
export type ReviewStatus = 'pending' | 'published' | 'rejected';
export type NotificationType =
  | 'order_placed' | 'order_confirmed' | 'order_shipped' | 'order_delivered' | 'order_cancelled'
  | 'payment_received' | 'payment_failed'
  | 'product_review' | 'product_low_stock'
  | 'vendor_verification_approved' | 'vendor_verification_rejected'
  | 'promotion' | 'system';

/* ----------------------------------------------------------------------------
 * Row types
 * ------------------------------------------------------------------------- */
export type Profile = {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string;
  avatar_url: string;
  bio: string;
  email: string | null;
  // Vendor store fields
  store_name: string;
  store_slug: string | null;
  store_description: string;
  store_logo_url: string;
  whatsapp_number: string;
  banner_url: string;
  meta_pixel_id: string | null;
  // Vendor verification / KYC
  verification_status: VerificationStatus;
  verification_submitted_at: string | null;
  verified_at: string | null;
  verification_documents: Json;
  // Aggregates
  rating_avg: number;
  rating_count: number;
  sales_count: number;
  last_seen_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type Address = {
  id: string;
  user_id: string;
  label: string;
  full_name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type Category = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description: string;
  icon: string;
  image_url: string;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Tag = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export type Product = {
  id: string;
  seller_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  category: string;
  in_stock: boolean;
  // Catalog extensions
  slug: string | null;
  sku: string | null;
  compare_at_price: number | null;
  cost_price: number | null;
  stock_quantity: number;
  low_stock_threshold: number;
  category_id: string | null;
  status: ProductStatus;
  featured: boolean;
  sponsored: boolean;
  view_count: number;
  sales_count: number;
  rating_avg: number;
  rating_count: number;
  weight_grams: number | null;
  meta_title: string | null;
  meta_description: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ProductImage = {
  id: string;
  product_id: string;
  url: string;
  alt_text: string;
  position: number;
  created_at: string;
}

export type ProductVariant = {
  id: string;
  product_id: string;
  sku: string | null;
  name: string;
  attributes: Json;
  price_modifier: number;
  stock_quantity: number;
  image_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Cart = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export type CartItem = {
  id: string;
  cart_id: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  added_at: string;
}

export type Order = {
  id: string;
  order_number: string;
  buyer_id: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  status: OrderStatus;
  payment_status: PaymentStatus;
  subtotal_amount: number;
  shipping_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  shipping_address: Json;
  billing_address: Json | null;
  notes: string;
  metadata: Json;
  placed_at: string;
  confirmed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  seller_id: string;
  product_name: string;
  product_image_url: string;
  variant_name: string | null;
  sku: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  status: OrderStatus;
  shipped_at: string | null;
  delivered_at: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  created_at: string;
  updated_at: string;
}

export type OrderStatusHistory = {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by: string | null;
  reason: string;
  created_at: string;
}

export type Payment = {
  id: string;
  order_id: string;
  provider: PaymentProvider;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paid_at: string | null;
  refunded_at: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export type Wishlist = {
  user_id: string;
  product_id: string;
  added_at: string;
}

export type Review = {
  id: string;
  product_id: string;
  user_id: string;
  order_item_id: string | null;
  rating: number;
  title: string;
  body: string;
  photos: Json;
  helpful_count: number;
  verified_purchase: boolean;
  status: ReviewStatus;
  created_at: string;
  updated_at: string;
}

export type ReviewResponse = {
  id: string;
  review_id: string;
  seller_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export type Notification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Json;
  read_at: string | null;
  created_at: string;
}

export type NotificationPreferences = {
  user_id: string;
  email_orders: boolean;
  email_promotions: boolean;
  email_reviews: boolean;
  push_orders: boolean;
  push_promotions: boolean;
  updated_at: string;
}

/* Joined / convenience shapes */
export type ProductWithSeller = Product & {
  profiles: Profile;
};

/* ----------------------------------------------------------------------------
 * Database type consumed by the typed Supabase client.
 *
 * Insert/Update generics use Partial so optional/defaulted columns can be
 * omitted — this is what fixes the previous `never` inference on insert/update.
 * ------------------------------------------------------------------------- */
type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

// Insert/Update are Partial<Row>: every column is optional at the type level
// because the database supplies defaults (gen_random_uuid, now(), DEFAULT ...)
// and NOT NULL is enforced server-side. This avoids false "missing property"
// errors while still typing the column shapes.
type Table<Row, Rels extends Relationship[] = []> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Rels;
};

type ProductToSeller = {
  foreignKeyName: 'products_seller_id_fkey';
  columns: ['seller_id'];
  isOneToOne: false;
  referencedRelation: 'profiles';
  referencedColumns: ['id'];
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      addresses: Table<Address>;
      categories: Table<Category>;
      tags: Table<Tag>;
      products: Table<Product, [ProductToSeller]>;
      product_images: Table<ProductImage>;
      product_variants: Table<ProductVariant>;
      product_tags: Table<{ product_id: string; tag_id: string }>;
      carts: Table<Cart>;
      cart_items: Table<CartItem>;
      orders: Table<Order>;
      order_items: Table<OrderItem>;
      order_status_history: Table<OrderStatusHistory>;
      payments: Table<Payment>;
      wishlists: Table<Wishlist>;
      reviews: Table<Review>;
      review_responses: Table<ReviewResponse>;
      notifications: Table<Notification>;
      notification_preferences: Table<NotificationPreferences>;
    };
    Views: {
      vendor_dashboard_stats: {
        Row: {
          seller_id: string;
          store_name: string;
          products_published: number;
          products_in_stock: number;
          products_low_stock: number;
          total_revenue: number;
          orders_count: number;
          items_sold: number;
          orders_pending: number;
          orders_shipped: number;
          rating_avg: number;
          rating_count: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      search_products: {
        Args: {
          p_query?: string | null;
          p_category_id?: string | null;
          p_seller_id?: string | null;
          p_min_price?: number | null;
          p_max_price?: number | null;
          p_in_stock?: boolean | null;
          p_featured?: boolean | null;
          p_sort?: string;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Array<
          Pick<
            Product,
            | 'id' | 'seller_id' | 'name' | 'slug' | 'description' | 'price'
            | 'compare_at_price' | 'image_url' | 'category' | 'category_id'
            | 'rating_avg' | 'rating_count' | 'sales_count' | 'view_count'
            | 'in_stock' | 'stock_quantity' | 'featured' | 'created_at'
          > & { total_count: number }
        >;
      };
      place_order: {
        Args: {
          p_shipping_address: Json;
          p_billing_address?: Json | null;
          p_notes?: string;
          p_payment_provider?: PaymentProvider;
        };
        Returns: string;
      };
      cancel_order: { Args: { p_order_id: string; p_reason?: string }; Returns: undefined };
      cart_add_item: {
        Args: { p_product_id: string; p_variant_id?: string | null; p_quantity?: number };
        Returns: string;
      };
      toggle_wishlist: { Args: { p_product_id: string }; Returns: boolean };
      mark_notifications_read: { Args: { p_ids?: string[] | null }; Returns: number };
      apply_for_vendor: { Args: { p_documents?: Json }; Returns: VerificationStatus };
      approve_vendor: { Args: { p_user_id: string }; Returns: undefined };
      reject_vendor: { Args: { p_user_id: string; p_reason?: string }; Returns: undefined };
      increment_product_view: { Args: { p_product_id: string }; Returns: undefined };
      vendor_top_products: {
        Args: { p_limit?: number; p_days?: number };
        Returns: Array<{ product_id: string; product_name: string; units_sold: number; revenue: number }>;
      };
      vendor_daily_revenue: {
        Args: { p_days?: number };
        Returns: Array<{ day: string; revenue: number; orders: number; items: number }>;
      };
      public_homepage_feed: {
        Args: { p_limit?: number };
        Returns: Array<{
          bucket: 'trending' | 'featured' | 'newest';
          id: string;
          seller_id: string;
          name: string;
          slug: string | null;
          price: number;
          compare_at_price: number | null;
          image_url: string;
          category: string;
          rating_avg: number;
          rating_count: number;
          sales_count: number;
        }>;
      };
      admin_platform_stats: {
        Args: Record<string, never>;
        Returns: Array<{
          total_users: number;
          total_vendors: number;
          pending_vendors: number;
          total_products: number;
          total_orders: number;
          gmv_30d: number;
          orders_30d: number;
        }>;
      };
    };
    Enums: {
      user_role: UserRole;
      verification_status: VerificationStatus;
      product_status: ProductStatus;
      order_status: OrderStatus;
      payment_status: PaymentStatus;
      payment_provider: PaymentProvider;
      review_status: ReviewStatus;
      notification_type: NotificationType;
    };
  };
}
