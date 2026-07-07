#!/bin/bash
# Ensure frappe/erpnext dist bundles match sites/assets/assets.json.
# Used on backend startup in Docker dev (shared dist volumes with frontend/nginx).
set -euo pipefail

cd /home/frappe/frappe-bench

ASSETS_JSON="sites/assets/assets.json"
DIST_CSS="apps/frappe/frappe/public/dist/css"

assets_match_manifest() {
	if [ ! -f "$ASSETS_JSON" ]; then
		return 1
	fi
	if [ ! -d "$DIST_CSS" ] || [ -z "$(ls -A "$DIST_CSS" 2>/dev/null || true)" ]; then
		return 1
	fi
	python3 - <<'PY'
import json
from pathlib import Path

assets_json = Path("sites/assets/assets.json")
dist_css = Path("apps/frappe/frappe/public/dist/css")
data = json.loads(assets_json.read_text())
desk = data.get("desk.bundle.css", "")
if not desk:
    raise SystemExit(1)
name = desk.rsplit("/", 1)[-1]
raise SystemExit(0 if (dist_css / name).is_file() else 1)
PY
}

if assets_match_manifest; then
	echo "Frontend assets already match assets.json"
else
	echo "Building frontend assets (dist volume empty or stale vs assets.json)..."
	bench build --production
	if [ -d sites/frontend ]; then
		bench --site frontend clear-cache
	fi
fi
