# Nuroo Backend API

Fastify 5 API for the Nuroo B2B platform, marketplace, and parent mobile application.

## Runtime and architecture

- Node.js 20 or newer; Node.js 24 is used by the repository and CI.
- TypeScript with ESM modules.
- Firebase ID tokens for user authentication.
- Firestore through Firebase Admin.
- Domain routes under `src/domains`.
- Shared infrastructure under `src/infrastructure`.
- OpenAPI through `@fastify/swagger` and `@fastify/swagger-ui`.

## Setup

From the repository root:

```bash
npm --prefix backend ci
cp backend/.env.example backend/.env
npm --prefix backend run dev
```

The server listens on <http://localhost:3101>. Configuration is parsed by `src/config/env.ts`; the
example file is the canonical inventory of local variables.

## API documentation

- Swagger UI: <http://localhost:3101/docs>
- OpenAPI JSON: <http://localhost:3101/docs/json>
- Billing operations: [../docs/BILLING_RUNBOOK.md](../docs/BILLING_RUNBOOK.md)

Most `/v1` routes require `Authorization: Bearer <firebase_id_token>`. Exceptions are:

- `GET /health`: public health probe.
- `POST /v1/webhooks/stripe`: authenticated by Stripe signature.
- `POST /v1/internal/cron/trial-notifications`: authenticated by `CRON_SECRET`.

Routes must enforce authorization after authentication. Organization IDs supplied by clients are
always checked through membership or administrator guards.

## Commands

```bash
npm run dev               # hot-reload development server
npm run build             # compile TypeScript
npm run start             # start compiled production server
npm run validate          # typecheck, lint, and formatting check
npm test -- --run         # run backend unit and route tests once
npm run test:watch        # watch tests
npm run test:coverage     # collect coverage
```

Maintenance commands:

```bash
npm run deploy-indexes:check
npm run deploy-indexes
npm run broadcast-app-update
npm run trial:migrate-legacy
npm run trial:adjust-grace
```

Migration commands without `:apply` are dry runs. Apply variants mutate Firestore and require the
approval and rollback procedure in the billing runbook.

## Directory structure

```text
backend/
  scripts/                    maintenance and migration commands
  src/config/                 environment and Swagger configuration
  src/domains/                domain routes, services, and colocated tests
  src/infrastructure/auth/    Firebase authentication and RBAC
  src/infrastructure/database Firestore initialization
  src/modules/email/          Resend provider and templates
  src/modules/notifications/  shared notification services
  src/index.ts                application composition and startup
```

## Firestore billing data

Subscription state is stored in `organizations/{orgId}.billing`. Important fields include:

- `provider`, `status`, and `plan`;
- `stripeCustomerId` and `stripeSubscriptionId`;
- `trialEndsAt` and `currentPeriodEnd`;
- `cancelAtPeriodEnd`;
- trial notification idempotency markers.

Processed Stripe events are stored in `stripeWebhookEvents/{eventId}`. Never remove these records to
force a replay without first confirming the target billing state.

## Production operations

The backend is deployed to Google Cloud Run by `.github/workflows/deploy-production.yml`. Secrets
are mapped from Google Secret Manager. Keep the GitHub `CRON_SECRET` synchronized with the Cloud Run
secret used by the trial notification workflow.

For Stripe setup, incident response, secret rotation, trial notifications, migrations, and rollback,
follow [Billing Operations](../docs/BILLING_RUNBOOK.md).

## Change requirements

When adding or changing an endpoint:

1. Add route-level OpenAPI tags, summary, inputs, responses, and the correct security declaration.
2. Add route or service tests for success and important error paths.
3. Update `.env.example` for any new configuration.
4. Update the relevant runbook when operational behavior changes.
5. Run `npm run validate` and `npm test -- --run` before merging.
