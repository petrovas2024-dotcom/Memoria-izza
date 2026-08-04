-- IZZA SMART · Esquema inicial para Supabase/PostgreSQL
create extension if not exists "pgcrypto";

create type public.app_role as enum ('admin', 'technician', 'reception');
create type public.service_priority as enum ('normal', 'urgent', 'emergency');
create type public.appointment_status as enum ('received','pending_confirmation','confirmed','assigned','on_the_way','in_progress','paused','completed','cancelled','rescheduled');
create type public.quote_status as enum ('draft','sent','approved','rejected');

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name public.app_role unique not null,
  description text
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'reception',
  full_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  company text,
  phone text not null,
  whatsapp text,
  email text,
  address text not null,
  neighborhood text,
  city text not null default 'Tijuana, Baja California',
  address_references text,
  rfc text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users(id) on delete set null,
  name text not null,
  phone text not null,
  specialty text[] not null default '{}',
  schedule jsonb not null default '{}',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.service_types (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  active boolean not null default true,
  default_duration_minutes integer check (default_duration_minutes > 0),
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  folio text unique not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  technician_id uuid references public.technicians(id) on delete set null,
  service_type_id uuid references public.service_types(id) on delete set null,
  address text not null,
  maps_url text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  priority public.service_priority not null default 'normal',
  status public.appointment_status not null default 'received',
  notes text,
  estimated_amount numeric(12,2) not null default 0 check (estimated_amount >= 0),
  advance numeric(12,2) not null default 0 check (advance >= 0),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (advance <= estimated_amount)
);
create index appointments_schedule_idx on public.appointments(technician_id, starts_at, ends_at);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  folio text unique not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  quote_date date not null default current_date,
  status public.quote_status not null default 'draft',
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  advance numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  validity text,
  warranty text,
  estimated_time text,
  payment_terms text,
  observations text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position integer not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit text not null,
  concept text not null,
  description text,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  amount numeric(12,2) generated always as (quantity * unit_price) stored,
  unique (quote_id, position)
);

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  folio text unique not null,
  appointment_id uuid references public.appointments(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete restrict,
  technician_id uuid references public.technicians(id) on delete set null,
  scheduled_at timestamptz,
  diagnosis text,
  work_performed text,
  materials jsonb not null default '[]',
  recommendations text,
  warranty text,
  client_signature_path text,
  technician_signature_path text,
  status public.appointment_status not null default 'assigned',
  total numeric(12,2) not null default 0,
  advance numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.work_order_photos (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  category text not null check (category in ('before','during','after')),
  storage_path text not null,
  description text,
  uploaded_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  folio text unique not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  quote_id uuid references public.quotes(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  paid_at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','transfer','card','deposit','other')),
  payment_type text not null check (payment_type in ('advance','partial','settlement')),
  reference text,
  notes text,
  recorded_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value jsonb not null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;
alter table public.technicians enable row level security;
alter table public.appointments enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_photos enable row level security;
alter table public.payments enable row level security;
alter table public.settings enable row level security;

create or replace function public.current_role() returns public.app_role language sql stable security definer
set search_path = public as $$ select role from public.users where id = auth.uid() $$;

create policy "staff read clients" on public.clients for select to authenticated using (true);
create policy "office manages clients" on public.clients for all to authenticated using (public.current_role() in ('admin','reception')) with check (public.current_role() in ('admin','reception'));
create policy "staff read appointments" on public.appointments for select to authenticated using (
  public.current_role() in ('admin','reception') or technician_id = (select id from public.technicians where user_id = auth.uid())
);
create policy "office manages appointments" on public.appointments for all to authenticated using (public.current_role() in ('admin','reception')) with check (public.current_role() in ('admin','reception'));
create policy "technician updates own appointments" on public.appointments for update to authenticated using (technician_id = (select id from public.technicians where user_id = auth.uid()));
create policy "authenticated read operational records" on public.quotes for select to authenticated using (true);
create policy "authenticated read quote items" on public.quote_items for select to authenticated using (true);
create policy "authenticated read orders" on public.work_orders for select to authenticated using (true);
create policy "authenticated read photos" on public.work_order_photos for select to authenticated using (true);
create policy "office manages quotes" on public.quotes for all to authenticated using (public.current_role() in ('admin','reception')) with check (public.current_role() in ('admin','reception'));
create policy "office manages quote items" on public.quote_items for all to authenticated using (public.current_role() in ('admin','reception')) with check (public.current_role() in ('admin','reception'));
create policy "technicians update own orders" on public.work_orders for update to authenticated using (technician_id = (select id from public.technicians where user_id = auth.uid()));
create policy "technicians add own photos" on public.work_order_photos for insert to authenticated with check (
  exists (select 1 from public.work_orders wo join public.technicians t on t.id = wo.technician_id where wo.id = work_order_id and t.user_id = auth.uid())
);
create policy "office manages payments" on public.payments for all to authenticated using (public.current_role() in ('admin','reception')) with check (public.current_role() in ('admin','reception'));
create policy "admin manages settings" on public.settings for all to authenticated using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

insert into public.roles(name, description) values
('admin','Acceso completo'),('technician','Servicios asignados y evidencia'),('reception','Clientes, citas, cotizaciones y pagos')
on conflict do nothing;

insert into public.service_types(name, default_duration_minutes) values
('Plomería',120),('Electricidad',120),('Boilers',120),('Bombas de agua',150),('Tinacos',180),
('Impermeabilización',240),('Refrigeración',150),('Minisplit',120),('Pintura',240),('Mantenimiento general',120)
on conflict do nothing;

-- Autenticación y autorización reforzada (seguro al ejecutar sobre una base existente)
alter table public.users enable row level security;
alter table public.roles enable row level security;

drop policy if exists "staff read clients" on public.clients;
drop policy if exists "authenticated read operational records" on public.quotes;
drop policy if exists "authenticated read quote items" on public.quote_items;
drop policy if exists "authenticated read orders" on public.work_orders;
drop policy if exists "authenticated read photos" on public.work_order_photos;
drop policy if exists "office manages payments" on public.payments;
drop policy if exists "technician updates own appointments" on public.appointments;
drop policy if exists "technicians update own orders" on public.work_orders;
drop policy if exists "technicians add own photos" on public.work_order_photos;

create policy "user reads own profile" on public.users for select to authenticated
using (id = auth.uid() or public.current_role() = 'admin');
create policy "admin manages profiles" on public.users for all to authenticated
using (public.current_role() = 'admin') with check (public.current_role() = 'admin');
create policy "authenticated reads roles" on public.roles for select to authenticated using (true);

create policy "office reads clients" on public.clients for select to authenticated
using (public.current_role() in ('admin','reception'));
create policy "office reads quotes" on public.quotes for select to authenticated
using (public.current_role() in ('admin','reception'));
create policy "office reads quote items" on public.quote_items for select to authenticated
using (public.current_role() in ('admin','reception'));
create policy "assigned technician or office reads orders" on public.work_orders for select to authenticated using (
  public.current_role() in ('admin','reception') or
  technician_id = (select id from public.technicians where user_id = auth.uid())
);
create policy "assigned technician or office reads photos" on public.work_order_photos for select to authenticated using (
  public.current_role() in ('admin','reception') or exists (
    select 1 from public.work_orders wo join public.technicians t on t.id = wo.technician_id
    where wo.id = work_order_id and t.user_id = auth.uid()
  )
);
create policy "technician updates assigned appointment" on public.appointments for update to authenticated
using (technician_id = (select id from public.technicians where user_id = auth.uid()))
with check (technician_id = (select id from public.technicians where user_id = auth.uid()));
create policy "technician updates assigned order" on public.work_orders for update to authenticated
using (technician_id = (select id from public.technicians where user_id = auth.uid()))
with check (technician_id = (select id from public.technicians where user_id = auth.uid()));
create policy "technician inserts assigned photos" on public.work_order_photos for insert to authenticated with check (
  uploaded_by = auth.uid() and exists (
    select 1 from public.work_orders wo join public.technicians t on t.id = wo.technician_id
    where wo.id = work_order_id and t.user_id = auth.uid()
  )
);
create policy "admin manages payments" on public.payments for all to authenticated
using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- El administrador relaciona el UUID de Auth con el técnico correspondiente.
-- Ejemplo (reemplazar UUIDs): update public.technicians set user_id = '<auth-user-id>' where id = '<technician-id>';

-- Cotizador de materiales (seguro al ejecutar sobre una base existente)
create table if not exists public.material_quotes (
  id uuid primary key default gen_random_uuid(),
  folio text unique not null,
  work_order_id uuid not null unique references public.work_orders(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  technician_id uuid references public.technicians(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected')),
  apply_tax boolean not null default false,
  tax_rate numeric(6,2) not null default 16,
  discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  additional_charges numeric(12,2) not null default 0,
  markup_percent numeric(7,2) not null default 0,
  labor numeric(12,2) not null default 0,
  notes text,
  created_by uuid references public.users(id),
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_quote_items (
  id uuid primary key default gen_random_uuid(),
  material_quote_id uuid not null references public.material_quotes(id) on delete cascade,
  position integer not null,
  group_key uuid not null default gen_random_uuid(),
  name text not null,
  description text,
  brand text,
  model text,
  unit text not null default 'pieza',
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  supplier text,
  product_url text,
  image_url text,
  notes text,
  availability text,
  consulted_at date not null default current_date,
  selected boolean not null default true,
  created_at timestamptz not null default now(),
  unique(material_quote_id, position)
);

alter table public.material_quotes enable row level security;
alter table public.material_quote_items enable row level security;

drop policy if exists "office manages material quotes" on public.material_quotes;
drop policy if exists "technician manages assigned material quotes" on public.material_quotes;
drop policy if exists "office manages material items" on public.material_quote_items;
drop policy if exists "technician manages assigned material items" on public.material_quote_items;

create policy "office manages material quotes" on public.material_quotes for all to authenticated
using (public.current_role() in ('admin','reception'))
with check (public.current_role() in ('admin','reception'));
create policy "technician manages assigned material quotes" on public.material_quotes for all to authenticated
using (technician_id = (select id from public.technicians where user_id = auth.uid()))
with check (
  technician_id = (select id from public.technicians where user_id = auth.uid())
  and status in ('draft','pending')
);
create policy "office manages material items" on public.material_quote_items for all to authenticated
using (public.current_role() in ('admin','reception'))
with check (public.current_role() in ('admin','reception'));
create policy "technician manages assigned material items" on public.material_quote_items for all to authenticated
using (exists (
  select 1 from public.material_quotes mq join public.technicians t on t.id = mq.technician_id
  where mq.id = material_quote_id and t.user_id = auth.uid()
))
with check (exists (
  select 1 from public.material_quotes mq join public.technicians t on t.id = mq.technician_id
  where mq.id = material_quote_id and t.user_id = auth.uid() and mq.status in ('draft','pending')
));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('material-products','material-products',false,8000000,array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "material product images by assigned staff" on storage.objects;
create policy "material product images by assigned staff" on storage.objects for all to authenticated
using (
  bucket_id = 'material-products' and (
    public.current_role() in ('admin','reception') or exists (
      select 1 from public.work_orders wo join public.technicians t on t.id = wo.technician_id
      where wo.id::text = split_part(name,'/',1) and t.user_id = auth.uid()
    )
  )
)
with check (
  bucket_id = 'material-products' and (
    public.current_role() in ('admin','reception') or exists (
      select 1 from public.work_orders wo join public.technicians t on t.id = wo.technician_id
      where wo.id::text = split_part(name,'/',1) and t.user_id = auth.uid()
    )
  )
);
