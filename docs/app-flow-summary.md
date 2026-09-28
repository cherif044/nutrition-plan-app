# Current application flow

This document describes only the deployed UI and its supporting code. Retired features are listed in `PRODUCT.md` and must not be restored accidentally.

## Runtime entry points

- `src/server.js` starts the HTTP server and generation worker pool.
- `src/app.js` composes security middleware, operational endpoints, current pages, and feature routers.
- `api/index.js` exposes the Express app to Vercel.
- `api/plan-export.js` handles the long-running PDF export function.

## Authentication

The login and registration pages use `public/js/auth/app.js`. Browser Firebase tokens are exchanged for secure server sessions through `src/features/auth`. Session cookies, same-origin checks, rate limits, token revocation, logout-all, password change, and account deletion remain intentional security surfaces.

## Dashboard

`public/dashboard.html` and `public/js/dashboard/app.js` implement the current dashboard SPA. Its Home, Customers, Plans, and Customer Detail views use `src/features/dashboard` and `src/features/customers`. The old standalone customer and explorer pages no longer ship.

## Planner

`public/planner.html` and `public/js/planner/app.js` collect the current form fields, call the planner APIs, render the generated plan, perform supported meal edits and swaps, and save or update a plan.

`src/features/planner` owns:

- catalog and preference responses;
- nutrition calculations and generation;
- worker-thread isolation;
- meal rebalancing and swap suggestions;
- read-only access to `used_food_repository/foods.json` and `ready_meals/meals.json`.

Ramadan mode, custom-food creation, folder routing, and alternate diet modes are not accepted by the current request schemas.

## Plans and PDF export

`src/features/plans` owns plan CRUD, ownership checks, optimistic update versions, idempotent creation, customer association, opened timestamps, and PDF generation. The dashboard and planner use only general plan URLs; legacy `folder_id` values may remain in stored rows but are not part of the product API.

## Security boundary

All feature routes continue through the centralized middleware in `src/middleware`: authentication, authorization-by-owner queries, body/query schemas, same-origin protection, rate limiting, private cache headers, CSP, and bounded inputs. Operational endpoints remain documented in `docs/api-surface.md` because they protect and operate the UI even without visible buttons.

## Change checklist

When adding or removing a capability:

1. Update `PRODUCT.md` and `docs/api-surface.md`.
2. Keep route handlers inside the owning `src/features/<feature>` directory.
3. Add or adjust strict schemas in `src/validation/schemas.js`.
4. Add route-contract and behavior tests.
5. Run `npm test` before deployment.
