create extension if not exists "pgcrypto";

create table if not exists public.audio (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  mime_type text not null,
  duration_ms integer not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('audio-reminders', 'audio-reminders', false)
on conflict (id) do nothing;

alter table public.audio enable row level security;

drop policy if exists "Allow anonymous audio inserts" on public.audio;
drop policy if exists "Allow anonymous audio reads" on public.audio;
drop policy if exists "Allow anonymous audio uploads" on storage.objects;

create policy "Allow anonymous audio inserts"
on public.audio
for insert
to anon, authenticated
with check (true);

create policy "Allow anonymous audio reads"
on public.audio
for select
to anon, authenticated
using (true);

create policy "Allow anonymous audio uploads"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'audio-reminders');
