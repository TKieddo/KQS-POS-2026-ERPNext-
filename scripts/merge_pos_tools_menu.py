import re
from pathlib import Path

"""Re-bundle pos_tools_menu.js into point_of_sale.js after editing the tools menu source file."""

root = Path(__file__).resolve().parents[1] / "kqs_retail" / "kqs_retail" / "public" / "js"
pos = root / "point_of_sale.js"
tools = root / "pos_tools_menu.js"
text = pos.read_text(encoding="utf-8")
start_marker = "/* Copyright (c) 2026, KQS — Tile-based POS tools menu"
end_marker = 'frappe.provide("kqs_retail.point_of_sale");'
start = text.find(start_marker)
end = text.find(end_marker)
if end < 0:
	raise SystemExit("Could not find point_of_sale block in point_of_sale.js")
tools_text = tools.read_text(encoding="utf-8")
tools_text = re.sub(
	r" \* After editing this file, run: python scripts/merge_pos_tools_menu\.py\n",
	"",
	tools_text,
)
tools_text = re.sub(
	r"const KQS_POS_TOOLS_MENU_VERSION = \d+;\n+",
	"",
	tools_text,
	count=1,
)
tools_text = tools_text.replace(
	'frappe.provide("kqs_retail.pos_tools_menu");',
	'const KQS_POS_TOOLS_MENU_VERSION = KQS_POS_PAGE_SCRIPT_VERSION;\n\nfrappe.provide("kqs_retail.pos_tools_menu");',
)
if start >= 0:
	pos.write_text(text[:start] + tools_text + "\n\n" + text[end:], encoding="utf-8")
else:
	pos.write_text(text[:end] + tools_text + "\n\n" + text[end:], encoding="utf-8")
print("Re-merged pos_tools_menu.js into point_of_sale.js")
