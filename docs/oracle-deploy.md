# Oracle Always Free Deploy

This app needs a normal Node.js server. The database is remote Postgres through `DATABASE_URL`, and AI is remote Gemini through `GEMINI_API_KEY`.

## What only you need to do

1. Create an Oracle Cloud account.
2. Create an Always Free VM instance.
3. Copy the SSH command from Oracle and connect from your Mac.
4. Add Oracle ingress rules for ports `80` and `443`.
5. Paste your real secrets into `.env` on the server.

Everything else is handled by `scripts/deploy/oracle-setup.sh`.

## VM choices

Choose Ubuntu. If Oracle offers Ampere A1 Always Free, use it. If not, use the Always Free micro VM. Either is fine for a small tester group because Postgres and Gemini are remote.

## Run on the server

After SSH-ing into the VM:

```bash
curl -fsSL https://raw.githubusercontent.com/cherif044/nutrition-plan-app/last_approach_only_ready_meals/scripts/deploy/oracle-setup.sh -o oracle-setup.sh
chmod +x oracle-setup.sh
./oracle-setup.sh
```

Then edit env vars:

```bash
nano /var/www/nutrition-plan-app/.env
```

Required production values:

```bash
DATABASE_URL=postgresql://...
DB_SSL=true
JWT_SECRET=...
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_MAX_OUTPUT_TOKENS=8192
GEMINI_TIMEOUT_MS=120000
NODE_ENV=production
PORT=3000
```

Generate a JWT secret on your Mac or on the server:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Start the app:

```bash
cd /var/www/nutrition-plan-app
pm2 start ecosystem.config.cjs
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
sudo systemctl restart nginx
```

Check it:

```bash
curl -I http://127.0.0.1:3000
curl -I http://localhost
```

Then open:

```text
http://YOUR_ORACLE_PUBLIC_IP
```

## Oracle networking

In the Oracle dashboard, open the instance's Virtual Cloud Network or subnet security list and add ingress rules:

| Source CIDR | Protocol | Destination port |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

Keep SSH port `22` limited to your own IP if Oracle lets you set that easily.

## Updating later

When you push new code to GitHub:

```bash
ssh ubuntu@YOUR_ORACLE_PUBLIC_IP
cd /var/www/nutrition-plan-app
git pull --ff-only
npm ci --omit=dev
pm2 restart nutrition-plan-app
```

## Useful commands

```bash
pm2 status
pm2 logs nutrition-plan-app
sudo nginx -t
sudo systemctl status nginx
```
