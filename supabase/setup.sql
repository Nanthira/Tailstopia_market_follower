-- Run this in Supabase SQL Editor after creating the tables shown in your diagram.
-- The app expects these exact table/column names and stores no seller identity.

-- The price-report foreign keys point to the item and admin tables.
do $$
declare wrong_fk record;
begin
  -- market_settings.id is a setting-row key, not an item reference. If the
  -- diagram editor accidentally linked these two id columns, remove that FK.
  for wrong_fk in
    select conname from pg_constraint
    where conrelid = 'public.market_settings'::regclass
      and confrelid = 'public.item'::regclass and contype = 'f'
  loop
    execute format('alter table public.market_settings drop constraint %I', wrong_fk.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'price_reports_item_id_fkey') then
    alter table public.price_reports add constraint price_reports_item_id_fkey
      foreign key (item_id) references public.item(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'price_reports_created_by_fkey') then
    alter table public.price_reports add constraint price_reports_created_by_fkey
      foreign key (created_by) references public.admins(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'price_reports_reviewed_by_fkey') then
    alter table public.price_reports add constraint price_reports_reviewed_by_fkey
      foreign key (reviewed_by) references public.admins(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'market_settings_updated_by_fkey') then
    alter table public.market_settings add constraint market_settings_updated_by_fkey
      foreign key (updated_by) references public.admins(id) on delete set null;
  end if;
end $$;

-- Login names must be unique. Passwords must be bcrypt hashes generated with
-- `npm run admin:hash`; never insert a plain-text password.
alter table public.admins alter column id set default gen_random_uuid();
create unique index if not exists admins_username_unique on public.admins (lower(username));

-- Reports use these values; prices can be NULL when only the other currency
-- was provided. That lets the app convert dynamically using the current rate.
alter table public.price_reports enable row level security;
alter table public.item enable row level security;
alter table public.market_settings enable row level security;
alter table public.admins enable row level security;

-- The app's Node server uses SUPABASE_SECRET_KEY and performs database calls
-- server-side. The secret key bypasses RLS. Do not put it in Vite/browser code.

-- Public item photos. Uploads are performed by the authenticated Node app via
-- its server-only secret key; the public bucket lets browser cards display them.
insert into storage.buckets (id, name, public)
values ('item-images', 'item-images', true)
on conflict (id) do update set public = true;
