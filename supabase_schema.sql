-- =============================================================================
-- HVLN Shop - Clean & Safe Supabase PostgreSQL Schema
-- Paste and run this entire script in the Supabase SQL Editor.
-- Safe to re-run at any time (idempotent).
-- =============================================================================

-- 1. Automatic updated_at trigger function
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- 2.1 Owners Table (Store Admin / Owner credentials)
create table if not exists public.owners (
  id bigserial primary key,
  name text not null default 'HVLN Shop Owner',
  username text not null unique,
  password text not null,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_owners_updated_at on public.owners;
create trigger set_owners_updated_at
  before update on public.owners
  for each row execute function public.handle_updated_at();

-- 2.2 Suppliers Table
create table if not exists public.suppliers (
  id bigserial primary key,
  supplier_number text not null unique,
  name text not null,
  contact text not null default '',
  email text not null default '',
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.handle_updated_at();

-- 2.3 Products Table (includes inventory stock, supplier, and expiration details)
create table if not exists public.products (
  id bigserial primary key,
  name text not null,
  price numeric(10, 2) not null default 0 check (price >= 0),
  category text not null default 'Uncategorized',
  image text not null default '',
  description text not null default '',
  sizes text not null default '35-36, 37-38, 39-40, 41-42, 43-44',
  stock integer not null default 0 check (stock >= 0),
  supplier_id bigint references public.suppliers(id) on delete set null,
  expiration_date text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_supplier_id on public.products(supplier_id);

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.handle_updated_at();

-- 2.4 Customers Table
create table if not exists public.customers (
  id bigserial primary key,
  customer_number text unique,
  name text not null,
  username text not null unique,
  password text not null,
  email text not null,
  contact text not null default '',
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_username on public.customers(username);

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at
  before update on public.customers
  for each row execute function public.handle_updated_at();

-- 2.5 Orders Table (supports both Online Customer Orders and Owner POS Sales)
create table if not exists public.orders (
  id text primary key, -- e.g. 'ORD-1732410000000' or 'POS-1732410000000'
  order_date text not null default '',
  customer_username text references public.customers(username) on update cascade on delete set null,
  buyer jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  buyer_name text not null default '',
  buyer_username text not null default '',
  buyer_email text not null default '',
  buyer_contact text not null default '',
  buyer_address text not null default '',
  total numeric(10, 2) not null default 0 check (total >= 0),
  payment text not null default 'Cash',
  status text not null default 'Pending',
  return_reason text,
  return_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_customer_username on public.orders(customer_username);
create index if not exists idx_orders_created_at on public.orders(created_at desc);

drop trigger if exists set_orders_updated_at on public.orders;
create trigger set_orders_updated_at
  before update on public.orders
  for each row execute function public.handle_updated_at();

-- 2.6 Order Items Table (normalized line items for orders)
create table if not exists public.order_items (
  id bigserial primary key,
  order_id text not null references public.orders(id) on delete cascade,
  product_id bigint references public.products(id) on delete set null,
  name text not null,
  image text not null default '',
  size text not null default '',
  price numeric(10, 2) not null default 0 check (price >= 0),
  quantity integer not null default 1 check (quantity > 0),
  subtotal numeric(10, 2) not null default 0 check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order_id on public.order_items(order_id);
create index if not exists idx_order_items_product_id on public.order_items(product_id);

-- 2.7 Reviews Table
create table if not exists public.reviews (
  id bigserial primary key,
  name text not null,
  username text references public.customers(username) on update cascade on delete set null,
  rating smallint not null default 5 check (rating >= 1 and rating <= 5),
  comment text not null,
  review_date text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_username on public.reviews(username);

-- =============================================================================
-- 3. ROW LEVEL SECURITY (RLS) & DATA API GRANTS
-- =============================================================================
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter table public.owners enable row level security;
alter table public.suppliers enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "Allow app access to owners" on public.owners;
create policy "Allow app access to owners"
  on public.owners for select
  to anon, authenticated
  using (true);

drop policy if exists "Allow app access to suppliers" on public.suppliers;
create policy "Allow app access to suppliers"
  on public.suppliers for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow app access to products" on public.products;
create policy "Allow app access to products"
  on public.products for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow app access to customers" on public.customers;
create policy "Allow app access to customers"
  on public.customers for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow app access to orders" on public.orders;
create policy "Allow app access to orders"
  on public.orders for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow app access to order_items" on public.order_items;
create policy "Allow app access to order_items"
  on public.order_items for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Allow app access to reviews" on public.reviews;
create policy "Allow app access to reviews"
  on public.reviews for all
  to anon, authenticated
  using (true)
  with check (true);

-- =============================================================================
-- 4. SEED DEFAULT DATA (Owner, Products & Reviews)
-- =============================================================================

-- Default Owner Account (anthony / ADMINBSCS)
insert into public.owners (id, name, username, password, role)
values (1, 'HVLN Shop Owner', 'anthony', 'ADMINBSCS', 'owner')
on conflict (username) do update set
  name = excluded.name,
  password = excluded.password,
  role = excluded.role;

select setval(
  pg_get_serial_sequence('public.owners', 'id'),
  coalesce((select max(id) from public.owners), 1),
  true
);

-- Default Products
insert into public.products (id, name, price, category, image, description, sizes, stock)
values
  (1, 'Havaianas Top', 1500.00, 'Flip-Flops', 'Images/flipflop(marine blue).png', 'Classic and durable Havaianas flip-flops.', '35-36, 37-38, 39-40, 41-42, 43-44', 20),
  (2, 'Havaianas Slim', 899.00, 'Flip-Flops', 'https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=800&q=80', 'Slim and stylish flip-flops.', '35-36, 37-38, 39-40, 41-42', 15),
  (3, 'Havaianas You', 999.00, 'Sandals', 'https://images.unsplash.com/photo-1562273138-f46be4ebdf33?auto=format&fit=crop&w=800&q=80', 'Stylish sandals for everyday use.', '35-36, 37-38, 39-40, 41-42', 12),
  (4, 'Havaianas Casual', 799.00, 'Slippers', 'https://images.unsplash.com/photo-1562273138-f46be4ebdf33?auto=format&fit=crop&w=800&q=80', 'Simple and comfortable footwear.', '35-36, 37-38, 39-40, 41-42, 43-44', 18),
  (5, 'Havaianas Street', 1099.00, 'Sandals', 'https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=800&q=80', 'Perfect for casual outdoor activities.', '35-36, 37-38, 39-40, 41-42', 10),
  (6, 'Havaianas Classic', 749.00, 'Flip-Flops', 'https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=800&q=80', 'Classic and comfortable Havaianas.', '35-36, 37-38, 39-40, 41-42, 43-44', 25)
on conflict (id) do update set
  name = excluded.name,
  price = excluded.price,
  category = excluded.category,
  image = excluded.image,
  description = excluded.description,
  sizes = excluded.sizes;

select setval(
  pg_get_serial_sequence('public.products', 'id'),
  coalesce((select max(id) from public.products), 1),
  true
);

-- Default Reviews
insert into public.reviews (id, name, rating, comment, review_date)
values
  (1, 'Happy Customer', 5, 'Very comfortable and good quality!', ''),
  (2, 'Satisfied Buyer', 5, 'Fast and convenient ordering process.', '')
on conflict (id) do nothing;

select setval(
  pg_get_serial_sequence('public.reviews', 'id'),
  coalesce((select max(id) from public.reviews), 1),
  true
);
