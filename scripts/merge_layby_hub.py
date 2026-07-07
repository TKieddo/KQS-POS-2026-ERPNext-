from pathlib import Path

"""Re-bundle pos_layby_hub.js into point_of_sale.js after editing the hub source file."""

root = Path(__file__).resolve().parents[1] / "kqs_retail" / "kqs_retail" / "public" / "js"
pos = root / "point_of_sale.js"
hub = root / "pos_layby_hub.js"
text = pos.read_text(encoding="utf-8")
start_marker = "/* Copyright (c) 2026, KQS — Full-screen Layby Lookup"
end_marker = "/* Copyright (c) 2026, KQS — Tile-based POS tools menu"
start = text.find(start_marker)
end = text.find(end_marker)
if start < 0 or end < 0:
	raise SystemExit("Could not find hub block in point_of_sale.js")
hub_text = hub.read_text(encoding="utf-8").replace(
	"const KQS_LAYBY_HUB_VERSION = 1;",
	"const KQS_LAYBY_HUB_VERSION = KQS_POS_PAGE_SCRIPT_VERSION;",
)
pos.write_text(text[:start] + hub_text + "\n\n" + text[end:], encoding="utf-8")
print("Re-merged pos_layby_hub.js into point_of_sale.js")
