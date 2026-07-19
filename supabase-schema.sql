create extension if not exists "pgcrypto";

create table if not exists public.audio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
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
add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid(),
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
drop policy if exists "Users manage own audio" on public.audio;
drop policy if exists "Users upload own audio" on storage.objects;
drop policy if exists "Users read own audio storage" on storage.objects;
drop policy if exists "Users delete own audio storage" on storage.objects;

create policy "Users manage own audio"
on public.audio
for all to authenticated
using (user_id = auth.uid() and lower(auth.jwt() ->> 'email') like '%@gmail.com')
with check (user_id = auth.uid() and lower(auth.jwt() ->> 'email') like '%@gmail.com');

create policy "Users upload own audio"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'audio-reminders' and (storage.foldername(name))[1] = auth.uid()::text and lower(auth.jwt() ->> 'email') like '%@gmail.com');

create policy "Users read own audio storage"
on storage.objects
for select
to authenticated
using (bucket_id = 'audio-reminders' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users delete own audio storage"
on storage.objects
for delete
to authenticated
using (bucket_id = 'audio-reminders' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade default auth.uid(),
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
add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid(),
add column if not exists category text not null default 'Personal';

alter table public.reminders enable row level security;

drop policy if exists "Allow anonymous reminder inserts" on public.reminders;
drop policy if exists "Allow anonymous reminder reads" on public.reminders;
drop policy if exists "Allow anonymous reminder updates" on public.reminders;
drop policy if exists "Allow anonymous reminder deletes" on public.reminders;
drop policy if exists "Users manage own reminders" on public.reminders;

create policy "Users manage own reminders"
on public.reminders
for all to authenticated
using (user_id = auth.uid() and lower(auth.jwt() ->> 'email') like '%@gmail.com')
with check (user_id = auth.uid() and lower(auth.jwt() ->> 'email') like '%@gmail.com');

-- Web Push fields default to false so reminders that existed before this migration
-- are never dispatched. The application explicitly opts new reminders in.
alter table public.reminders
add column if not exists push_eligible boolean not null default false,
add column if not exists push_notified_at timestamptz;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz
);

alter table public.push_subscriptions
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create table if not exists public.push_deliveries (
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'retry', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  primary key (reminder_id, subscription_id)
);

alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from anon, authenticated;

create or replace function public.claim_due_push_deliveries(batch_size integer default 100)
returns table (
  reminder_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  reminder_text text,
  due_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_deliveries (reminder_id, subscription_id)
  select r.id, s.id
  from public.reminders r
  join public.push_subscriptions s on s.user_id = r.user_id
  where r.status = 'pending'
    and r.push_eligible
    and r.push_notified_at is null
    and r.due_at <= now()
  on conflict do nothing;

  update public.push_deliveries
  set status = 'retry', next_attempt_at = now(), claimed_at = null
  where status = 'processing' and claimed_at < now() - interval '5 minutes';

  return query
  with claimed as (
    select d.reminder_id, d.subscription_id
    from public.push_deliveries d
    join public.reminders r on r.id = d.reminder_id
    join public.push_subscriptions s on s.id = d.subscription_id and s.user_id = r.user_id
    where d.status in ('pending', 'retry')
      and d.next_attempt_at <= now()
      and r.status = 'pending'
      and r.push_notified_at is null
    order by r.due_at
    for update of d skip locked
    limit greatest(1, least(batch_size, 500))
  ), updated as (
    update public.push_deliveries d
    set status = 'processing', attempts = attempts + 1, claimed_at = now()
    from claimed c
    where d.reminder_id = c.reminder_id and d.subscription_id = c.subscription_id
    returning d.reminder_id, d.subscription_id
  )
  select u.reminder_id, u.subscription_id, s.endpoint, s.p256dh, s.auth, r.reminder_text, r.due_at
  from updated u
  join public.push_subscriptions s on s.id = u.subscription_id
  join public.reminders r on r.id = u.reminder_id;
end;
$$;

revoke all on function public.claim_due_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_due_push_deliveries(integer) to service_role;

-- A reschedule (including Snooze) is a new notification occurrence. Remove the
-- terminal delivery ledger rows so the scheduler can create fresh deliveries.
create or replace function public.reset_push_deliveries_on_due_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.due_at is distinct from old.due_at then
    delete from public.push_deliveries where reminder_id = new.id;
    new.push_notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_push_deliveries_on_due_change on public.reminders;
create trigger reset_push_deliveries_on_due_change
before update of due_at on public.reminders
for each row
execute function public.reset_push_deliveries_on_due_change();
