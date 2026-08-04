-- IZZA Smart · Punto 2: Supabase Auth, perfiles y roles
-- Migración aditiva e idempotente. No elimina usuarios ni datos operativos.

create extension if not exists "pgcrypto";

alter table public.users enable row level security;
alter table public.roles enable row level security;
alter table public.technicians enable row level security;

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.users
  where id = auth.uid() and active = true
$$;

revoke all on function public.current_role() from public;
grant execute on function public.current_role() to authenticated;

create or replace function public.handle_izza_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  requested_role public.app_role;
  display_name text;
  user_phone text;
begin
  requested_role :=
    case
      when lower(new.email) = 'petrovas2024@gmail.com' then 'admin'::public.app_role
      when new.raw_app_meta_data ->> 'role' in ('admin', 'reception', 'technician')
        then (new.raw_app_meta_data ->> 'role')::public.app_role
      else 'reception'::public.app_role
    end;

  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(new.email, 'Usuario IZZA'), '@', 1)
  );
  user_phone := coalesce(
    nullif(new.phone, ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  );

  insert into public.users (id, role, full_name, phone, active)
  values (new.id, requested_role, display_name, user_phone, true)
  on conflict (id) do update
    set full_name = coalesce(nullif(excluded.full_name, ''), public.users.full_name),
        phone = coalesce(excluded.phone, public.users.phone);

  if requested_role = 'technician' then
    insert into public.technicians (user_id, name, phone, active)
    values (new.id, display_name, coalesce(user_phone, 'Pendiente'), true)
    on conflict (user_id) do update
      set name = excluded.name,
          phone = case
            when excluded.phone = 'Pendiente' then public.technicians.phone
            else excluded.phone
          end;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_izza on auth.users;
create trigger on_auth_user_created_izza
after insert or update of email, phone, raw_user_meta_data, raw_app_meta_data
on auth.users
for each row execute function public.handle_izza_auth_user();

-- Completa únicamente perfiles faltantes de cuentas ya creadas.
insert into public.users (id, role, full_name, phone, active)
select
  au.id,
  case
    when lower(au.email) = 'petrovas2024@gmail.com' then 'admin'::public.app_role
    when au.raw_app_meta_data ->> 'role' in ('admin', 'reception', 'technician')
      then (au.raw_app_meta_data ->> 'role')::public.app_role
    else 'reception'::public.app_role
  end,
  coalesce(
    nullif(au.raw_user_meta_data ->> 'full_name', ''),
    nullif(au.raw_user_meta_data ->> 'name', ''),
    split_part(coalesce(au.email, 'Usuario IZZA'), '@', 1)
  ),
  coalesce(nullif(au.phone, ''), nullif(au.raw_user_meta_data ->> 'phone', '')),
  true
from auth.users au
where not exists (select 1 from public.users u where u.id = au.id);

-- La cuenta propietaria siempre conserva el rol Administrador.
update public.users u
set role = 'admin', active = true
from auth.users au
where u.id = au.id and lower(au.email) = 'petrovas2024@gmail.com';

insert into public.technicians (user_id, name, phone, active)
select u.id, u.full_name, coalesce(u.phone, 'Pendiente'), u.active
from public.users u
where u.role = 'technician'
  and not exists (select 1 from public.technicians t where t.user_id = u.id);

drop policy if exists "user reads own profile" on public.users;
drop policy if exists "admin manages profiles" on public.users;
drop policy if exists "authenticated reads roles" on public.roles;
drop policy if exists "staff reads technicians" on public.technicians;
drop policy if exists "admin manages technicians" on public.technicians;

create policy "user reads own profile"
on public.users for select to authenticated
using (id = auth.uid() or public.current_role() = 'admin');

create policy "admin manages profiles"
on public.users for all to authenticated
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

create policy "authenticated reads roles"
on public.roles for select to authenticated
using (true);

create policy "staff reads technicians"
on public.technicians for select to authenticated
using (
  public.current_role() in ('admin', 'reception')
  or user_id = auth.uid()
);

create policy "admin manages technicians"
on public.technicians for all to authenticated
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

grant select on public.roles to authenticated;
grant select on public.users to authenticated;
grant select on public.technicians to authenticated;

