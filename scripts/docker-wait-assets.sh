#!/bin/bash
# Wait until shared dist volumes contain bundles referenced by assets.json.
set -euo pipefail

cd /home/frappe/frappe-bench

echo "Waiting for shared dist assets..."
for _ in $(seq 1 180); do
	if [ -f sites/assets/assets.json ] && [ -n "$(ls -A apps/frappe/frappe/public/dist/css 2>/dev/null || true)" ]; then
		if python3 - <<'PY'
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
		then
			name=$(python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path("sites/assets/assets.json").read_text())
print(data["desk.bundle.css"].rsplit("/", 1)[-1])
PY
)
			echo "Dist assets ready ($name)"
			exit 0
		fi
	fi
	sleep 2
done

echo "Timed out waiting for dist assets — check backend logs for bench build"
exit 1
