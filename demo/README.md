# MeeDoo Demo

Next.js frontend for the MeeDoo short-video publishing and analytics experience.

## Routes

- `/upload` — video selection and cross-platform publishing demo
- `/dashboard` — team overview, leaderboard, video data, and personal score views

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

The current version is frontend-only and uses demo data. Lark authentication,
Upload-Post integration, persistence, and webhooks will be added in later phases.
