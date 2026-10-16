create table if not exists public.profiles (
  id text primary key,
  display_name text,
  avatar_url text,
  min_confidence real not null default 0.4,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles self select" on public.profiles for select to authenticated using (id = (select auth.jwt()->>'sub'));
create policy "profiles self insert" on public.profiles for insert to authenticated with check (id = (select auth.jwt()->>'sub'));
create policy "profiles self update" on public.profiles for update to authenticated using (id = (select auth.jwt()->>'sub')) with check (id = (select auth.jwt()->>'sub'));

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default (auth.jwt()->>'sub'),
  name text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.devices enable row level security;
create policy "devices owner select" on public.devices for select to authenticated using (user_id = (select auth.jwt()->>'sub'));
create policy "devices owner insert" on public.devices for insert to authenticated with check (user_id = (select auth.jwt()->>'sub'));
create policy "devices owner delete" on public.devices for delete to authenticated using (user_id = (select auth.jwt()->>'sub'));

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default (auth.jwt()->>'sub'),
  device_id uuid references public.devices(id) on delete set null,
  source text not null default 'phone' check (source in ('phone','device')),
  species_common text not null,
  species_scientific text,
  confidence real not null,
  alternatives jsonb,
  observed_at timestamptz not null default now(),
  lat double precision,
  lon double precision,
  place_name text,
  habitat text check (habitat in ('garden','park','forest','water','urban','farm')),
  audio_path text,
  audio_duration_s real,
  isolation_score real,
  favourite boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists obs_user_time on public.observations (user_id, observed_at desc);
create index if not exists obs_user_species on public.observations (user_id, species_common);
alter table public.observations enable row level security;
create policy "obs owner select" on public.observations for select to authenticated using (user_id = (select auth.jwt()->>'sub'));
create policy "obs owner insert" on public.observations for insert to authenticated with check (user_id = (select auth.jwt()->>'sub'));
create policy "obs owner update" on public.observations for update to authenticated using (user_id = (select auth.jwt()->>'sub')) with check (user_id = (select auth.jwt()->>'sub'));
create policy "obs owner delete" on public.observations for delete to authenticated using (user_id = (select auth.jwt()->>'sub'));

create or replace view public.life_list with (security_invoker = true) as
select user_id, species_common, max(species_scientific) as species_scientific,
  min(observed_at) as first_seen, max(observed_at) as last_seen, count(*) as sightings,
  max(confidence) as best_confidence
from public.observations group by user_id, species_common;
grant select on public.life_list to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings','recordings',false, 5242880, array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/opus','video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;
create policy "rec owner read" on storage.objects for select to authenticated using (bucket_id='recordings' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));
create policy "rec owner insert" on storage.objects for insert to authenticated with check (bucket_id='recordings' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));
create policy "rec owner delete" on storage.objects for delete to authenticated using (bucket_id='recordings' and (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));
