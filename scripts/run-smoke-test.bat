@echo off
REM Run ERPNext seed + POS smoke tests inside Docker (after stack is up)
cd /d "%~dp0..\docker"
docker compose -f compose.dev.yml exec backend bench --site frontend execute kqs_retail.setup.seed_kqs_demo.seed
docker compose -f compose.dev.yml exec backend bench --site frontend execute kqs_retail.setup.seed_kqs_demo.smoke_test_pos
docker compose -f compose.dev.yml exec backend bench --site frontend execute kqs_retail.setup.seed_kqs_demo.smoke_test_layby
echo Done. Open http://localhost:8080/app/point-of-sale
echo Cashier: cashier@kqs.local / kqs123
