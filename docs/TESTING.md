# Testing and CI Guide

## Supported runtime

- Node.js 24.x for the root Next.js application.
- npm 10 or newer.
- Chromium installed through Playwright for E2E tests.

Install root and backend dependencies separately:

```bash
npm ci
npm --prefix backend ci
npx playwright install chromium
```

## Required local checks

Frontend:

```bash
npm run validate
npm test -- --run
```

Backend:

```bash
cd backend
npm run validate
npm test -- --run
```

`validate` runs TypeScript, ESLint, and Prettier checks. Warnings must be reviewed; errors and test
failures block merging.

## Playwright suites

| Command                    | Scope                                          |
| -------------------------- | ---------------------------------------------- |
| `npm run test:e2e`         | Core smoke suite, one worker.                  |
| `npm run test:e2e:product` | Authentication, connect flow, and assignments. |
| `npm run test:e2e:headed`  | All selected tests with a visible browser.     |
| `npm run test:e2e:ui`      | Interactive Playwright test explorer.          |

The Playwright web server uses port 3000 unless `PORT` is set. It injects mock Firebase client
configuration, `NEXT_PUBLIC_E2E_AUTH_BYPASS=1`, and `NEXT_PUBLIC_API_URL=http://127.0.0.1:3101`.
The bypass is only for automated tests and must never be enabled in a deployed environment.

`e2e/helpers/b2b.ts` seeds the browser's E2E auth state and intercepts selected backend requests,
including billing status. Keep mocked plans aligned with the feature under test; do not treat these
responses as backend integration coverage.

## CI behavior

`.github/workflows/ci.yml` runs lint and typecheck before E2E jobs. E2E jobs run on pushes and manual
workflow dispatches, use one worker in CI, retry failures twice, and upload `playwright-report` even
when tests fail. Traces, screenshots, and videos are retained on failure.

## Failure triage

1. **TypeScript:** run the reported `typecheck` command and fix the first error before later errors.
2. **ESLint:** distinguish errors from warnings; do not suppress a rule without documenting why.
3. **Prettier:** run `npm run format`, inspect the diff, then rerun `npm run validate`.
4. **Vitest:** rerun the exact file with `npm test -- --run path/to/test.ts`.
5. **Playwright:** open `playwright-report/index.html`, inspect the trace, screenshot, and network log.
6. **CI-only E2E:** reproduce with `CI=1 npm run test:e2e` to match retries and worker count.

Do not weaken assertions or increase retries to hide deterministic failures. Update mocks only when
the product contract changed, and pair the mock change with unit or route-level coverage.
