-- Drewbix Blocks — flows table with RLS

create table if not exists flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_email text,
  data jsonb not null,
  is_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table flows enable row level security;

-- Authenticated users can read all flows
create policy "auth_read_flows"
  on flows for select
  using (auth.role() = 'authenticated');

-- Users can insert/update their own flows (owner_email matches, or is_default flows)
create policy "auth_write_own_flows"
  on flows for all
  using (auth.email() = owner_email or is_default = true);
