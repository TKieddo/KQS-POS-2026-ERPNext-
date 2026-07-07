#!/bin/bash
# One-shot ownership fix for shared Docker volumes (frappe user cannot bench build as root).
set -euo pipefail

mkdir -p /home/frappe/frappe-bench/sites/assets
chown -R frappe:frappe /home/frappe/frappe-bench/sites/assets
chown -R frappe:frappe /home/frappe/frappe-bench/apps/frappe/frappe/public/dist
chown -R frappe:frappe /home/frappe/frappe-bench/apps/erpnext/erpnext/public/dist
echo "Asset volume permissions ready"
