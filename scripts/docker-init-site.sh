#!/bin/bash
set -euo pipefail

cd /home/frappe/frappe-bench

wait-for-it -t 120 db:3306
wait-for-it -t 120 redis-cache:6379
wait-for-it -t 120 redis-queue:6379

export start=$(date +%s)
until [[ -n $(grep -hs ^ sites/common_site_config.json | jq -r ".db_host // empty") ]] && \
      [[ -n $(grep -hs ^ sites/common_site_config.json | jq -r ".redis_cache // empty") ]] && \
      [[ -n $(grep -hs ^ sites/common_site_config.json | jq -r ".redis_queue // empty") ]]; do
  echo "Waiting for sites/common_site_config.json..."
  sleep 5
  if (( $(date +%s) - start > 120 )); then
    echo "Timeout waiting for common_site_config.json"
    exit 1
  fi
done

echo "sites/common_site_config.json found"

if [ ! -d "sites/frontend" ]; then
  bench new-site \
    --mariadb-user-host-login-scope='%' \
    --admin-password=admin \
    --db-root-username=root \
    --db-root-password=admin \
    --install-app erpnext \
    --set-default frontend
  echo "Site frontend created"
else
  echo "Site frontend already exists"
fi

# Install kqs_retail if mounted
if [ -d "apps/kqs_retail" ]; then
  ./env/bin/pip install -q -e ./apps/kqs_retail 2>/dev/null || true
  if ! bench --site frontend list-apps 2>/dev/null | grep -q kqs_retail; then
    bench --site frontend install-app kqs_retail
    echo "kqs_retail installed"
  fi
  bench --site frontend set-config developer_mode 1
  bench --site frontend migrate
fi

echo "ERPNext ready at http://localhost:8080 — Administrator / admin"
