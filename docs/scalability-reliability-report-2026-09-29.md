# Scalability and Reliability Report

Date: 2026-09-29

Scope: repo-wide pass over the current Express, Vercel, PostgreSQL, vanilla JS frontend, tests, migrations, observability, and deployment configuration.

## Executive summary

The application is in better shape than a typical early production app. It already has bounded request bodies, strict request schemas, owner-scoped database reads, Postgres-backed rate limits, per-account quotas, generation worker isolation, PDF timeout protection, readiness checks, request metrics, OpenTelemetry export, CI, route-contract tests, and security hardening.

It is not possible to make any website "100% unable to break" under arbitrary load. The practical target should be a defined SLO, tested capacity, graceful degradation, and no single user action that can collapse the whole service. For this app, the highest-risk scaling limits are:

1. Expensive work is still synchronous from the user's request perspective.
2. The generation queue is local to each Node process or Vercel function instance.
3. Every API request can write to the Postgres rate-limit table.
4. Serverless horizontal scale can multiply database connections faster than Postgres can absorb.
5. Some list/search queries will degrade at large per-account row counts.
6. Static assets are unbundled/unhashed, which raises bandwidth and cache-invalidation cost at scale.

The app can likely handle moderate traffic safely with the existing guardrails. To make it robust for large traffic, the biggest architectural move is to introduce global backpressure and durable background jobs for generation/PDF/export-like work, then add load tests and SLO alerts so capacity is measured rather than hoped for.

## What is already strong

### Request and abuse controls

- `src/app.js` applies compression, request IDs, metrics, security headers, same-origin checks, per-route body limits, private API cache headers, and shared rate limits.
- `src/validation/schemas.js` bounds plan size, meal count, food count, text lengths, page size, IDs, saved JSON payloads, PDF client names, Firebase tokens, and timeline telemetry.
- `src/config/inputLimits.js` centralizes limits and includes hard per-account quotas.
- `src/middleware/rateLimits.js` uses fail-closed behavior for expensive or state-changing scopes: generation, planner operations, plan writes, and PDF export.
- `src/utils/postgresRateLimitStore.js` makes rate limits shared across instances instead of per-process memory.

### Database correctness

- `src/features/plans/repository.js` uses idempotent create keys, row locks, optimistic plan versions, and summary columns for dashboard reads.
- `src/shared/accountQuotas.js` uses advisory transaction locks so concurrent inserts cannot both pass the same quota check.
- `migrations/007_scalability_hardening.sql` adds rate-limit storage, plan versioning, idempotency indexes, dashboard summary columns, query-path indexes, and database role timeouts.
- `migrations/008_sessions.sql` and `src/features/auth/sessionRepository.js` provide revocable server-side sessions.

### CPU and memory protection

- `src/features/planner/generationPool.js` runs plan generation in worker threads with heap limits, timeouts, queue caps, overload responses, and worker restart metrics.
- `src/features/plans/pdfService.js` uses PDFKit instead of browser rendering, caps old-row meal/item rendering, strips unsafe text, buffers output, and applies a timeout.
- `src/features/planner/swapService.js` and `src/features/planner/controller.js` put wall-clock limits on interactive search paths.

### Observability

- `src/utils/metrics.js` covers HTTP latency, request sizes, response sizes, rate-limit outcomes, session rejections, app errors, database query/pool behavior, generation queue/worker outcomes, solver work, planner operations, PDF export, Firebase calls, and runtime metrics.
- `docs/observability.md` explains Prometheus and OTLP usage and calls out the serverless metrics aggregation problem.
- `observability/grafana/alerts.yaml` already includes error-rate, slow-API, session, rate-limit, rate-limit-store, and telemetry-missing alerts.

### CI and regression controls

- `.github/workflows/ci.yml` runs syntax/lint/tests, production dependency audit at high severity, and CodeQL.
- `playwright.config.js` starts a test server automatically.
- Tests cover route retirement, sessions, input hardening, worker memory limits, planner autosave behavior, metrics, food swaps, and browser flows.

## Top risks and required fixes

### P0: Add global backpressure for plan generation

Current state:

- `src/features/planner/generationPool.js` has a local queue per process.
- `GENERATION_WORKER_COUNT` defaults to at most 2 workers per process.
- `GENERATION_MAX_QUEUE` defaults to `workerCount * 4`.
- `POST /api/generate-plan` holds the HTTP request open until generation completes.

Why this matters:

At scale, every Vercel instance or PM2 process owns a separate queue. That protects each process but does not give the service a single global admission controller. A traffic spike can spin up many instances, each with its own workers, DB pool, memory footprint, and queue.

Recommendations:

- Move plan generation to a durable global queue such as BullMQ plus Redis/Upstash, SQS, Cloud Tasks, or a managed worker platform.
- Change generation to `POST /api/generation-jobs` returning `202 Accepted` with `jobId`, then poll or stream `GET /api/generation-jobs/:id`.
- Keep the existing worker-thread code inside the worker service, not on the request path.
- Enforce a global max in-flight generation count and a global queue-depth cap.
- Add per-account generation concurrency: for example, 1 active job plus 2 queued jobs per user.
- Keep the existing `generation-overloaded` behavior, but base it on global queue health.

Acceptance criteria:

- A load test that submits more generation requests than capacity should return fast `429` or `503` responses without growing app memory or DB connections.
- Generation queue depth, wait time, worker time, timeout rate, and overload rate must have production alerts.

### P0: Control serverless database connection fan-out

Current state:

- `src/config/database.js` defaults `DB_POOL_MAX` to 5.
- Vercel can create many concurrent function instances.
- The standalone PDF function and main API function can each initialize their own Sequelize pool.

Why this matters:

Total possible database connections are roughly:

```text
active Node instances * DB_POOL_MAX
+ active PDF function instances * DB_POOL_MAX
+ cron/internal instances * DB_POOL_MAX
```

With serverless scale-out, this can exceed Postgres or Neon pooler limits even when each instance looks conservative.

Recommendations:

- In Vercel production, set `DB_POOL_MAX=1` or `2` unless a pooler has been sized and verified.
- Use Neon's pooled connection URL or PgBouncer transaction pooling for serverless workloads.
- Put explicit database connection budgets in deployment docs:
  - max Vercel concurrency
  - DB max connections
  - pooler max clients
  - `DB_POOL_MAX`
  - expected PDF/generation concurrency
- Add an alert on `nutrition_database_pool_waiting > 0` and p95 acquire latency above 250 ms.
- Add a startup log that prints pool max/min and whether a pooler host is being used.

Acceptance criteria:

- During load tests, `nutrition_database_pool_waiting` stays at 0 or very briefly above 0.
- Postgres connection count remains below 70 percent of the allowed limit.

### P0: Move high-volume rate limiting out of Postgres

Current state:

- `src/utils/postgresRateLimitStore.js` performs one Postgres upsert per rate-limited request.
- `src/middleware/rateLimits.js` applies rate limiting broadly, including `/api`.

Why this matters:

Postgres-backed rate limits are much better than per-instance memory, but at large traffic they turn every request into a database write. During abuse or traffic spikes, the limiter can become a DB write amplifier.

Recommendations:

- Move request-rate counters to Redis/Upstash, Vercel KV, a WAF/firewall layer, or provider-native rate limiting.
- Keep Postgres for durable business data and per-account quotas.
- Apply edge or CDN rate limits before the request reaches Node.
- Keep fail-closed behavior for expensive scopes.
- Keep `nutrition_rate_limit_store_errors_total` style metrics for the new store.

Acceptance criteria:

- High-volume anonymous API traffic should not increase Postgres write IOPS linearly.
- Rate-limit store latency should be visible and alertable separately from Postgres latency.

### P1: Convert PDF export to a bounded async or cacheable workflow

Current state:

- `api/plan-export.js` is a dedicated Vercel function with `maxDuration: 60`.
- `src/features/plans/pdfService.js` renders into memory and returns a full Buffer.
- PDF export is rate-limited per account.

Why this matters:

PDF export is CPU and memory heavy. In-memory buffers are fine at current plan sizes, but concurrent exports can raise memory sharply. The function also fetches full `plan_data` and may bundle food icons.

Recommendations:

- Cache generated PDFs by `(plan_id, plan_version, clientName)` or by `(plan_id, plan_version)` if client names are excluded.
- Consider async PDF jobs if exports become frequent or plans become larger.
- Add an explicit PDF size ceiling and page-count metric.
- Stream PDF output if the hosting/runtime supports it safely.
- Keep the dedicated function, but ensure it has its own lower `DB_POOL_MAX` in serverless.

Acceptance criteria:

- A PDF export storm should rate-limit or queue without starving normal dashboard/auth requests.
- PDF p95 duration, error rate, and output size should have alerts.

### P1: Move interactive rebalance/swap CPU work off the main event loop

Current state:

- Full plan generation is in worker threads.
- `POST /api/rebalance-meal` and `POST /api/swap-suggestions` run CPU search on the request thread but have 2s/3s deadlines.

Why this matters:

Deadlines limit individual damage, but concurrent synchronous searches can still block the event loop and hurt unrelated requests.

Recommendations:

- Reuse worker-thread infrastructure for rebalance and swap suggestions.
- Alternatively, implement a tiny separate worker pool for planner operations.
- Lower default search deadlines if product quality remains acceptable.
- Add event-loop lag alerts if not already wired into Grafana.

Acceptance criteria:

- A concurrent swap/rebalance load test should not push event-loop p99 lag above 100 ms for sustained periods.

### P1: Upgrade large-list pagination and search

Current state:

- Dashboard lists are paginated and read summary columns.
- `src/features/dashboard/repository.js` uses `LIMIT/OFFSET`.
- Search uses `lower(...) LIKE '%query%'` patterns.
- `migrations/007_scalability_hardening.sql` has useful btree indexes, but not expression/trigram indexes for substring search.

Why this matters:

Offset pagination degrades as page numbers grow. Substring search with `%query%` cannot use a normal btree index effectively. These are acceptable at current account quotas but become bottlenecks at larger per-account data sizes.

Recommendations:

- Switch high-volume list APIs to keyset/cursor pagination:
  - plans cursor: `(updated_at, id)`
  - customers cursor: `(normalized_name, id)`
- Keep page numbers only for small pages or the first few pages.
- Add generated normalized columns or expression indexes:
  - `lower(btrim(customers.name))`
  - `lower(plans.name)`
- If substring search must stay, enable `pg_trgm` and add GIN trigram indexes.
- Revisit `INPUT_LIMITS.maxPage = 10000`; cap deep page access or convert it to cursor-only.

Acceptance criteria:

- `EXPLAIN ANALYZE` for list/search queries remains index-backed at 100k plans/customers per test account.

### P1: Replace per-insert quota scans with usage counters if quotas grow

Current state:

- `src/shared/accountQuotas.js` counts plans/customers and sums `pg_column_size(plan_data)` on every insert.
- Current caps are 2,000 plans, 1,000 customers, and 500 MB plan data per account.

Why this matters:

The current approach is safe and simple at these caps, but if account limits grow, repeated aggregate scans become expensive.

Recommendations:

- Keep current logic for now if limits stay as-is.
- Before raising quotas, add an `account_usage` table with transactional counters:
  - plan_count
  - customer_count
  - plan_data_bytes
  - updated_at
- Update counters inside the same plan/customer transactions.
- Add a repair job that can recompute usage from source rows.

Acceptance criteria:

- Insert/update/delete paths should remain O(1) with respect to account history.

### P1: Make static assets CDN-first and cache-stable

Current state:

- `public/css/styles.css` is about 285 KB.
- `public/js/planner/app.js` is about 129 KB.
- Static cache headers use short stale-while-revalidate for unhashed JS/CSS.
- Files are not bundled, minified, split, or content-hashed.
- `vercel.json` routes all paths through `/api/index.js`, while Express also serves static assets.

Why this matters:

At high traffic, static bytes dominate bandwidth and cold page cost. Without content hashes, long immutable caching is unsafe for core JS/CSS.

Recommendations:

- Add a build step that outputs content-hashed JS/CSS assets.
- Split planner/dashboard/account/auth bundles so pages load only their own code.
- Minify JS/CSS and add source maps outside production responses.
- Use `Cache-Control: public, max-age=31536000, immutable` for hashed assets.
- Move foods/preferences/catalog JSON to versioned static files where possible.
- Confirm whether Vercel static file serving can bypass the Express function for `/js`, `/css`, and `/food-icons`; prefer CDN/static serving over invoking Node.

Acceptance criteria:

- Core JS/CSS bundles have CI size budgets.
- Static asset requests do not invoke the Node API function in production.

### P2: Add production-like load and soak tests

Current state:

- CI covers functional, contract, security, and browser behavior.
- There is no repeatable load test or performance budget in CI.

Recommendations:

- Add k6, Artillery, or autocannon scenarios for:
  - anonymous page/static traffic
  - login/session validation
  - dashboard read traffic
  - plan save/update traffic
  - generation overload traffic
  - PDF export traffic
  - swap/rebalance concurrency
- Seed a synthetic database with large accounts:
  - 1k customers
  - 2k plans
  - large realistic `plan_data`
  - many sessions
  - many rate-limit rows
- Store baselines for p50/p95/p99 latency, error rate, DB acquire latency, event-loop lag, memory, and generation queue wait.
- Add a short CI smoke test and a longer pre-release/load-test workflow.

Acceptance criteria:

- Releases must publish a simple capacity note: tested RPS, p95 latency, error rate, DB connection count, memory, and generation throughput.

### P2: Complete alert coverage for the known bottlenecks

Current state:

- `docs/observability.md` lists many starter alerts.
- `observability/grafana/alerts.yaml` implements only a subset.

Recommendations:

- Add alerts for:
  - generation queue > 75 percent for 5 minutes
  - p95 generation queue wait > 1 second
  - generation timeout/worker restart rate
  - database pool waiting > 0 for 5 minutes
  - p95 DB acquire > 250 ms
  - event-loop lag p99 > 100 ms
  - RSS > 85 percent of runtime limit
  - PDF error rate > 2 percent
  - Firebase dependency error rate > 2 percent
  - rate-limit store latency/errors

Acceptance criteria:

- Every P0/P1 bottleneck has a dashboard panel and an alert.

### P2: Harden cleanup jobs and data lifecycle

Current state:

- Sessions and rate-limit rows are cleaned opportunistically.
- Account deletion has a protected cron recovery route.

Recommendations:

- Add scheduled cleanup for expired sessions and old rate-limit rows instead of relying only on request probability.
- Keep opportunistic cleanup as a fallback.
- Track cleanup duration and deleted-row counts.
- For large deployments, partition or aggressively TTL operational tables such as rate limits.

Acceptance criteria:

- Operational tables do not grow unbounded during low traffic or after abuse spikes.

## Recommended target architecture

### Near term

- Vercel or a long-running Node host serves pages and lightweight APIs.
- Static assets are content-hashed and served by CDN.
- Postgres uses a serverless-safe pooler.
- Redis/Upstash handles rate limits and global job/backpressure counters.
- Current worker-thread generation remains, but each app instance uses low worker counts and conservative queues.

### Medium term

- Generation and PDF exports move to a separate worker service.
- The web API creates jobs and returns quickly.
- Workers consume from a durable queue with global concurrency.
- Generated results are stored in Postgres or object storage with short TTL until saved.
- Dashboard/search APIs use keyset pagination and indexed normalized search.

### Mature high-scale posture

- CDN-first static/catalog delivery.
- Web API is horizontally scalable and mostly stateless.
- Background workers scale independently from web requests.
- Rate limiting and WAF run before Node.
- Database write-heavy operational concerns are off Postgres.
- Database read/write load is measured, indexed, and capacity planned.
- SLOs and alerts are enforced before every release.

## Concrete action plan

### Week 1: Make capacity visible

1. Add missing Grafana alerts from `docs/observability.md`.
2. Add a small load-test suite for dashboard reads, generation overload, plan saves, and PDF export.
3. Document production connection budgets and set serverless `DB_POOL_MAX` deliberately.
4. Add CI size budgets for `public/css/styles.css` and per-page JS files.
5. Add `EXPLAIN ANALYZE` notes for the dashboard/customer/plan list queries against a seeded large account.

### Weeks 2-3: Remove easy scaling cliffs

1. Move rate-limit counters from Postgres to Redis/Upstash or an edge/WAF solution.
2. Add keyset pagination for high-volume list endpoints.
3. Add normalized expression or trigram indexes for customer and plan search.
4. Move foods/preferences to versioned static JSON if product behavior allows it.
5. Split and hash JS/CSS assets.

### Weeks 4-6: Decouple expensive work

1. Add durable generation jobs and global queue limits.
2. Move generation workers out of the web request path.
3. Move PDF export to cached or async output.
4. Move swap/rebalance CPU work into a small worker pool.
5. Add per-account concurrency controls for expensive jobs.

### Ongoing

1. Run pre-release load tests.
2. Review slow query logs monthly.
3. Track p95/p99 latency by route and by app phase.
4. Keep dependency audits and CodeQL in CI.
5. Revisit quotas before raising them.

## Bottom line

The current codebase has strong local safeguards and would fail more gracefully than many apps: malformed input is bounded, expensive generation is isolated, dashboard queries avoid large JSON, and operational metrics exist. The remaining work is mostly about turning local safeguards into global scalability controls.

The highest-confidence path is:

1. Measure capacity with load tests.
2. Cap database connections deliberately.
3. Move rate limits out of Postgres.
4. Add global durable queues for generation and PDF work.
5. Fix search/pagination indexes before account data gets huge.
6. Make static assets CDN-first and cache-stable.

Do those, and the app moves from "carefully hardened single-service app" to "production system that degrades predictably under large traffic."
