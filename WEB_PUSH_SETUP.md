# Web Push deployment

The application code is complete, but browser push delivery needs production keys and deployed Supabase infrastructure.

1. Generate VAPID keys with `npx web-push generate-vapid-keys`. Put the public key in the web deployment as `VITE_VAPID_PUBLIC_KEY`.
2. Apply `supabase-schema.sql` to the Supabase database.
3. Deploy both functions:
   - `supabase functions deploy register-push-subscription`
   - `supabase functions deploy dispatch-due-reminders --no-verify-jwt`
4. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` or HTTPS URL), and a random `SCHEDULER_SECRET` with `supabase secrets set`.
5. Store the project URL, publishable key, and the same scheduler secret in Supabase Vault, then schedule the dispatcher:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_PUBLISHABLE_KEY', 'publishable_key');
select vault.create_secret('YOUR_RANDOM_SCHEDULER_SECRET', 'scheduler_secret');

select cron.schedule(
  'dispatch-due-reminder-pushes',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-due-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Web Push requires HTTPS in production. On iPhone/iPad, the user must first install the website to the Home Screen before notification permission can be granted.
