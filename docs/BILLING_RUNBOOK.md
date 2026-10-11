# Billing Operations Runbook

## Purpose

This runbook covers Nuroo organization subscriptions, Stripe integration, free trials, scheduled
notifications, and legacy trial migrations. Use it for local setup, production deployment, incident
triage, and controlled data migrations.

## Ownership and access

- Application billing routes require an authenticated organization member or `org_admin`.
- Stripe webhook calls are authenticated with `stripe-signature`.
- Trial notification calls are authenticated with `CRON_SECRET`.
- Production secrets belong in Google Secret Manager and GitHub Actions secrets, never in Git.
- Firestore migrations require production Firebase Admin access and explicit operator approval.

## Billing modes

| Mode          | Behavior                                                                            |
| ------------- | ----------------------------------------------------------------------------------- |
| `manual`      | Stripe checkout, portal, and cancellation are disabled. Nuroo staff manages access. |
| `stripe_test` | Stripe test keys and test price IDs are used. No real charges occur.                |
| `stripe_live` | Stripe live keys and live price IDs are used. Real charges occur.                   |

Never mix test keys with live price IDs. Restart the backend after changing billing configuration.

## Required configuration

Copy `backend/.env.example` to `backend/.env`. Configure Firebase first, then:

```env
BILLING_MODE=stripe_test
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_PUBLISHABLE_KEY=pk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_PRICE_STARTER=price_replace_me
STRIPE_PRICE_GROWTH=price_replace_me
STRIPE_PRICE_ENTERPRISE=price_replace_me
RESEND_API_KEY=re_replace_me
EMAIL_FROM=Nuroo <noreply@example.com>
CRON_SECRET=replace_with_a_random_secret
```

Generate `CRON_SECRET` with a cryptographically secure password generator. Store the same value in
Google Secret Manager and the GitHub Actions `CRON_SECRET` secret.

## Stripe setup

1. Create Starter, Growth, and Enterprise recurring prices in Stripe.
2. Put each `price_...` identifier into the matching environment variable.
3. Create a webhook endpoint for `https://<backend>/v1/webhooks/stripe`.
4. Subscribe it to:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
   - `invoice.payment_succeeded`
5. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.
6. In Stripe test mode, complete one checkout and verify the organization billing map in Firestore.

The webhook is idempotent through `stripeWebhookEvents/{eventId}`. Retried Stripe events must return
HTTP 200 without applying the event twice.

## Subscription lifecycle

All organization routes below are under `/v1` and require a Firebase bearer token.

| Method | Route                              | Authorization       | Purpose                                 |
| ------ | ---------------------------------- | ------------------- | --------------------------------------- |
| `POST` | `/orgs/:orgId/billing/start-trial` | `org_admin`         | Start the 30-day Growth trial.          |
| `GET`  | `/orgs/:orgId/billing/status`      | organization member | Read effective plan and billing status. |
| `POST` | `/orgs/:orgId/billing/checkout`    | `org_admin`         | Create the first Stripe subscription.   |
| `POST` | `/orgs/:orgId/billing/portal`      | `org_admin`         | Open Stripe Customer Portal.            |
| `POST` | `/orgs/:orgId/billing/cancel`      | `org_admin`         | Set `cancel_at_period_end=true`.        |
| `POST` | `/orgs/:orgId/billing/resume`      | `org_admin`         | Undo scheduled cancellation.            |

Cancellation is not immediate. Paid access remains active until `currentPeriodEnd`; the Stripe
`customer.subscription.deleted` event then marks the subscription canceled. Organization data is
not deleted when a subscription ends.

Important errors:

| Code                          | Meaning                                         | Operator action                          |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `BILLING_MODE_MANUAL`         | Stripe action attempted in manual mode.         | Confirm deployment configuration.        |
| `SUBSCRIPTION_ALREADY_EXISTS` | Checkout would create a duplicate subscription. | Use Customer Portal.                     |
| `NO_SUBSCRIPTION`             | No Stripe subscription ID is stored.            | Reconcile Firestore with Stripe.         |
| `NO_STRIPE_CUSTOMER`          | No Stripe customer ID is stored.                | Reconcile checkout/webhook history.      |
| `STRIPE_UPDATE_FAILED`        | Stripe rejected cancel/resume.                  | Check Stripe and Sentry before retrying. |

Interactive OpenAPI documentation is served at `/docs`; raw JSON is available at `/docs/json`.

## Trial notifications

`.github/workflows/trial-notifications.yml` calls
`POST /v1/internal/cron/trial-notifications?secret=...` daily at 06:00 UTC.

The scan sends one reminder at seven days or fewer and one expiration email after the trial ends.
Firestore markers `billing.trialEndingNotifiedAt` and `billing.trialEndedNotifiedAt` make reruns
idempotent. A workflow dispatch is therefore safe after fixing a transient provider failure.

Verification:

1. Open the latest `Trial Expiration Notifications` GitHub Actions run.
2. Confirm HTTP 200 and inspect `scanned`, `endingSoonSent`, `endedSent`, and `errors`.
3. If `errors > 0`, inspect Cloud Run logs and Resend delivery logs.
4. Confirm notification markers only on organizations whose email was accepted by the provider.

Secret rotation:

1. Generate a replacement secret.
2. Update Google Secret Manager and deploy Cloud Run.
3. Update the GitHub Actions secret immediately after deployment.
4. Manually dispatch the workflow and confirm HTTP 200.
5. Revoke the previous secret from all external storage.

## Legacy trial migrations

These scripts mutate Firestore only with `:apply`. They must never run from CI.

```bash
cd backend
npm run trial:migrate-legacy          # dry run
npm run trial:adjust-grace            # dry run
```

The first script identifies legacy organizations and marks them with `legacyGraceExtension`. The
second corrects those marked records to the standard 30-day trial. For a new production operation,
run both dry runs and retain their output before requesting approval.

Apply procedure:

1. Export or back up affected `organizations/{orgId}.billing` maps.
2. Run both dry-run commands and review every listed organization.
3. Obtain approval from the billing owner and production operator.
4. Run `npm run trial:migrate-legacy:apply` only if the initial migration is still required.
5. Run `npm run trial:adjust-grace:apply` to enforce the 30-day policy.
6. Repeat both dry runs and inspect affected Firestore records.
7. Record operator, timestamp, command output, and approved organization count in the change ticket.

Rollback restores each backed-up billing map. Do not calculate a new rollback date: restore the
exact previous `status`, `plan`, `trialEndsAt`, and migration marker values. If a Stripe-managed
`billing/current` document exists, stop and reconcile the organization manually.

## Incident checklist

1. Confirm `BILLING_MODE` and whether keys belong to Stripe test or live mode.
2. Check Cloud Run logs and Sentry for the organization ID and Stripe event ID.
3. Check Stripe webhook delivery status and response body.
4. Compare Stripe customer/subscription IDs with the Firestore billing map.
5. Replay the Stripe event only after confirming idempotency state.
6. Never delete organization data to repair subscription state.
