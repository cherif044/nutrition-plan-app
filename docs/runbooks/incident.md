# Security incident runbook

Use this when a secret may have leaked, an account may be taken over, or the
app is being abused. Work top to bottom; skip what clearly does not apply.
Write down what you did and when as you go.

## 1. One account is compromised

- Ask the owner to reset their password, or do it for them in Firebase
  console → Authentication → user → *Reset password*. Within 5 minutes every
  app session of that user ends (the session check compares Firebase's
  `tokensValidAfterTime`).
- To end sessions immediately: the user can use *Account → Sign out
  everywhere*, or run:
  ```sql
  UPDATE users SET token_version = token_version + 1 WHERE id = <user id>;
  UPDATE sessions SET revoked_at = now() WHERE user_id = <user id> AND revoked_at IS NULL;
  ```
- To lock the account out entirely: Firebase console → *Disable account*.

## 2. Sign every user out

```sql
UPDATE users SET token_version = token_version + 1;
UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;
```

## 3. Rotate secrets

Rotate whichever may be exposed; when unsure, rotate all. Update each value in
Vercel → Project → Settings → Environment Variables (Production *and*
Preview, which must have different values), then redeploy.

| Secret | How | Effect |
|---|---|---|
| `JWT_SECRET` | `openssl rand -base64 48` | Every session ends at once. |
| Firebase service account key | GCP console → IAM → Service accounts → Keys → add new, delete old | Update `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL`. |
| Neon database password | Neon console → Roles → `app_runtime` → *Reset password* | Update `DATABASE_URL`. |
| `METRICS_TOKEN` / Grafana OTLP token | Grafana Cloud → Access policies → rotate token | Update `METRICS_TOKEN`, `OTEL_EXPORTER_OTLP_HEADERS`. |
| `CRON_SECRET` | `openssl rand -base64 32` | Vercel Cron picks up the new value on redeploy. |
| `IP_HASH_SECRET` | `openssl rand -base64 32` | Log IP hashes stop matching older ones. |

## 4. Abuse or flooding

- Check the *Rate limit* and *Session rejections* panels and the
  `Rate limit exceeded` logs grouped by `ipHash` / `userId`.
- Add a Vercel Firewall rule (Project → Firewall) to block or rate-limit the
  source before it reaches the app.

## 5. Data loss or corruption

Follow `docs/runbooks/restore.md`.

## 6. Afterwards

- Search logs for the incident window by `requestId`, `userId` and `ipHash`.
- Tell affected users what happened and what they should do.
- Add a regression test and a row to the security test backlog.
