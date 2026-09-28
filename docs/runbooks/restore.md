# Restore from backup

Backups come from three places:

1. **Neon history (point-in-time restore).** Covers the retention window of
   the Neon plan. Fastest for "undo the last few hours".
2. **Weekly encrypted dump** from `.github/workflows/backup.yml`, kept 90 days
   as a GitHub Actions artifact. It is independent of Neon and of the app's
   database role.
3. **Firebase Auth user export** in the same artifact (if configured).

## Restore a weekly dump into a Neon branch

1. Neon console → Branches → *Create branch* (e.g. `restore-YYYYMMDD`), empty or
   from any point. Copy its owner connection string as `RESTORE_URL`.
2. GitHub → Actions → *Weekly backup* → pick the run → download
   `backup-<run id>.zip` and unzip it.
3. Decrypt with the offline private key:
   ```bash
   gpg --decrypt db.dump.gpg > db.dump
   ```
4. Restore:
   ```bash
   docker run --rm -i -e RESTORE_URL postgres:17 sh -c 'pg_restore --no-owner --no-privileges --dbname "$RESTORE_URL"' < db.dump
   ```
5. Check it, comparing with production:
   ```sql
   SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM plans) plans,
          (SELECT count(*) FROM customers) customers, (SELECT count(*) FROM folders) folders;
   -- every plan belongs to an existing user
   SELECT count(*) FROM plans p LEFT JOIN users u ON u.id = p.user_id WHERE u.id IS NULL;   -- expect 0
   SELECT count(*) FROM plans p LEFT JOIN customers c ON c.id = p.customer_id
     WHERE p.customer_id IS NOT NULL AND (c.id IS NULL OR c.user_id <> p.user_id);        -- expect 0
   ```
6. To switch production to the restored data, point Vercel's `DATABASE_URL`
   at the restored branch (using the `app_runtime` role), redeploy, then
   delete the dump files from your machine:
   ```bash
   shred -u db.dump db.dump.gpg 2>/dev/null || rm -P db.dump db.dump.gpg
   ```

## Restore Firebase users

```bash
gpg --decrypt users.json.gpg > users.json
npx firebase-tools auth:import users.json --project <project-id> --hash-algo=SCRYPT \
  --hash-key=<from Firebase console: Authentication → Users → ⋮ → Password hash parameters> \
  --salt-separator=<...> --rounds=<...> --mem-cost=<...>
```

## Restore drill

Do one timed restore after setting this up, and then once a quarter. Record
the date, how long each step took, and the row counts here:

| Date | Dump age | Time to restored branch | Row counts match | Notes |
|---|---|---|---|---|
| | | | | |
