#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-nutrition-plan-app}"
REPO_URL="${REPO_URL:-https://github.com/cherif044/nutrition-plan-app.git}"
REPO_BRANCH="${REPO_BRANCH:-last_approach_only_ready_meals}"
APP_DIR="${APP_DIR:-/var/www/${APP_NAME}}"
APP_PORT="${PORT:-3000}"
NODE_MAJOR="${NODE_MAJOR:-22}"

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as the ubuntu user, not root."
  exit 1
fi

echo "==> Installing system packages"
sudo apt-get update
sudo apt-get install -y ca-certificates curl git gnupg nginx build-essential iptables-persistent

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(\".\")[0])')" -lt 20 ]]; then
  echo "==> Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Installing PM2"
sudo npm install -g pm2

echo "==> Creating app directory"
sudo mkdir -p "$(dirname "${APP_DIR}")"
if [[ ! -d "${APP_DIR}/.git" ]]; then
  sudo git clone --branch "${REPO_BRANCH}" --single-branch "${REPO_URL}" "${APP_DIR}"
  sudo chown -R "${USER}:${USER}" "${APP_DIR}"
else
  sudo chown -R "${USER}:${USER}" "${APP_DIR}"
  git -C "${APP_DIR}" pull --ff-only
fi

cd "${APP_DIR}"

echo "==> Installing app dependencies"
npm ci --omit=dev

if [[ ! -f .env ]]; then
  echo "==> Creating ${APP_DIR}/.env from .env.example"
  cp .env.example .env
  chmod 600 .env
  cat <<ENV_NOTE

IMPORTANT: Edit ${APP_DIR}/.env before starting the app:

  nano ${APP_DIR}/.env

Put your real DATABASE_URL, GEMINI_API_KEY, JWT_SECRET, DB_SSL=true, NODE_ENV=production.

ENV_NOTE
fi

echo "==> Configuring nginx reverse proxy"
sudo tee "/etc/nginx/sites-available/${APP_NAME}" >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name _;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

sudo ln -sf "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t

echo "==> Opening local VM firewall ports for HTTP/HTTPS"
sudo iptables -C INPUT -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null \
  || sudo iptables -I INPUT -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null \
  || sudo iptables -I INPUT -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
sudo systemctl restart nginx

cat <<DONE

Server setup is ready.

Next:
  1. Edit env vars:
       nano ${APP_DIR}/.env

  2. Start the app:
       cd ${APP_DIR}
       pm2 start ecosystem.config.cjs
       pm2 save
       sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ${USER} --hp ${HOME}

  3. Test on the server:
       curl -I http://127.0.0.1:${APP_PORT}
       curl -I http://localhost

DONE
