# Documentation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make repository documentation, typed configuration, and generated OpenAPI accurately describe the production billing and testing workflows.

**Architecture:** Keep operational detail in focused runbooks and link to them from concise README files. Treat typed environment parsing and route-level OpenAPI schemas as executable documentation, with explicit security overrides for non-Firebase endpoints.

**Tech Stack:** Markdown, Fastify 5, TypeScript, Zod, OpenAPI 3, Vitest, Playwright, Stripe, Firebase Admin

---

### Task 1: Type and verify cron configuration

**Files:**

- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/domains/system/trialNotifications.routes.ts`
- Test: `backend/src/domains/system/__tests__/trialNotifications.test.ts`

- [x] Add optional `CRON_SECRET` to `envSchema`.
- [x] Replace direct `process.env.CRON_SECRET` access with `config.CRON_SECRET`.
- [x] Preserve `503` when configuration is absent and `401` when the supplied secret differs.
- [x] Run `npm test -- --run src/domains/system/__tests__/trialNotifications.test.ts` from `backend`; expect all tests to pass.

### Task 2: Complete route-level OpenAPI contracts

**Files:**

- Modify: `backend/src/domains/payments/subscription.routes.ts`
- Modify: `backend/src/domains/payments/stripeWebhook.routes.ts`
- Modify: `backend/src/domains/system/trialNotifications.routes.ts`
- Modify: `backend/src/config/swagger.ts`

- [x] Add reusable JSON schemas for error, success, billing status, and cron result responses where they reduce duplication.
- [x] Add tags, summaries, path parameters, request bodies, response status codes, and Firebase bearer security to organization billing routes.
- [x] Set `security: []` on Stripe webhook and trial cron routes.
- [x] Document `stripe-signature` as a required webhook header and `secret` as a required cron query parameter.
- [x] Update Swagger's authentication description to explain Firebase, Stripe signature, and cron-secret exceptions.
- [x] Run `npm run typecheck` from `backend`; expect exit code 0.

### Task 3: Publish billing operations runbook

**Files:**

- Create: `docs/BILLING_RUNBOOK.md`
- Modify: `backend/package.json`

- [x] Document prerequisites, billing modes, Stripe products/prices, webhook URL and subscribed events.
- [x] Document every billing endpoint, authorization rule, important response code, and cancellation semantics.
- [x] Document trial notification scheduling, manual dispatch, idempotency markers, monitoring, and secret rotation.
- [x] Document legacy migration dry runs, approval gates, apply commands, verification queries, and rollback procedure.
- [x] Add `trial:migrate-legacy`, `trial:migrate-legacy:apply`, `trial:adjust-grace`, and `trial:adjust-grace:apply` package scripts.
- [x] Explicitly state that apply scripts mutate Firestore and must never be run as part of CI.

### Task 4: Publish testing and CI guide

**Files:**

- Create: `docs/TESTING.md`

- [x] Document frontend and backend validation and unit-test commands.
- [x] Document Playwright smoke, product, headed, and UI commands.
- [x] Explain `NEXT_PUBLIC_E2E_AUTH_BYPASS`, mocked billing responses, ports, CI worker settings, retries, and artifacts.
- [x] Add failure triage steps for unit, typecheck, lint, formatting, and Playwright failures.

### Task 5: Synchronize environment examples and READMEs

**Files:**

- Modify: `backend/.env.example`
- Modify: `.env.local.example`
- Modify: `README.md`
- Modify: `backend/README.md`

- [x] Add placeholder-only Stripe, billing mode, email, and cron variables to `backend/.env.example` with required/optional notes.
- [x] Add Firebase client and API URL variables to `.env.local.example` so it can bootstrap the frontend.
- [x] Update prerequisites to Node.js 24 and npm 10, repository name, architecture count, directory structure, scripts, deployment targets, and documentation links.
- [x] Replace the incomplete endpoint inventory with links to `/docs`, `/docs/json`, and the billing runbook.
- [x] Correct the authentication statement so health, webhook, and cron exceptions are explicit.
- [x] Keep secret values and production credentials out of documentation.

### Task 6: Verify the complete change set

**Files:**

- Verify only: all files above
- Preserve: `e2e/helpers/b2b.ts`

- [x] Run `npm run validate` and `npm test -- --run` at repository root; expect exit code 0.
- [x] Run `npm run validate` and `npm test -- --run` in `backend`; expect exit code 0.
- [x] Run `git diff --check`; expect no whitespace errors.
- [x] Compare `git diff -- e2e/helpers/b2b.ts` with the original one-line `starter` to `growth` change; expect no additional modifications.
- [x] Review `git status --short` and report every remaining file without claiming the user's E2E change as implementation work.
