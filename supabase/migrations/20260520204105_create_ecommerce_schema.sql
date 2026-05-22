/*
  # E-Commerce Multi-Vendor Schema

  ## New Tables

  ### profiles
  - `id` (uuid, PK, references auth.users)
  - `store_name` (text) — public store display name
  - `store_slug` (text, unique) — URL-friendly identifier
  - `store_description` (text)
  - `store_logo_url` (text)
  - `whatsapp_number` (text) — orders redirect here
  - `banner_url` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### products
  - `id` (uuid, PK)
  - `seller_id` (uuid, FK → profiles.id)
  - `name` (text)
  - `description` (text)
  - `price` (numeric)
  - `image_url` (text)
  - `category` (text)
  - `in_stock` (boolean)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  - RLS enabled on both tables
  - profiles: owner can read/update their own profile; public can read all profiles
  - products: owner can CRUD their own products; public can read all in_stock products
*/

-- PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name text NOT NULL DEFAULT '',
  store_slug text UNIQUE,
  store_description text DEFAULT '',
  store_logo_url text DEFAULT '',
  whatsapp_number text DEFAULT '',
  banner_url text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read profiles"
  ON profiles FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Owners can update their profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Owners can insert their profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  description text DEFAULT '',
  price numeric(10,2) NOT NULL DEFAULT 0,
  image_url text DEFAULT '',
  category text DEFAULT '',
  in_stock boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read in-stock products"
  ON products FOR SELECT
  TO anon, authenticated
  USING (in_stock = true);

CREATE POLICY "Sellers can read all their products"
  ON products FOR SELECT
  TO authenticated
  USING (auth.uid() = seller_id);

CREATE POLICY "Sellers can insert their products"
  ON products FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Sellers can update their products"
  ON products FOR UPDATE
  TO authenticated
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

CREATE POLICY "Sellers can delete their products"
  ON products FOR DELETE
  TO authenticated
  USING (auth.uid() = seller_id);

-- AUTO-CREATE PROFILE ON SIGNUP
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- INDEXES
CREATE INDEX IF NOT EXISTS products_seller_id_idx ON products(seller_id);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category);
CREATE INDEX IF NOT EXISTS profiles_store_slug_idx ON profiles(store_slug);
