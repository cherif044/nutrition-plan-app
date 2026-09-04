# Scalability Action Plan

## Now

- Add migrations for `users`, `customers`, `folders`, and `plans`.
- Add indexes for all user-scoped lookups: plans by folder/customer/updated time, customers by normalized name, folders by parent.
- Add request validation schemas for every POST/PUT/PATCH endpoint.
- Add rate limits for `/api/auth/session`, `/api/generate-plan`, `/api/rebalance-meal`, `/api/produce-swap-options`, and PDF export.
- Add integration tests for all route handlers and regression tests for generator impossible-plan diagnostics.
- Add structured logging with request IDs and error categories.
- Add graceful shutdown for the long-running server.
- Hide raw internal 500 error messages in production.
- Split `public/js/app.js`, `public/js/dashboard.js`, `public/css/styles.css`, and `src/services/planGenerator.js` into smaller modules.

## Before Launch

- Confirm database SSL certificate policy and avoid `rejectUnauthorized: false` where possible.
- Add CSRF protection or a deliberate same-site/API token strategy for cookie-authenticated mutations.
- Add production health/readiness checks that include database reachability.
- Add dashboard query `EXPLAIN ANALYZE` checks with seeded realistic data.
- Add visual smoke tests for planner, dashboard, login/register, explorer, and PDF export.
- Add data validation in CI for `foods.json`, `meals.json`, and icon coverage.
- Add deployment-specific DB pool settings for PM2 versus Vercel.
- Add browser recycling/concurrency guard for Puppeteer PDF export.

## At Thousands of Users

- Add pagination to customers, plans, customer plans, folders, and dashboard lists.
- Cache static reference endpoints `/api/foods` and `/api/preferences`.
- Add application metrics: request latency, DB latency, generation latency, PDF latency, error rate, memory, and event loop delay.
- Move PDF export to a background job or queue if exports are common.
- Add connection pooling/proxying for serverless deployments.
- Add optimistic concurrency or version checks for autosave updates.
- Introduce CDN caching for icons and static assets with hashed filenames.
- Add backup/restore drills and database migration rollback testing.

## At Hundreds of Thousands / Millions of Users

- Move CPU-heavy generation/rebalance to worker processes or a dedicated service.
- Precompute or cache ready-meal candidate sets by diet/restriction/meal target buckets.
- Replace full in-process JSON data loading with versioned data service or database-backed catalog if data becomes large/editable.
- Use queue-based PDF generation with stored export artifacts and signed download URLs.
- Add read replicas or dedicated analytics/dashboard materialized views.
- Partition or archive old plan data if plan volume becomes large.
- Add feature flags and staged rollout for generator changes.
- Add WAF/bot protection for public and auth-adjacent endpoints.
- Run load tests that model realistic planner generation, autosave, dashboard, and PDF export traffic.

