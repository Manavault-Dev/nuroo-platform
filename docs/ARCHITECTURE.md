# Platform Architecture

## Context

Nuroo Platform is the web half of the Nuroo product: a public marketplace site, a localized B2B
organization workspace, and the Fastify REST API that backs both of them and the separate
`nuroo-app` mobile application. It serves three account roles: `org_admin`, `specialist`, and
`parent`. Parents authenticate against the same API but do most of their work in the mobile app;
their footprint in this repository is limited to the public marketplace, review, and lead-submission
pages, and the child-invite and parent-invite join flows under `app/[locale]/join` and
`app/[locale]/invites`.

## System Boundaries

```text
Next.js web (app/, components/, lib/)
  |-- Fastify backend API (backend/src) /v1
        |-- Firebase Auth: ID token verification
        |-- Firestore: primary data store (Firebase Admin)
        |-- Stripe: subscriptions, checkout, customer portal, webhooks
        |-- Resend: transactional email
        |-- WhatsApp Cloud API: phone OTP and notifications
        |-- Google Calendar API: specialist calendar sync
        `-- Sentry: error tracking (frontend and backend)

nuroo-app (separate repo, Expo mobile)
  `-- consumes this backend's /v1 REST API directly
```

`nuroo-app` lives outside this repository and is an external consumer of this backend's API. Changes
to request/response shapes, auth requirements, or route paths are a cross-repo contract change and
must stay backward compatible, or be coordinated with that repo.

## Code Ownership

- `app/[locale]/` owns the public, localized Next.js site: marketplace, legal pages, join/invite
  landing pages, and the `(b2b)/b2b/` organization workspace (admin, team, children, bookings,
  cohorts, courses, events, content, finance, invoices, billing, leads, reports, integrations).
- `lib/` owns frontend API clients and business helpers (`lib/b2b`, `lib/firebase`, `lib/pricing`,
  `lib/analytics`, `lib/seo`).
- `components/` owns shared presentation: `components/b2b` for workspace UI, `components/landing`
  and `components/layout` for the public site, `components/ui` for primitives.
- `backend/src/domains/` owns business behavior, grouped by bounded context. 23 domains, 91 route
  files:
  - **Core** — `organizations` (profile, branding, branches, team, reviews), `children` (profiles,
    guardians, intake, records, timeline, tasks, spreadsheet import), `users` (`/me`, parent
    contact profiles, session/active-org resolution), and `groups` (specialist-owned groups of
    parents/children used to bulk-assign content). `organizations` and `children` are the
    foundation most other domains join against.
  - **Scheduling** — `booking` (slots, availability, services, intake forms, reschedule/cancel),
    `cohorts` (group programs: sessions, attendance, waitlist, participants, marketplace listing),
    `events` (org events and registrations), `courses` (online courses, modules, lessons, progress,
    marketplace enrollment), and `calendar` (Google Calendar OAuth and sync for specialists).
  - **Commerce** — `payments` (Stripe subscriptions, Finik payments, both providers' webhooks),
    `finance` (attendance-linked billing, monthly fees, task/activity analytics; `nuroo_business`
    plan only), and `leads` (admission-request intake from the public marketplace into an org's
    pipeline).
  - **Content & Tasks** — `content` (development roadmaps and content tasks, both org-admin and
    parent-facing views, plus the legacy AlphaKids access-code library), `tasks` (parent-facing
    child task views and per-child billing status), and `activity` (child activity feed with
    comments, read state).
  - **Access** — `invitations` (staff invite codes, reusable and per-child parent-invite links,
    parent connection status — this domain is the glue between `auth`, `children`, and
    `organizations`), `verifications` (child-verification document review for course enrollment),
    `auth` (phone OTP login via WhatsApp, password reset), and `favorites` (parent-saved
    specialists).
  - **Platform** — `system` (health check, bootstrap, dev/super-admin status, push tokens, Sentry
    alert relay, trial-notification cron target), `ai` (AI-generated progress reports and
    specialist task-instruction assistance), `messaging` (specialist/parent conversations and
    notes), and `legal` (consent document versions and acceptance records).
- `backend/src/infrastructure/` owns cross-domain technical concerns: `auth` (Firebase token
  verification plumbing and RBAC guards — see below), `database` (Firestore/Firebase Admin
  initialization and collection references), `cache` (decoded-ID-token cache), `calendar`
  (Google Calendar sync service), `meetings` (Google Meet link creation), and `audit` (audit log
  writes and the audit-log read route).
- `backend/src/modules/` owns infrastructure shared across domains rather than owned by one:
  `email` (Resend provider and templates), `notifications` (push notification service, event
  dispatcher, device-token routes), `whatsapp` (WhatsApp Cloud API provider for OTP and
  notifications), and `parent-api` (a set of `/api/parent/*` routes used directly by the mobile
  app that predate the domain/OpenAPI structure and do not carry Swagger schemas).

## Authorization Model

Every non-exempt request passes through a `preHandler` hook in `backend/src/index.ts` that verifies
a Firebase ID token from `Authorization: Bearer <token>` (cached by `verifyIdTokenCached` against
`token-cache.ts`) and attaches `request.user`. A fixed, explicit list of paths bypasses this check:
`/health`, `/bootstrap/*`, `/public/*`, `/docs*`, the Google Calendar OAuth callback, Stripe and
generic webhook paths, the trial-notification cron endpoint (authenticated separately by
`CRON_SECRET`), password-reset and phone-OTP entry points, and a narrow, explicitly enumerated set of
read-only marketplace/public GET routes (org/specialist/course/cohort/event listings, public reviews,
public child-invite lookup) plus the public lead-submission POST route.

Past authentication, authorization is enforced per-route by guard functions in
`backend/src/infrastructure/auth/rbac.ts`:

- `requireOrgMember(request, reply, orgId)` resolves the caller's membership and role
  (`org_admin` or `specialist`) for an organization from `organizations/{orgId}/members/{uid}`. A
  platform `superAdmin` claim always resolves to `org_admin`. If no active membership record exists,
  it attempts to recover one (org creator, primary specialist, or an active
  `specialists/{uid}/organizations/{orgId}` entry) and persists it — but only when no valid record
  already exists, specifically to avoid silently reverting an explicit demotion made through the team
  UI.
- `requireOrgAdmin(request, reply, orgId)` calls `requireOrgMember` and additionally rejects callers
  whose role is not `org_admin`.
- `requireChildAccess(request, reply, orgId, childId)` resolves a child by ID or by parent-user ID,
  then checks access: `org_admin` requires the child be assigned to the org; `specialist` requires
  either direct assignment or membership in a specialist group that has that child's parent attached.
- `requirePlatformAdmin(request, reply)` checks either a static `x-platform-admin-key` header against
  `PLATFORM_ADMIN_SECRET` or a `platform_admin` custom claim, independent of organization membership.
- `memberBranchScope(member)` returns the branch a member is restricted to, or `null` for HQ-level
  access to every branch.

Client-supplied organization or child IDs are never trusted on their own; every route that accepts
one resolves access through these guards.

## API Documentation

The Fastify OpenAPI spec is the endpoint-level source of truth. Swagger UI is served at `/docs`
(JSON at `/docs/json`), built from `backend/src/config/swagger.ts` and the `schema` object on each
route. As of the most recent documentation pass, nearly all of the 91 route files carry real
`tags`, `summary`, and schema definitions, so `/docs` is reliable for discovering what an endpoint
does and what it expects — this document intentionally does not restate that endpoint-by-endpoint.

## Billing

Subscription and payment behavior — Stripe setup, billing modes, webhook handling, trial
notifications, and Firestore migration procedures — is covered in
[Billing Operations](BILLING_RUNBOOK.md), not duplicated here.

## Architectural Change Checklist

- Identify the owning domain under `backend/src/domains/` (or the owning infrastructure/module
  folder) before adding code; avoid duplicating behavior across domains.
- Check cross-repo API compatibility: `nuroo-app` depends on this backend's `/v1` contract. A
  breaking change to a route's path, auth requirement, or response shape must be coordinated with
  that repository.
- Add or update route-level OpenAPI schema (`tags`, `summary`, inputs, responses) and route/service
  tests for success and error paths.
- Run `npm run validate` and `npm test -- --run` in `backend/` before merging.
- Update this document when domain boundaries, route registration, or the authorization model
  change; update [BILLING_RUNBOOK.md](BILLING_RUNBOOK.md) when billing behavior changes; update
  [TESTING.md](TESTING.md) when test commands, CI gates, or coverage policy change.
