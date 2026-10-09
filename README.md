# 7445 Social

A mobile-first installable social app with a Render-hosted Node.js API and PostgreSQL database.

## Current status

- Frontend: GitHub Pages.
- Backend source: `backend/` (Express API, password hashing, JWT sessions, PostgreSQL).
- Render deployment blueprint: `render.yaml`.
- Demo mode remains available on the device.
- Online accounts and shared posts work only after the Render service and database are configured and the API URL is added to `render-config.js`.

## Deploy the backend to Render

1. Open https://dashboard.render.com and connect your GitHub account.
2. Choose **New → Blueprint** and select this repository. Render will read `render.yaml`. Alternatively, create a Web Service manually with:
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health check path: `/api/health`
3. Create a PostgreSQL database in Render. Copy its **Internal Database URL** if the web service and database are in the same Render workspace and region; otherwise use the external URL as appropriate. Add it to the web service as `DATABASE_URL`.
4. Add `JWT_SECRET` as a long random secret (at least 32 characters). If using the Blueprint, Render generates one for you.
5. Set `FRONTEND_ORIGIN` to `https://yharsh04321-netizen.github.io`.
6. Deploy the web service and wait until the health check passes. Open `https://YOUR-RENDER-SERVICE.onrender.com/api/health`; it should return JSON with `"ok": true`.
7. Edit `render-config.js` in GitHub and replace `https://YOUR-RENDER-SERVICE.onrender.com/api` with your actual Render URL plus `/api`. Commit the change; GitHub Pages will update.
8. Open the published app, refresh it, create an account, and try a text post, like, comment, follow, and profile search.

## Important notes

- Do not put database URLs, passwords, or JWT secrets in frontend files or public GitHub code. Put secrets only in Render environment variables.
- Render free web services can sleep when idle, so the first request may be slow. Render's free Postgres databases have time limits; check current pricing and expiry before using one for important data.
- Online photo upload storage is not yet included. For now, online posts can include a public HTTPS image URL. File uploads work only in local demo mode.
- This is an early social app. Before a public launch, add email verification/password reset, reporting/blocking, moderation, stronger privacy controls, and a privacy policy.

## Published app

https://yharsh04321-netizen.github.io/7445-social/
