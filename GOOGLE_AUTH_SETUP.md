# Google sign-in setup

The app accepts only personal addresses ending in `@gmail.com`. Google Workspace addresses are rejected.

## 1. Create Google OAuth credentials

1. Open Google Cloud Console and select or create a project.
2. Open **Google Auth Platform** and configure Branding, Audience, and Data Access.
3. Add the scopes `openid`, `userinfo.email`, and `userinfo.profile`.
4. Under **Clients**, create an **OAuth client ID** with application type **Web application**.
5. Add the local origin, such as `http://localhost:5173`, under **Authorized JavaScript origins**.
6. Copy the callback URL shown on **Supabase > Authentication > Providers > Google** and add it under **Authorized redirect URIs**. It normally has the form `https://PROJECT_REF.supabase.co/auth/v1/callback`.
7. Save the Google Client ID and Client Secret.

## 2. Enable Google in Supabase

1. Open **Supabase > Authentication > Providers > Google**.
2. Enable Google.
3. Paste the Google Client ID and Client Secret, then save.
4. Open **Authentication > URL Configuration**.
5. Set the local Site URL to `http://localhost:5173` and add any other Vite port you use to Redirect URLs, for example `http://localhost:5174/**`.
6. Add the production HTTPS URL before deployment.

Disable the Email provider if Google must be the only possible sign-in method.

## 3. Apply ownership and deploy

Run the complete `supabase-schema.sql` in Supabase SQL Editor, then deploy:

```powershell
npx.cmd supabase functions deploy register-push-subscription
```

Existing anonymous rows have no `user_id` and will intentionally be hidden. New reminders and push subscriptions belong to the signed-in Gmail user.

## 4. Test

1. Run `npm.cmd run dev` and open the displayed URL.
2. Click **Continue with Google** and select an `@gmail.com` account.
3. Create a reminder and register browser notifications.
4. Confirm both rows have the same user ID:

```sql
select id, user_id, reminder_text from public.reminders order by created_at desc;
select id, user_id, endpoint from public.push_subscriptions order by created_at desc;
```

5. Sign in with another Gmail account in a separate browser profile and verify it cannot see the first account's reminders.
