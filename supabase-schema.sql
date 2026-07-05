create extension if not exists "pgcrypto";

create table if not exists public.audio (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  mime_type text not null,
  duration_ms integer not null,
  size_bytes integer not null,
  transcript_text text,
  transcript_status text not null default 'pending',
  transcript_error text,
  transcribed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.audio
add column if not exists transcript_text text,
add column if not exists transcript_status text not null default 'pending',
add column if not exists transcript_error text,
add column if not exists transcribed_at timestamptz;

insert into storage.buckets (id, name, public)
values ('audio-reminders', 'audio-reminders', false)
on conflict (id) do nothing;

alter table public.audio enable row level security;

drop policy if exists "Allow anonymous audio inserts" on public.audio;
drop policy if exists "Allow anonymous audio reads" on public.audio;
drop policy if exists "Allow anonymous audio deletes" on public.audio;
drop policy if exists "Allow anonymous audio uploads" on storage.objects;
drop policy if exists "Allow anonymous audio storage reads" on storage.objects;
drop policy if exists "Allow anonymous audio deletes" on storage.objects;

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

create policy "Allow anonymous audio deletes"
on public.audio
for delete
to anon, authenticated
using (true);

create policy "Allow anonymous audio uploads"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'audio-reminders');

create policy "Allow anonymous audio storage reads"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'audio-reminders');

create policy "Allow anonymous audio deletes"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'audio-reminders');

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  audio_id uuid references public.audio(id) on delete set null,

  reminder_text text not null,
  category text not null default 'Personal',
  original_transcript text,

  due_date date not null,
  due_time time not null,
  due_at timestamptz not null,

  date_phrase text,
  time_phrase text,
  date_resolution text not null,

  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reminders
add column if not exists category text not null default 'Personal';

alter table public.reminders enable row level security;

drop policy if exists "Allow anonymous reminder inserts" on public.reminders;
drop policy if exists "Allow anonymous reminder reads" on public.reminders;
drop policy if exists "Allow anonymous reminder deletes" on public.reminders;

create policy "Allow anonymous reminder inserts"
on public.reminders
for insert
to anon, authenticated
with check (true);

create policy "Allow anonymous reminder reads"
on public.reminders
for select
to anon, authenticated
using (true);

create policy "Allow anonymous reminder deletes"
on public.reminders
for delete
to anon, authenticated
using (true);
