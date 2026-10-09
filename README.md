# 7445 Social

A mobile-first installable social app prototype, with Supabase integration prepared for real accounts and shared community content.

## Current status

- The redesigned login/signup and social feed are committed to `main`.
- Demo mode works locally on one device and is clearly separate from online accounts.
- Real accounts, shared posts, likes, comments, follows, and photo uploads require a Supabase project and the setup below.

## Activate online features

1. Create a project at https://supabase.com/dashboard.
2. Open **SQL Editor** in the new project.
3. Open `supabase-schema.sql` in this repository, copy all of it, paste it into SQL Editor, and click **Run**.
4. In Supabase, open **Project Settings → API** (or **Connect**, depending on the dashboard version). Copy the **Project URL** and the **anon/public** or **publishable** browser key.
5. Edit `supabase-config.js` in this repository:
   - Replace `https://YOUR_PROJECT_ID.supabase.co` with your Project URL.
   - Replace `YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY` with the anon/public or publishable key.
   - Never put a `service_role` or secret key in this file.
6. Commit the change to `main`. GitHub Pages will redeploy the app.
7. Open the published app, refresh it, choose **Create account**, and register with an email and a password of at least 6 characters. If email confirmation is enabled, confirm the email before logging in.

## Published app

https://yharsh04321-netizen.github.io/7445-social/

## Notes

- The browser key is designed for client-side use; database access is controlled by the Row Level Security policies in the SQL file.
- This is an early social app. Before public launch, add reporting/blocking, moderation, rate limits, stronger profile controls, and a privacy policy.
