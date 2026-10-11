# Nuroo Platform

Nuroo Platform contains the public website, localized B2B workspace, and Fastify API used by Nuroo
organizations, specialists, and the separate parent mobile application.

## Components

- **Public website:** localized Next.js pages and marketplace.
- **B2B workspace:** organization operations, children, team, schedules, courses, finance, and billing.
- **Backend API:** Fastify REST API backed by Firebase Auth and Firestore.
- **Operational automation:** GitHub Actions for CI, deployment, uptime, and trial notifications.

## Technology

| Area     | Stack                                                     |
| -------- | --------------------------------------------------------- |
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, next-intl |
| Backend  | Fastify 5, TypeScript, Firebase Admin, Zod                |
| Billing  | Stripe subscriptions and manual billing mode              |
| Email    | Resend                                                    |
| Testing  | Vitest and Playwright                                     |
| Hosting  | Vercel and Google Cloud Run                               |

## Prerequisites

- Node.js 24.x
- npm 10 or newer
- Firebase project with Authentication and Firestore
- Stripe and Resend accounts when testing those integrations

## Local setup

```bash
git clone https://github.com/Manavault-Dev/nuroo-platform.git
cd nuroo-platform
npm ci
npm --prefix backend ci
cp .env.local.example .env.local
cp backend/.env.example backend/.env
```

Fill the Firebase placeholders before starting either application. Billing defaults to `manual`; see
[Billing Operations](docs/BILLING_RUNBOOK.md) before enabling Stripe.

Start the backend:

```bash
npm --prefix backend run dev
```

Start the frontend in another terminal:

```bash
npm run dev
```

- Website: <http://localhost:3000>
- Backend: <http://localhost:3101>
- Swagger UI: <http://localhost:3101/docs>
- Raw OpenAPI: <http://localhost:3101/docs/json>

## Configuration

Frontend variables are documented in `.env.local.example`. Backend variables are documented in
`backend/.env.example` and parsed by `backend/src/config/env.ts`.

Never commit `.env`, `.env.local`, service-account keys, Stripe keys, webhook secrets, or cron
secrets. Production backend secrets are loaded from Google Secret Manager during deployment.

## Authentication

Protected application endpoints use a Firebase ID token:

```http
Authorization: Bearer <firebase_id_token>
```

Exceptions:

- `GET /health` is public.
- `POST /v1/webhooks/stripe` verifies the Stripe `stripe-signature` header.
- `POST /v1/internal/cron/trial-notifications` verifies `CRON_SECRET`.

Authorization is enforced server-side through organization membership and role checks. Client-side
visibility is not an access-control boundary.

## Testing

```bash
npm run validate
npm test -- --run
npm --prefix backend run validate
npm --prefix backend test -- --run
npm run test:e2e
npm run test:e2e:product
```

See [Testing and CI](docs/TESTING.md) for E2E auth bypass, CI behavior, artifacts, and failure triage.

## Project structure

```text
app/                    Next.js App Router pages by locale and product area
backend/
  scripts/              Controlled maintenance and migration commands
  src/config/           Typed environment and OpenAPI configuration
  src/domains/          Domain routes, services, and tests
  src/infrastructure/   Authentication, database, audit, and middleware
  src/modules/          Shared email and notification modules
components/             Shared and B2B React components
docs/                   Operational, legal, testing, and design documentation
e2e/                    Playwright suites and test helpers
lib/                    Frontend API clients and business helpers
messages/               English, Kyrgyz, and Russian translations
```

## API documentation

Swagger is the endpoint-level source of truth and is generated from Fastify route schemas. The
interactive UI is available at `/docs`, with OpenAPI JSON at `/docs/json`.

Operational semantics, Stripe setup, error handling, trial notifications, and migrations are in
[Billing Operations](docs/BILLING_RUNBOOK.md). Backend-specific setup is in
[Backend API](backend/README.md).

## Deployment

- Frontend deployment is handled by Vercel.
- Backend deployment is handled by `.github/workflows/deploy-production.yml` and Google Cloud Run.
- Trial notifications run through `.github/workflows/trial-notifications.yml` at 06:00 UTC daily.
- CI validation and E2E jobs are defined in `.github/workflows/ci.yml`.

Do not run Firestore migration `:apply` scripts from CI. Follow the approval, backup, verification,
and rollback procedure in the billing runbook.

## Contributing

1. Create a focused feature branch.
2. Keep commits atomic and use English Conventional Commit messages.
3. Run frontend and backend validation and tests.
4. Update route schemas, env examples, and runbooks when behavior or configuration changes.
5. Open a pull request and resolve CI failures before merging.

## Related repository

- [nuroo-app](https://github.com/Manavault-Dev/nuroo-app): Expo parent mobile application.

## License

Proprietary software. All rights reserved.
