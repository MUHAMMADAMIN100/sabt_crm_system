# Security and database backup configuration

This file documents **secret names and operational checks only**. Never put
real credentials, tokens, database URLs, or backup contents in Git, issue
comments, screenshots, or build logs.

## Backend environment

Configure these values in the backend hosting provider:

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | production | PostgreSQL connection string |
| `JWT_SECRET` | all environments | Signing secret; use a random 64+ byte value |
| `FRONTEND_URL` | recommended | Exact main browser origin, for example `https://crm.example.com` |
| `CORS_ORIGINS` | optional | Comma-separated **exact** additional browser origins |

Rules for frontend origins:

- Do not use `*`, `*.vercel.app`, or another hostname pattern.
- Add every approved preview deployment as a complete origin.
- Do not add paths: use `https://crm.example.com`, not
  `https://crm.example.com/app`.
- Localhost origins are available automatically in non-production and are
  ignored when `NODE_ENV=production`.
- Restart the backend after changing the environment.

Browser requests authenticated by the `auth_token` or `refresh_token` cookie
must carry a trusted `Origin` (or `Referer`) for `POST`, `PUT`, `PATCH`, and
`DELETE`. Mobile and server integrations should authenticate with
`Authorization: Bearer …`; they do not need browser-origin headers.

## Daily GitHub Actions backup

The workflow is `.github/workflows/db-backup.yml`. It runs every day at
02:00 UTC (07:00 Asia/Dushanbe) and can also be started with **Run workflow**.

Create the workflow secret:

1. Open **Repository Settings → Secrets and variables → Actions**.
2. Select **New repository secret**.
3. Set the name to `DATABASE_URL`.
4. Paste the production PostgreSQL URL and save it.
5. Open **Actions → Daily PostgreSQL backup → Run workflow**.
6. Confirm that the summary says the preflight passed and that a non-empty
   `db-backup-*` artifact was uploaded.

The workflow fails before installing PostgreSQL when the secret is absent. Its
job summary identifies a missing secret separately from connectivity or
credential failures, without printing the connection string.

## Recovery checks

- Backup artifacts contain sensitive production data. Keep repository and
  Actions access restricted to authorized administrators.
- Artifacts are retained for 30 days. Export critical retention copies to an
  approved encrypted storage location according to company policy.
- At least monthly, download the latest artifact, run `gzip -t` on it, and
  restore it into an isolated staging database.
- Verify record counts and the Finance overview in staging before considering
  the recovery drill successful.
- Never test a restore against production. Take a fresh backup and obtain an
  explicit maintenance decision before any production restore.
