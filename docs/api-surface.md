# Supported HTTP surface

This is the allowlist for production routes. Adding a route requires updating this document and its route-contract test.

## Pages

`/`, `/login`, `/register`, `/dashboard`, `/planner`, `/account`

## Product APIs

- Auth: `/api/auth/firebase-config`, `/api/auth/session`, `/api/auth/client-event`, `/api/auth/logout`, `/api/auth/logout-all`, `/api/auth/me`, `/api/auth/change-password`, `/api/auth/delete-account`
- Dashboard: `/api/dashboard`, `/api/dashboard/customers`, `/api/dashboard/plans`
- Customers: `GET/POST /api/customers`, `GET/PUT/DELETE /api/customers/:id`, `GET /api/customers/:id/plans`
- Plans: `POST /api/plans`, `GET/PUT/DELETE /api/plans/:id`, `POST /api/plans/:id/opened`, `GET /api/plans/:id/export.pdf`
- Planner: `/api/foods`, `/api/preferences`, `/api/generate-plan`, `/api/rebalance-meal`, `/api/swap-suggestions`, `/api/generation-timeline`

## Operational and security routes

- `GET /livez` and `GET /readyz`
- protected `GET /metrics`
- rate-limited CSP reports
- rate-limited browser-vitals ingestion
- protected account-deletion recovery cron

These routes are retained intentionally. They must preserve their existing authentication, authorization, rate limiting, origin checks, cache policy, and bounded-input behavior.
