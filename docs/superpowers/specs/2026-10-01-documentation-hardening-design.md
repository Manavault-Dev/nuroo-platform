# Documentation Hardening Design

## Goal

Make the repository documentation match the production billing, trial notification, migration,
testing, and deployment behavior. Configuration and API documentation must be enforced by typed
configuration and OpenAPI metadata rather than relying only on prose.

## Scope

- Update the root and backend READMEs for the current repository structure, Node.js version,
  setup commands, testing commands, authentication model, and documentation links.
- Add a billing operations runbook covering Stripe configuration, webhook setup, subscription
  lifecycle, trial notifications, legacy migrations, verification, rollback, and incident checks.
- Add a testing guide covering validation, unit tests, Playwright suites, E2E auth bypass, CI, and
  test artifacts.
- Add all billing, email, and cron variables to the backend environment example without real
  secrets.
- Parse `CRON_SECRET` through the typed backend configuration and keep the cron endpoint fail-closed.
- Add OpenAPI metadata, request definitions, response definitions, tags, and security overrides to
  billing, Stripe webhook, and trial notification routes.
- Add package scripts for dry-run legacy trial migrations and explicit `:apply` variants.

## Boundaries

- Do not change billing business rules or endpoint URLs.
- Do not change production secret values or execute migration scripts.
- Do not modify the existing uncommitted change in `e2e/helpers/b2b.ts`.
- Do not document internal secrets as URL examples containing real values.

## Security Model

- Organization billing endpoints use Firebase bearer authentication and organization membership or
  admin authorization as appropriate.
- The Stripe webhook is unauthenticated at the HTTP bearer layer and authenticated by the
  `stripe-signature` header.
- The trial notification endpoint is unauthenticated at the bearer layer and authenticated by
  `CRON_SECRET`; absence of the secret returns `503`, and a mismatch returns `401`.
- Documentation includes secret storage and rotation procedures without exposing values.

## Verification

- Frontend and backend validation commands pass.
- Frontend and backend unit tests pass.
- Prettier accepts all documentation and configuration files.
- OpenAPI route schemas compile and existing route tests remain green.
- `git diff` confirms that `e2e/helpers/b2b.ts` retains the user's pre-existing change only.
