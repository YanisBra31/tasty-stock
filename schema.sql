-- ═══════════════════════════════════════════════════════════
--  TASTY STOCK — schema.sql
--  À coller dans : Supabase > SQL Editor > New Query > Run
-- ═══════════════════════════════════════════════════════════

-- ── EXTENSION UUID ────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── TABLE : restaurants ───────────────────────────────────
create table if not exists public.restaurants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  location    text not null default '',
  color       text not null default 'pink',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── TABLE : profiles (utilisateurs applicatifs) ───────────
-- On stocke ici les métadonnées liées à l'auth Supabase.
-- Chaque ligne correspond à un auth.users existant.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  role        text not null default 'Employé',  -- Administrateur | Gérant | Employé
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── TABLE : stock ─────────────────────────────────────────
create table if not exists public.stock (
  id           uuid primary key default gen_random_uuid(),
  resto_id     uuid not null references public.restaurants(id) on delete cascade,
  name         text not null,
  category     text not null default 'Autre',
  qty          integer not null default 0,
  min_qty      integer not null default 0,
  dlc          date,
  supplier     text not null default '',
  location     text not null default '',
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── TABLE : transfers ────────────────────────────────────
create table if not exists public.transfers (
  id           uuid primary key default gen_random_uuid(),
  from_resto   uuid not null references public.restaurants(id) on delete cascade,
  to_resto     uuid not null references public.restaurants(id) on delete cascade,
  item_name    text not null,
  qty          integer not null,
  created_at   timestamptz not null default now()
);

-- ── INDEX utiles ─────────────────────────────────────────
create index if not exists idx_stock_resto    on public.stock(resto_id);
create index if not exists idx_stock_dlc      on public.stock(dlc);
create index if not exists idx_transfers_from on public.transfers(from_resto);
create index if not exists idx_transfers_to   on public.transfers(to_resto);

-- ── TRIGGER : updated_at automatique ─────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_restaurants_updated
  before update on public.restaurants
  for each row execute function public.set_updated_at();

create or replace trigger trg_stock_updated
  before update on public.stock
  for each row execute function public.set_updated_at();

create or replace trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ── ROW LEVEL SECURITY (RLS) ──────────────────────────────
-- On active le RLS sur toutes les tables pour que seuls
-- les utilisateurs authentifiés puissent lire/écrire.

alter table public.restaurants enable row level security;
alter table public.stock        enable row level security;
alter table public.transfers    enable row level security;
alter table public.profiles     enable row level security;

-- Politique : tout utilisateur connecté peut tout lire/écrire.
-- (Affinez selon vos besoins : ex. restreindre delete aux admins)

create policy "auth_all_restaurants" on public.restaurants
  for all using (auth.role() = 'authenticated');

create policy "auth_all_stock" on public.stock
  for all using (auth.role() = 'authenticated');

create policy "auth_all_transfers" on public.transfers
  for all using (auth.role() = 'authenticated');

create policy "auth_all_profiles" on public.profiles
  for all using (auth.role() = 'authenticated');

-- ── TRIGGER : créer un profil automatiquement à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'Employé')
  );
  return new;
end;
$$;

create or replace trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── DONNÉES DE DÉMO (optionnel — à supprimer en prod) ────
-- Décommentez si vous voulez des données de test.
-- Les restaurants sont créés, le stock doit être ajouté via l'app.

/*
insert into public.restaurants (name, location, color) values
  ('Tasty Capitole', 'Toulouse Centre', 'pink'),
  ('Tasty Compans',  'Toulouse Nord',   'green');
*/

-- ═══════════════════════════════════════════════════════════
--  MODULE CAISSE (POS)
--  Point de vente : produits, ticket, équipe de caisse (PIN),
--  paramètres de paiement. Rattaché à un restaurant existant.
-- ═══════════════════════════════════════════════════════════

-- ── TABLE : pos_employees (équipe de caisse, code PIN) ────
-- Distincte de `profiles` : c'est l'équipe qui encaisse au
-- comptoir (serveurs, cuisine…), identifiée par un code PIN
-- à 4 chiffres plutôt qu'un compte Supabase complet.
create table if not exists public.pos_employees (
  id          uuid primary key default gen_random_uuid(),
  resto_id    uuid not null references public.restaurants(id) on delete cascade,
  name        text not null,
  pin         text not null,
  role        text not null default 'caissier', -- gerant | caissier | cuisine
  created_at  timestamptz not null default now()
);

-- ── TABLE : pos_products (catalogue caisse) ───────────────
create table if not exists public.pos_products (
  id          uuid primary key default gen_random_uuid(),
  resto_id    uuid not null references public.restaurants(id) on delete cascade,
  name        text not null,
  category    text not null default 'Sans catégorie',
  price       numeric(10,2) not null default 0,
  options     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── TABLE : pos_tickets (ventes encaissées) ───────────────
create table if not exists public.pos_tickets (
  id             uuid primary key default gen_random_uuid(),
  resto_id       uuid not null references public.restaurants(id) on delete cascade,
  number         integer not null,
  items          jsonb not null default '[]'::jsonb,
  subtotal       numeric(10,2) not null default 0,
  discount       jsonb,
  total          numeric(10,2) not null default 0,
  payment_mode   jsonb,
  cash_given     numeric(10,2),
  change         numeric(10,2),
  employee_name  text,
  status         text not null default 'en_attente', -- en_attente | prete
  created_at     timestamptz not null default now()
);

-- ── TABLE : pos_settings (1 ligne par restaurant) ─────────
create table if not exists public.pos_settings (
  resto_id            uuid primary key references public.restaurants(id) on delete cascade,
  auto_print_kitchen  boolean not null default true,
  payment_modes       jsonb not null default '[
    {"id":"cb","label":"Carte bleue","type":"card","requiresCash":false},
    {"id":"especes","label":"Espèces","type":"cash","requiresCash":true},
    {"id":"tr","label":"Ticket restaurant","type":"other","requiresCash":false}
  ]'::jsonb,
  updated_at          timestamptz not null default now()
);

-- ── TABLE : pos_presence (équipe de caisse "en ligne") ────
create table if not exists public.pos_presence (
  employee_id  uuid primary key,
  resto_id     uuid not null references public.restaurants(id) on delete cascade,
  name         text not null,
  role         text not null,
  last_seen    timestamptz not null default now()
);

-- ── INDEX utiles ─────────────────────────────────────────
create index if not exists idx_pos_employees_resto on public.pos_employees(resto_id);
create index if not exists idx_pos_products_resto  on public.pos_products(resto_id);
create index if not exists idx_pos_tickets_resto   on public.pos_tickets(resto_id);
create index if not exists idx_pos_tickets_created on public.pos_tickets(created_at);
create index if not exists idx_pos_presence_resto  on public.pos_presence(resto_id);

-- ── TRIGGER : updated_at automatique ─────────────────────
create or replace trigger trg_pos_products_updated
  before update on public.pos_products
  for each row execute function public.set_updated_at();

create or replace trigger trg_pos_settings_updated
  before update on public.pos_settings
  for each row execute function public.set_updated_at();

-- ── ROW LEVEL SECURITY (RLS) ──────────────────────────────
-- Même politique que le reste de l'app : tout utilisateur
-- TastyStock authentifié peut lire/écrire les données caisse.

alter table public.pos_employees enable row level security;
alter table public.pos_products  enable row level security;
alter table public.pos_tickets   enable row level security;
alter table public.pos_settings  enable row level security;
alter table public.pos_presence  enable row level security;

create policy "auth_all_pos_employees" on public.pos_employees
  for all using (auth.role() = 'authenticated');

create policy "auth_all_pos_products" on public.pos_products
  for all using (auth.role() = 'authenticated');

create policy "auth_all_pos_tickets" on public.pos_tickets
  for all using (auth.role() = 'authenticated');

create policy "auth_all_pos_settings" on public.pos_settings
  for all using (auth.role() = 'authenticated');

create policy "auth_all_pos_presence" on public.pos_presence
  for all using (auth.role() = 'authenticated');
