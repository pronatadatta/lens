-- ============================================================
-- Lens — Supabase setup script
-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. DATA LAYER: photos table
-- ------------------------------------------------------------
-- One row per photo. The actual image bytes live in Storage
-- (bucket 'lens'); this table is the ordered index over them.
--
-- NOTE: "order" is a reserved word in SQL, so it must be quoted
-- everywhere it is referenced (here and in every client query).

create table if not exists public.photos (
    id           uuid        primary key default gen_random_uuid(),
    created_at   timestamptz not null    default now(),
    storage_path text        not null    unique,   -- object key inside the 'lens' bucket
    "order"      integer     not null    default 0, -- manual sort position (ascending)
    display_name text                               -- human-readable label; nullable
);

-- The viewer always reads in display order, so index it.
create index if not exists photos_order_idx
    on public.photos ("order" asc, created_at asc);

-- ------------------------------------------------------------
-- 2. ROW-LEVEL SECURITY: photos table
-- ------------------------------------------------------------
-- Design decision: this is a personal, unauthenticated app.
-- The anon key is public by definition, so these policies
-- deliberately grant the anon role full read/insert/delete.
-- If Lens ever becomes multi-user, replace these with
-- auth.uid()-scoped policies.

alter table public.photos enable row level security;

drop policy if exists "Public can view photos"   on public.photos;
drop policy if exists "Public can insert photos" on public.photos;
drop policy if exists "Public can delete photos" on public.photos;
drop policy if exists "Public can reorder photos" on public.photos;

create policy "Public can view photos"
    on public.photos for select
    to anon, authenticated
    using (true);

create policy "Public can insert photos"
    on public.photos for insert
    to anon, authenticated
    with check (true);

create policy "Public can delete photos"
    on public.photos for delete
    to anon, authenticated
    using (true);

-- Needed so the uploader page can rewrite "order" when photos
-- are rearranged or renamed.
create policy "Public can reorder photos"
    on public.photos for update
    to anon, authenticated
    using (true)
    with check (true);

-- ------------------------------------------------------------
-- 3. STORAGE: 'lens' bucket + object policies
-- ------------------------------------------------------------
-- public = true lets the viewer fetch images via the plain
-- public URL (…/storage/v1/object/public/lens/<path>) with no
-- auth header — important because the glasses' browser fetches
-- <img> tags directly, with no way to attach headers.

insert into storage.buckets (id, name, public)
values ('lens', 'lens', true)
on conflict (id) do nothing;

-- Policies live on storage.objects and are scoped to this
-- bucket only — they do not open up any other bucket.

drop policy if exists "Public read for lens bucket"   on storage.objects;
drop policy if exists "Public upload to lens bucket"  on storage.objects;
drop policy if exists "Public delete from lens bucket" on storage.objects;

create policy "Public read for lens bucket"
    on storage.objects for select
    to anon, authenticated
    using (bucket_id = 'lens');

create policy "Public upload to lens bucket"
    on storage.objects for insert
    to anon, authenticated
    with check (bucket_id = 'lens');

create policy "Public delete from lens bucket"
    on storage.objects for delete
    to anon, authenticated
    using (bucket_id = 'lens');
