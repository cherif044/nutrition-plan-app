# Grafana setup

Metrics and logs are pushed to Grafana Cloud over OTLP by
`src/utils/otelMetrics.js`. Required Vercel environment variables:

| Variable | Value |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `https://otlp-gateway-prod-<region>.grafana.net/otlp` |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Authorization=Basic%20<base64 of instanceId:token>` |

The token needs the `metrics:write` and `logs:write` scopes. Set
`OTEL_LOGS_ENABLED=false` to stop exporting logs.

## Dashboard

Dashboards → New → Import → upload `dashboard.json`. The Metrics and Logs
selectors at the top pick your `grafanacloud-*-prom` and `grafanacloud-*-logs`
data sources automatically.

## Alerts

Create a contact point first (Alerting → Contact points → email), then for
each rule in `alerts.yaml`:

1. Alerting → Alert rules → New alert rule.
2. Data source: `grafanacloud-*-prom`, Code mode, paste the whole `expr`.
   It already contains the threshold, so it only returns a value while firing.
3. Expressions: set the Threshold to "Is above" `0`.
4. Evaluation: folder `Nutrition Plan`, group `nutrition-plan-app`, every `1m`,
   pending period `5m` (errors) or `10m` (latency).
5. Configure no data and error handling → Alert state if no data: **Normal**.
   A serverless app with no traffic sends nothing, which is not an outage.
6. Pick the contact point and save.

## Useful queries

- Logs for one request: `{service_name="nutrition-plan-app"} | json | requestId="<id from X-Request-Id>"`
- All 5xx with stack traces: `{service_name="nutrition-plan-app"} | json | message="Request failed"`
