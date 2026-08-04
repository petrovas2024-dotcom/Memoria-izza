-- Migración aditiva para alojar IZZA Smart fuera de ChatGPT Sites.
-- No elimina ni modifica registros existentes.

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null default 'Domicilio principal',
  address text not null,
  references text,
  neighborhood text,
  city text not null default 'Tijuana',
  postal_code text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  maps_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists properties_client_id_idx on public.properties(client_id);

create table if not exists public.property_photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  category text not null default 'Otra',
  description text,
  user_name text not null,
  storage_path text not null unique,
  content_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists property_photos_property_id_idx on public.property_photos(property_id);

alter table public.properties enable row level security;
alter table public.property_photos enable row level security;

drop policy if exists "office reads properties" on public.properties;
drop policy if exists "office manages properties" on public.properties;
drop policy if exists "office reads property photos" on public.property_photos;
drop policy if exists "office manages property photos" on public.property_photos;

create policy "office reads properties" on public.properties for select to authenticated
using (public.current_role() in ('admin','reception'));
create policy "office manages properties" on public.properties for all to authenticated
using (public.current_role() in ('admin','reception')) with check (public.current_role() in ('admin','reception'));
create policy "office reads property photos" on public.property_photos for select to authenticated
using (public.current_role() in ('admin','reception'));
create policy "office manages property photos" on public.property_photos for all to authenticated
using (public.current_role() in ('admin','reception')) with check (public.current_role() in ('admin','reception'));

insert into storage.buckets (id, name, public)
values ('property-photos', 'property-photos', false)
on conflict (id) do nothing;
