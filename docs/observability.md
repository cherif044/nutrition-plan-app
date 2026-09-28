# Production Observability

The application exposes Prometheus metrics at `GET /metrics`. Metrics are
monitoring-only and do not change planner behavior.

## Access

Set these production variables:

```env
METRICS_ENABLED=true
METRICS_TOKEN=a-long-random-secret
```

Scrapers may send either `Authorization: Bearer <token>` or
`X-Metrics-Token: <token>`. Production returns `404` when no token is
configured, preventing accidental public exposure. Metrics can be disabled
with `METRICS_ENABLED=false`.

Example Prometheus job:

```yaml
scrape_configs:
  - job_name: nutrition-plan-app
    static_configs:
      - targets: ['app:3000']
    authorization:
      credentials: '<METRICS_TOKEN>'
```

Scrape every long-running application instance directly. A load-balanced
`/metrics` URL only exposes the instance selected for that request. Serverless
instances are short-lived, so Vercel production should forward equivalent
metrics to a managed observability backend rather than treating this endpoint
as a complete fleet-wide history.

## Metric Catalog

### HTTP and errors

- `nutrition_http_requests_total`: throughput and status classes by normalized route.
- `nutrition_http_request_duration_seconds`: end-to-end API/page latency.
- `nutrition_http_time_to_first_byte_seconds`: time before a response begins.
- `nutrition_http_request_size_bytes`: incoming payload sizes.
- `nutrition_http_response_size_bytes`: response/network payload sizes.
- `nutrition_http_requests_in_flight`: current request concurrency.
- `nutrition_http_connections_active` / `total`: connection pressure and churn.
- `nutrition_http_aborted_total`: clients or proxies disconnecting before completion.
- `nutrition_rate_limit_exceeded_total`: rejected requests by limiter scope.
- `nutrition_errors_total`: database, timeout, overload, validation, authentication, and internal errors.
- `nutrition_cold_starts_total`: first requests handled by new processes.

### Generation workers and solver

- `nutrition_generation_jobs_total`: outcomes by diet, meal count, and Ramadan mode.
- `nutrition_generation_duration_seconds`: queue, worker execution, and total latency.
- `nutrition_generation_queue_depth` / `capacity`: saturation and waiting work.
- `nutrition_generation_workers`: configured, ready, and busy workers.
- `nutrition_generation_worker_restarts_total`: crashes, exits, and timeout replacements.
- `nutrition_generation_restrictions`: request-complexity distribution.
- `nutrition_generation_result_items`: generated food-item count.
- `nutrition_generation_result_alternatives`: returned alternate-meal count.
- `nutrition_solver_slot_duration_seconds`: solve latency by meal tag.
- `nutrition_solver_template_duration_seconds`: template-solving work per meal slot.
- `nutrition_solver_grid_visits`: total and maximum combination-search nodes.
- `nutrition_solver_candidates`: templates, solved, accepted, rejected, and failed candidates.

These solver metrics should be observed before introducing limits. Compare
successful requests against slow/failed requests to find the point where more
search work stops improving outcomes.

### Database

- `nutrition_database_query_duration_seconds`: query latency by operation/model.
- `nutrition_database_queries_total`: query volume and transaction usage.
- `nutrition_database_pool_acquire_duration_seconds`: connection wait latency.
- `nutrition_database_pool_size`: local connection count.
- `nutrition_database_pool_available`: idle connections.
- `nutrition_database_pool_in_use`: busy connections.
- `nutrition_database_pool_waiting`: requests blocked on the pool.

### Planner, PDF, and dependencies

- `nutrition_planner_operation_duration_seconds`: swap/rebalance latency.
- `nutrition_planner_operations_total`: outcomes for swaps and rebalances.
- `nutrition_planner_operation_items`: input items and returned candidates.
- `nutrition_pdf_export_duration_seconds`: PDF render latency.
- `nutrition_pdf_exports_total`: successful and failed exports.
- `nutrition_pdf_export_size_bytes`: PDF output size.
- `nutrition_dependency_call_duration_seconds`: Firebase latency.
- `nutrition_dependency_calls_total`: Firebase success/error counts.
- `nutrition_app_phase_duration_seconds`: auth, user lookup, generation, and save phases.

### Node runtime

Metrics prefixed with `nutrition_nodejs_` cover process CPU, resident/heap
memory, garbage collection, active handles, event-loop lag/utilization, and
Node.js version. Some file-descriptor and memory metrics are Linux-only.

## Initial Dashboards

1. Traffic: requests/second, status classes, p50/p95/p99 latency, and payload sizes.
2. Generation: queue depth, busy workers, p95/p99 queue/worker time, outcomes, and restarts.
3. Solver: p95 grid visits and candidate counts against successful/impossible outcomes.
4. Database: p95 query/acquire latency, pool usage, pool waiting, and query volume.
5. Runtime: CPU, heap/RSS, event-loop lag/utilization, GC, and process restarts.
6. Features: PDF, rebalance, swap, auth, and save latency/error rates.

## Starter Alerts

Tune thresholds after collecting a normal production baseline:

- Error rate above 2% for 5 minutes.
- p95 API latency above 1 second for 10 minutes, excluding generation/PDF.
- p95 generation queue wait above 1 second for 5 minutes.
- Generation queue above 75% capacity for 5 minutes.
- Any sustained generation worker restart rate.
- Database pool waiting above zero for 5 minutes.
- p95 database acquire time above 250 ms for 5 minutes.
- Event-loop p99 lag above 100 ms for 5 minutes.
- RSS above 85% of the container limit.
- PDF or Firebase error rate above 2% for 10 minutes.

## Privacy and Cardinality

Metrics never include user/customer identifiers, names, emails, plan contents,
request bodies, raw SQL, query strings, request IDs, IP addresses, or exception
messages. Dynamic URL identifiers are normalized to `:id`. New labels must use
small predefined value sets; high-cardinality values belong in logs or traces.
