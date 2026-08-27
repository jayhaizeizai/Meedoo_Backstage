# MeeDoo Demo

Next.js frontend for the MeeDoo short-video publishing and analytics experience.

## Routes

- `/upload` — video selection and cross-platform publishing demo
- `/dashboard` — team overview, leaderboard, video data, and personal score views
- `/login` — Lark OAuth sign-in entry
- `/api/auth/lark/callback` — Lark OAuth callback

## Local development

```bash
pnpm install
pnpm dev
```

## Production build

```bash
pnpm build
pnpm start
```

The publishing and analytics surfaces still use demo data. Lark authentication
is implemented; Upload-Post integration, persistence, and webhooks will be
added in later phases.

## Lark authentication

Copy `.env.example` to the server environment file and provide real values. In
production, the systemd service reads `/etc/meedoo/meedoo.env` so secrets never
need to be committed to Git.

Configure this exact redirect URL in the Lark developer console:

```text
https://backstagetest.meedoo.fun/api/auth/lark/callback
```

The login flow requests the built-in `auth:user.id:read` OAuth scope, exchanges
the authorization code only on the server, and stores a signed seven-day
HTTP-only session cookie. No additional contact API permission is required for
the first login test. Set `LARK_AUTH_REQUIRED=true` after the app has been
installed and tested.

See [`docs/lark-setup.md`](docs/lark-setup.md) for the Lark console checklist.
See [`TODO.md`](TODO.md) for the prioritized implementation backlog.
