# Copyright (c) 2026, KQS
"""Bulk stock import: CSV + paper AI → preview → create / add_variant / receive."""

from __future__ import annotations

import csv
import io
import json
import re
import time
import uuid
from difflib import SequenceMatcher

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

from kqs_retail.api.product_setup import (
	_normalize_item_code,
	add_variants_to_product,
	create_product_with_variants,
	_ensure_attribute_value,
	_repair_duplicate_attribute_abbrs,
)
from kqs_retail.api.stock_receive import receive_stock
from kqs_retail.utils.ai_provider import (
	complete_chat,
	complete_vision,
	get_ai_config,
	parse_json_from_ai_text,
)
from kqs_retail.utils.defaults import get_default_company
from kqs_retail.utils.manager_access import assert_stock_manager
from kqs_retail.utils.warehouses import (
	get_kqs_central_warehouse,
	is_kqs_store_warehouse,
	list_kqs_warehouse_choices,
)

DITTO_TOKENS = {'"', "''", "“", "”", "„", "…", "....", "...", "····"}
COLOR_REPLACEMENTS = (
	(r"\bdk\b", "Dark"),
	(r"\blt\b", "Light"),
	(r"blackmono", "Black Mono"),
	(r"black\s*mono", "Black Mono"),
	(r"navy\s*mon\b", "Navy Mono"),
)

# Known-good retail spellings (not limited to what already exists in the catalog).
# Used to suggest "Nike snicker" → "Nike sneaker" even when neither name is on file yet.
SPELLING_LEXICON = frozenset(
	{
		# product types
		"sneaker",
		"sneakers",
		"takkies",
		"takkie",
		"shoe",
		"shoes",
		"boot",
		"boots",
		"sandal",
		"sandals",
		"slipper",
		"slippers",
		"loafer",
		"loafers",
		"trainer",
		"trainers",
		"sportbag",
		"sportbags",
		"sidebag",
		"sidebags",
		"schoolbag",
		"schoolbags",
		"backpack",
		"backpacks",
		"handbag",
		"handbags",
		"crossbody",
		"tote",
		"belt",
		"belts",
		"wallet",
		"wallets",
		"cap",
		"caps",
		"hat",
		"hats",
		"beanie",
		"jacket",
		"jackets",
		"hoodie",
		"hoodies",
		"tshirt",
		"t-shirt",
		"shirt",
		"shirts",
		"jeans",
		"trouser",
		"trousers",
		"shorts",
		"sock",
		"socks",
		"watch",
		"watches",
		"sunglass",
		"sunglasses",
		"vulcanised",
		"vulcanized",
		# common brands (correct spellings)
		"nike",
		"adidas",
		"puma",
		"reebok",
		"converse",
		"vans",
		"new balance",
		"asics",
		"skechers",
		"fila",
		"under armour",
		"soviet",
		"guess",
		"levis",
		"levi's",
		"timberland",
		"caterpillar",
		"crocs",
		"havaianas",
	}
)

# Exact / near-certain misspellings → preferred spelling (word level).
SPELLING_ALIASES = {
	"snicker": "sneaker",
	"snickers": "sneakers",
	"sniker": "sneaker",
	"snikers": "sneakers",
	"sneeker": "sneaker",
	"snekers": "sneakers",
	"snekar": "sneaker",
	"takies": "takkies",
	"tackies": "takkies",
	"tacky": "takkie",
	"sport bag": "sportbag",
	"sportbags": "sportbags",
	"sporbag": "sportbag",
	"spartbag": "sportbag",
	"side bag": "sidebag",
	"sidbag": "sidebag",
	"school bag": "schoolbag",
	"schollbag": "schoolbag",
	"addidas": "adidas",
	"adiddas": "adidas",
	"adidass": "adidas",
	"nkie": "nike",
	"nikie": "nike",
	"reebokc": "reebok",
	"reeebok": "reebok",
	"convers": "converse",
	"convese": "converse",
	"skecher": "skechers",
	"sketchers": "skechers",
	"sketches": "skechers",
	"underarmour": "under armour",
	"underarmer": "under armour",
	"newbalance": "new balance",
	"vulcanised": "vulcanised",
	"vulcanied": "vulcanised",
	"vulcanizd": "vulcanized",
	"tshirt": "t-shirt",
	"tshrit": "t-shirt",
	"jeanss": "jeans",
}

EXTRACT_PROMPT = """Extract every stock line from this photo of a handwritten or printed stock list.

Paper columns (typical order):
1. Name / type (T-Shirt, Sweater, Sidebag…) — ditto " means same as row above
2. Style number (PD2-7056, AXEL, J0492…)
3. Color — may be a dual-tone like white/black or white/blue (ONE color value, not two products)
4. Size + qty tokens — often several on the SAME line
5. Price — often written as > 70 or > 65.00

CRITICAL size/qty formats (kids clothes & shoes):
- (8/9)/2 or 8/9/2 or 8-9/2 means SIZE range 8–9 years with QTY 2 → emit size_raw "8-9", qty_raw "2"
- 9-10/3 means SIZE 9–10 with QTY 3
- 6/2 means SIZE 6 with QTY 2
- One handwritten line may list MANY tokens: 8/9/2 9/10/1 10/11/2 13/14/1
  → You MUST emit ONE JSON row per token (same name, style, color, price; different size_raw + qty_raw).
  Never keep only the first size when more tokens are written.

Colors with a slash (white/black, Grey/DK Grey) are a single Color attribute value (dual-tone garment). Do NOT split into two rows.

Skip lines that are clearly crossed out / struck through.
Ditto marks: " or '' means repeat Name (and Style when two dittos) from the row above.

Allowed Item Group (category) names — pick suggested_category when possible, or null:
{category_list}

Return ONLY JSON:
{{
  "rows": [
    {{
      "name_raw": "T-Shirt",
      "style_raw": "PD2-7056",
      "color_raw": "green",
      "size_raw": "8-9",
      "qty_raw": "2",
      "price": 70,
      "suggested_category": "Kids",
      "confidence": 0.9
    }}
  ]
}}

Keep ditto marks as literal " in name_raw/style_raw when present so the server can re-resolve.
Do not invent prices. Include every non-struck line. Expand every size/qty token to its own row.
suggested_category MUST be one of the allowed Item Group names above, or null if unsure.
"""


# Kids / footwear size+qty tokens from paper: (8/9)/2, 8/9/2, 8-9/2, 6/2
_SIZE_QTY_TOKEN_RE = re.compile(
	r"(?:"
	r"\(?\s*(?P<a>\d+(?:\.\d+)?)\s*[/\-]\s*(?P<b>\d+(?:\.\d+)?)\s*\)?\s*/\s*(?P<q1>\d+(?:\.\d+)?)"
	r"|"
	r"(?P<s>\d+(?:\.\d+)?)\s*/\s*(?P<q2>\d+(?:\.\d+)?)"
	r")"
)


def _looks_like_kids_age_range(a: float, b: float) -> bool:
	"""8/9 alone is usually ages 8–9, not size 8 qty 9."""
	if a <= 0 or b <= 0:
		return False
	if b <= a:
		return False
	if (b - a) > 2.5:
		return False
	# Typical kids year sizes / EU shoe ranges written on paper
	return a <= 16 and b <= 18


def _parse_size_qty_tokens(text: str) -> list[tuple[str, float]]:
	"""Parse paper tokens into (size_label, qty) pairs. Prefers range forms over size/qty."""
	raw = cstr(text).strip()
	if not raw:
		return []
	found: list[tuple[str, float]] = []
	for m in _SIZE_QTY_TOKEN_RE.finditer(raw):
		if m.group("a") is not None:
			size = f"{m.group('a')}-{m.group('b')}"
			qty = flt(m.group("q1"))
		else:
			a = flt(m.group("s"))
			b = flt(m.group("q2"))
			# Bare 8/9 (no third number) → kids age range, not size/qty
			if _looks_like_kids_age_range(a, b):
				continue
			size = cstr(m.group("s"))
			qty = b
		if qty <= 0:
			continue
		found.append((size, qty))
	return found


def _normalize_size_label(raw: str) -> str:
	"""(8/9) or 8/9 → 8-9 when it is a bare age range."""
	t = cstr(raw).strip()
	if not t:
		return ""
	m = re.fullmatch(
		r"\(?\s*(\d+(?:\.\d+)?)\s*[/\-]\s*(\d+(?:\.\d+)?)\s*\)?",
		t,
	)
	if m and _looks_like_kids_age_range(flt(m.group(1)), flt(m.group(2))):
		return f"{m.group(1)}-{m.group(2)}"
	m2 = re.fullmatch(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)", t)
	if m2:
		return f"{m2.group(1)}-{m2.group(2)}"
	return t


def _blob_for_size_qty(row: dict) -> str:
	"""Combine fields where writers jam sizes+qtys together."""
	size = cstr(row.get("size_raw") or row.get("size") or "").strip()
	qty = cstr(row.get("qty_raw") or "").strip()
	variants = cstr(row.get("variants_raw") or "").strip()
	if size and _parse_size_qty_tokens(size):
		return size
	if variants and _parse_size_qty_tokens(variants):
		return variants
	if qty and _parse_size_qty_tokens(qty):
		return f"{size} {qty}".strip()
	if size and qty and _parse_size_qty_tokens(f"{size} {qty}"):
		return f"{size} {qty}".strip()
	return " ".join(p for p in (size, qty, variants) if p).strip()


def expand_multi_size_qty_rows(rows: list[dict]) -> list[dict]:
	"""One paper line with 8/9/2 9/10/1 → one draft row per size/qty."""
	out: list[dict] = []
	for row in rows or []:
		if cint(row.get("_qty_edited")) and cstr(row.get("size") or "").strip():
			# Staff already set size+qty — do not re-split.
			row = dict(row)
			row["size"] = _normalize_size_label(row.get("size") or "")
			out.append(row)
			continue
		blob = _blob_for_size_qty(row)
		tokens = _parse_size_qty_tokens(blob)
		if len(tokens) >= 1 and ("/" in blob or re.search(r"\d\s*-\s*\d\s*/", blob)):
			base = dict(row)
			for size, qty in tokens:
				clone = dict(base)
				clone["row_id"] = f"r-{uuid.uuid4().hex[:10]}"
				clone["size_raw"] = size
				clone["size"] = size
				clone["qty_raw"] = str(int(qty) if qty == int(qty) else qty)
				clone["qty"] = qty
				clone["_qty_edited"] = 1
				out.append(clone)
			continue
		row = dict(row)
		row["size"] = _normalize_size_label(row.get("size") or row.get("size_raw") or "")
		if row["size"]:
			row["size_raw"] = row["size"]
		out.append(row)
	return out


def _category_list_for_prompt(limit: int = 120) -> str:
	names = frappe.get_all(
		"Item Group",
		filters={"is_group": 0},
		pluck="name",
		order_by="name",
		limit_page_length=limit,
	)
	if not names:
		return "(none configured)"
	return "\n".join(f"- {n}" for n in names)


def _loads(raw, default=None):
	if raw is None or raw == "":
		return default if default is not None else {}
	if isinstance(raw, (dict, list)):
		return raw
	return json.loads(raw)


def _dumps(obj) -> str:
	return json.dumps(obj, ensure_ascii=False)


def _norm_text(value: str) -> str:
	return re.sub(r"\s+", " ", cstr(value).strip().lower())


def _is_ditto(token: str) -> bool:
	t = cstr(token).strip()
	if not t:
		return True
	if t in DITTO_TOKENS:
		return True
	if re.fullmatch(r"[\"'`.·.…]+", t):
		return True
	return False


def _normalize_color(raw: str) -> str:
	text = cstr(raw).strip()
	if not text:
		return ""
	lower = text.lower()
	for pattern, repl in COLOR_REPLACEMENTS:
		lower = re.sub(pattern, repl.lower(), lower, flags=re.I)
	parts = []
	for chunk in lower.split("/"):
		words = [w.capitalize() if w else "" for w in chunk.strip().split()]
		parts.append(" ".join(words))
	return "/".join(parts)


def _parse_qty(qty_raw: str, pack_map: dict) -> tuple[float, str, bool]:
	raw = cstr(qty_raw).strip()
	if not raw:
		return 0.0, "", True

	pack_note = ""
	note_m = re.search(r"\(([^)]+)\)", raw)
	if note_m:
		pack_note = note_m.group(1).strip()

	pack_letter = re.search(r"\b([ABY])\s*pack\b", raw, re.I)
	if pack_letter and not pack_note:
		pack_note = f"{pack_letter.group(1).upper()} pack"

	uncertain = False
	qty = 0.0

	xm = re.search(r"[x×]\s*(\d+(?:\.\d+)?)", raw, re.I)
	if xm:
		qty = flt(xm.group(1))
	else:
		num_m = re.search(r"(\d+(?:\.\d+)?)", raw)
		if num_m:
			qty = flt(num_m.group(1))
		else:
			uncertain = True

	unit = ""
	um = re.search(r"\b(box|boxes|pack|packs|pk)\b", raw, re.I)
	if um:
		unit = um.group(1).lower()
		if unit == "boxes":
			unit = "box"
		if unit in ("packs", "pk"):
			unit = "pack"

	if unit:
		mult = None
		for key, val in (pack_map or {}).items():
			if cstr(key).strip().lower() == unit:
				mult = flt(val)
				break
		if mult and mult > 0:
			qty = qty * mult
		else:
			uncertain = True

	if qty <= 0:
		uncertain = True
	return qty, pack_note, uncertain


def resolve_ditto_rows(raw_rows: list[dict]) -> list[dict]:
	resolved = []
	prev_name = ""
	prev_style = ""
	for i, row in enumerate(raw_rows or []):
		name_raw = cstr(row.get("name_raw") or row.get("product_name") or row.get("name") or "").strip()
		style_raw = cstr(row.get("style_raw") or row.get("style_code") or row.get("style") or "").strip()
		color_raw = cstr(row.get("color_raw") or row.get("color") or "").strip()
		size_raw = cstr(row.get("size_raw") or row.get("size") or "").strip()
		qty_raw = cstr(row.get("qty_raw") or row.get("qty") or "").strip()
		price = row.get("price")
		confidence = flt(row.get("confidence") if row.get("confidence") is not None else 0.85)

		name_is_ditto = _is_ditto(name_raw)
		style_is_ditto = _is_ditto(style_raw)

		if name_raw in ('" "', "'' ''") or (name_is_ditto and style_is_ditto):
			name = prev_name
			style = prev_style
		elif name_is_ditto and not style_is_ditto and style_raw:
			name = prev_name
			style = style_raw
		else:
			name = prev_name if name_is_ditto else name_raw
			style = prev_style if style_is_ditto else style_raw

		if name:
			prev_name = name
		if style:
			prev_style = style

		resolved.append(
			{
				"row_id": cstr(row.get("row_id") or f"r{i+1}-{uuid.uuid4().hex[:8]}"),
				"name_raw": name_raw,
				"style_raw": style_raw,
				"product_name": name,
				"style_code": style,
				"color_raw": color_raw,
				"color": _normalize_color(color_raw),
				"size_raw": size_raw,
				"size": cstr(size_raw).strip(),
				"qty_raw": qty_raw,
				"price": flt(price) if price not in (None, "") else None,
				"confidence": confidence,
				"status": cstr(row.get("status") or "pending"),
				"linked_template": cstr(row.get("linked_template") or ""),
				"linked_item": cstr(row.get("linked_item") or ""),
				"linked_item_name": cstr(row.get("linked_item_name") or ""),
				"linked_style_code": cstr(row.get("linked_style_code") or ""),
				"action": cstr(row.get("action") or ""),
				"match_candidates": row.get("match_candidates") or [],
				"error": cstr(row.get("error") or ""),
				"commit_result": row.get("commit_result"),
				"item_group": cstr(
					row.get("item_group") or row.get("suggested_category") or ""
				),
				"barcode": cstr(row.get("barcode") or ""),
				"category_candidates": row.get("category_candidates") or [],
				"name_spelling_suggestions": row.get("name_spelling_suggestions") or [],
				"style_spelling_suggestions": row.get("style_spelling_suggestions") or [],
				"_category_suggested": cint(row.get("_category_suggested")),
				"_spelling_locked": cint(row.get("_spelling_locked")),
				"_link_confirmed": cint(row.get("_link_confirmed")),
				"_force_create": cint(row.get("_force_create")),
				"_qty_edited": cint(row.get("_qty_edited")),
				"qty": row.get("qty"),
			}
		)
	return resolved


def apply_qty_and_flags(rows: list[dict], pack_map: dict) -> list[dict]:
	for row in rows:
		if cint(row.get("_qty_edited")) and row.get("qty") not in (None, ""):
			qty = flt(row.get("qty"))
			pack_note = cstr(row.get("pack_note") or "")
			uncertain = False
		else:
			qty, pack_note, uncertain = _parse_qty(row.get("qty_raw") or "", pack_map)
		row["qty"] = qty
		row["pack_note"] = pack_note
		row["qty_uncertain"] = 1 if uncertain else 0
		flags = []
		if uncertain:
			flags.append("qty_uncertain")
		if not row.get("product_name"):
			flags.append("missing_name")
		if not row.get("style_code"):
			flags.append("missing_style")
		if flt(row.get("confidence")) < 0.7:
			flags.append("low_confidence")
		row["flags"] = flags
	return rows


def _similarity(a: str, b: str) -> float:
	na, nb = _norm_text(a), _norm_text(b)
	if not na or not nb:
		return 0.0
	if na == nb:
		return 1.0
	return SequenceMatcher(None, na, nb).ratio()


def _style_fingerprint(value: str) -> str:
	"""
	Collapse common style typing mistakes to one key:
	B 12345 / B-12345 / B_12345 / B.12345 / b12345 → B12345
	Also maps letter-O next to digits toward 0 (B-1O234 → B10234) lightly via O→0 only inside digit runs.
	"""
	raw = cstr(value).strip().upper()
	if not raw:
		return ""
	# Keep letters+digits only
	alnum = re.sub(r"[^A-Z0-9]", "", raw)
	# Common OCR/typing: O vs 0 when mixed with digits
	if re.search(r"\d", alnum):
		alnum = re.sub(r"O", "0", alnum)
	return alnum


def _styles_equivalent(a: str, b: str) -> bool:
	fa, fb = _style_fingerprint(a), _style_fingerprint(b)
	if fa and fa == fb:
		return True
	na, nb = _normalize_item_code(a or ""), _normalize_item_code(b or "")
	return bool(na and na == nb)


def _style_digit_core(value: str) -> str:
	"""Digits that identify a style (FJ-16208 → 16208). Used to block 08↔09 'spelling' swaps."""
	return re.sub(r"[^0-9]", "", _style_fingerprint(value) or "")


def _style_digit_cores_differ(a: str, b: str) -> bool:
	da, db = _style_digit_core(a), _style_digit_core(b)
	return bool(da and db and da != db)


def _find_style_equivalents(style: str, templates: list[dict], limit: int = 8) -> list[dict]:
	"""Catalog templates whose style is the same ignoring spaces/hyphens/punctuation."""
	fp = _style_fingerprint(style)
	norm = _normalize_item_code(style) if style else ""
	if not fp and not norm:
		return []
	out = []
	seen = set()
	for t in templates:
		t_code = cstr(t.item_code or t.name)
		if t.name in seen:
			continue
		t_fp = _style_fingerprint(t_code)
		t_norm = _normalize_item_code(t_code)
		reason = ""
		score = 0.0
		if fp and t_fp and fp == t_fp:
			if cstr(style).strip().upper() == t_code.strip().upper():
				reason, score = "style_identical", 1.0
			elif norm and t_norm and norm == t_norm:
				reason, score = "style_normalized", 0.99
			else:
				# B 12345 vs B-12345 vs B12345
				reason, score = "style_format_variant", 0.97
		elif norm and t_norm and norm == t_norm:
			reason, score = "style_normalized", 0.99
		else:
			continue
		seen.add(t.name)
		out.append(
			{
				"item_code": t.name,
				"item_name": t.item_name,
				"style_code": t_code,
				"item_group": t.item_group,
				"score": score,
				"reason": reason,
			}
		)
		if len(out) >= limit:
			break
	out.sort(key=lambda x: x["score"], reverse=True)
	return out


def _match_case(sample: str, corrected: str) -> str:
	"""Apply a corrected spelling while roughly keeping the user's casing."""
	if not sample:
		return corrected
	if sample.isupper():
		return corrected.upper()
	if sample[:1].isupper() and sample[1:].islower():
		return corrected[:1].upper() + corrected[1:]
	if sample.islower():
		return corrected.lower()
	# Title-ish / mixed — title-case multi-word corrections
	if " " in corrected or "-" in corrected:
		return " ".join(p.capitalize() for p in corrected.replace("-", " - ").split()).replace(" - ", "-")
	return corrected[:1].upper() + corrected[1:] if sample[:1].isupper() else corrected


def _best_lexicon_word(token: str) -> tuple[str | None, float]:
	"""Return (preferred_spelling, score) for a single token, or (None, 0)."""
	raw = cstr(token).strip()
	if not raw:
		return None, 0.0
	lower = raw.lower()
	# Strip trailing punctuation for lookup, keep it out of correction
	core = re.sub(r"^[^\w]+|[^\w]+$", "", lower)
	if not core or len(core) < 3:
		return None, 0.0
	if core in SPELLING_ALIASES:
		return SPELLING_ALIASES[core], 1.0
	if core in SPELLING_LEXICON:
		return None, 1.0  # already correct
	best = None
	best_score = 0.0
	for word in SPELLING_LEXICON:
		# Skip multi-word lexicon entries at token level (handled separately)
		if " " in word:
			continue
		# Prefer similar length to avoid random short matches
		if abs(len(word) - len(core)) > max(2, len(core) // 2):
			continue
		sc = SequenceMatcher(None, core, word).ratio()
		if sc > best_score:
			best_score = sc
			best = word
	# Strict enough that "snicker"→"sneaker" passes (~0.86) but random words don't
	if best and best_score >= 0.78 and best != core:
		return best, best_score
	return None, 0.0


def _lexicon_correct_phrase(text: str) -> tuple[str | None, float]:
	"""
	Suggest a dictionary-corrected phrase (not limited to existing catalog names).
	Returns (corrected_text, confidence) or (None, 0) if nothing to fix.
	"""
	original = cstr(text).strip()
	if not original:
		return None, 0.0

	lower_full = _norm_text(original)
	# Multi-word alias first (e.g. "sport bag", "under armour" misspellings)
	for alias, preferred in SPELLING_ALIASES.items():
		if " " in alias and alias in lower_full:
			candidate = re.sub(re.escape(alias), preferred, lower_full, flags=re.I)
			# Re-apply original-ish casing on whole phrase
			fixed = " ".join(
				_match_case(a, b) if a.lower() != b.lower() else a
				for a, b in zip(original.split(), candidate.split())
			)
			# Fallback if token counts diverge
			if len(fixed.split()) != len(candidate.split()):
				fixed = " ".join(p.capitalize() for p in candidate.split())
			if _norm_text(fixed) != lower_full:
				return fixed, 0.95

	tokens = re.findall(r"[A-Za-z0-9]+(?:'[A-Za-z]+)?|[^\w\s]+|\s+", original)
	changed = False
	out = []
	scores = []
	i = 0
	while i < len(tokens):
		tok = tokens[i]
		if not re.match(r"[A-Za-z0-9]", tok):
			out.append(tok)
			i += 1
			continue
		# Try two-token compound: "sport" + "bag" → sportbag via alias / lexicon
		if i + 2 < len(tokens) and re.match(r"\s+", tokens[i + 1] or ""):
			nxt = tokens[i + 2] if i + 2 < len(tokens) else ""
			if re.match(r"[A-Za-z]", nxt or ""):
				combo = f"{tok.lower()} {nxt.lower()}"
				if combo in SPELLING_ALIASES:
					pref = SPELLING_ALIASES[combo]
					out.append(_match_case(f"{tok} {nxt}", pref))
					scores.append(1.0)
					changed = True
					i += 3
					continue
				joined = f"{tok.lower()}{nxt.lower()}"
				if joined in SPELLING_LEXICON or joined in SPELLING_ALIASES:
					pref = SPELLING_ALIASES.get(joined, joined)
					out.append(_match_case(f"{tok}{nxt}", pref))
					scores.append(0.92)
					changed = True
					i += 3
					continue
		fix, sc = _best_lexicon_word(tok)
		if fix:
			out.append(_match_case(tok, fix))
			scores.append(sc)
			changed = True
		else:
			out.append(tok)
		i += 1

	if not changed:
		return None, 0.0
	corrected = "".join(out).strip()
	# Collapse double spaces from compound merges
	corrected = re.sub(r"\s+", " ", corrected)
	if _norm_text(corrected) == lower_full:
		return None, 0.0
	confidence = min(scores) if scores else 0.8
	return corrected, confidence


def _merge_spelling_suggestions(
	existing: list[dict], *extra_lists: list[dict], limit: int = 4
) -> list[dict]:
	seen = set()
	out = []
	for group in (existing or [], *extra_lists):
		for s in group or []:
			val = cstr(s.get("value")).strip()
			key = _norm_text(val)
			if not val or key in seen:
				continue
			seen.add(key)
			out.append(s)
			if len(out) >= limit:
				return out
	return out


def _load_templates(limit: int = 5000) -> list[dict]:
	rows = frappe.get_all(
		"Item",
		filters={"disabled": 0, "is_stock_item": 1},
		fields=["name", "item_code", "item_name", "item_group", "has_variants", "variant_of", "standard_rate"],
		limit_page_length=limit * 2,
		order_by="modified desc",
	)
	# Templates and standalone only (not variants)
	out = [r for r in rows if not r.get("variant_of")]
	return out[:limit]


def _variant_attrs_for_row(row: dict, template: str | None = None) -> dict:
	"""Build Size/Colour attrs using the template's real attribute names (Colour vs Color)."""
	attrs = {}
	size_name, color_name = _size_color_attr_names(template)
	if row.get("size"):
		attrs[size_name] = cstr(row["size"]).strip()
	if row.get("color"):
		attrs[color_name] = cstr(row["color"]).strip()
	return attrs


def _size_color_attr_names(template: str | None = None) -> tuple[str, str]:
	"""Return (SizeAttr, ColorAttr) matching the template or site preference."""
	size_name = "Size"
	color_name = "Color"
	attr_list: list[str] = []
	if template and frappe.db.exists("Item", template):
		attr_list = frappe.get_all(
			"Item Variant Attribute",
			filters={"parent": template},
			pluck="attribute",
		)
	for a in attr_list:
		al = cstr(a).lower()
		if al == "size":
			size_name = a
		elif al in ("color", "colour"):
			color_name = a
	if color_name == "Color" and not attr_list:
		# Prefer British spelling if that Item Attribute already exists on this site
		if frappe.db.exists("Item Attribute", "Colour") and not frappe.db.exists(
			"Item Attribute", "Color"
		):
			color_name = "Colour"
		elif frappe.db.exists("Item Attribute", "Colour"):
			color_name = "Colour"
	return size_name, color_name


def _attr_aliases(name: str) -> set[str]:
	n = cstr(name).strip().lower()
	if n in ("color", "colour"):
		return {"color", "colour", "Color", "Colour"}
	if n == "size":
		return {"size", "Size"}
	return {name, cstr(name)}


def _find_variant_item(template: str, attrs: dict) -> str | None:
	has_variants = cint(frappe.db.get_value("Item", template, "has_variants"))
	if not attrs:
		if not has_variants:
			return template
		return None

	variants = frappe.get_all("Item", filters={"variant_of": template, "disabled": 0}, pluck="name")
	from kqs_retail.utils.items import get_variant_attributes

	for code in variants:
		vattrs = get_variant_attributes(code) or {}
		ok = True
		for k, v in attrs.items():
			matched = False
			for alias in _attr_aliases(k):
				if alias in vattrs and _norm_text(cstr(vattrs.get(alias))) == _norm_text(cstr(v)):
					matched = True
					break
			# Also try case-insensitive key scan
			if not matched:
				for vk, vv in vattrs.items():
					if cstr(vk).lower() in {a.lower() for a in _attr_aliases(k)} and _norm_text(
						cstr(vv)
					) == _norm_text(cstr(v)):
						matched = True
						break
			if not matched:
				ok = False
				break
		if ok:
			return code
	return None


def _set_action_for_linked(row: dict):
	template = cstr(row.get("linked_template") or "").strip()
	if not template or not frappe.db.exists("Item", template):
		row["action"] = "needs_match"
		return
	if not row.get("linked_item_name"):
		row["linked_item_name"] = frappe.db.get_value("Item", template, "item_name") or template
	if not row.get("linked_style_code"):
		row["linked_style_code"] = frappe.db.get_value("Item", template, "item_code") or template
	attrs = _variant_attrs_for_row(row, template=template)
	existing = _find_variant_item(template, attrs)
	if existing:
		row["linked_item"] = existing
		row["action"] = "receive"
	elif attrs:
		row["linked_item"] = ""
		row["action"] = "add_variant"
	else:
		has_variants = cint(frappe.db.get_value("Item", template, "has_variants"))
		if has_variants:
			row["action"] = "needs_match"
			row["error"] = _("Color or size required for variant products.")
			row["flags"] = sorted(set((row.get("flags") or []) + ["missing_variant_attrs"]))
		else:
			row["linked_item"] = template
			row["action"] = "receive"


def _candidate_from_template(t: dict, score: float, reason: str) -> dict:
	return {
		"item_code": t.name,
		"item_name": t.item_name,
		"style_code": cstr(t.item_code or t.name),
		"item_group": t.item_group,
		"score": score,
		"reason": reason,
		"has_variants": cint(t.get("has_variants")),
	}


def _link_row_to_template(row: dict, template_name: str, cand: dict | None = None):
	"""Confirm link to an existing catalog template; action becomes receive or add_variant."""
	row["linked_template"] = template_name
	row["_link_confirmed"] = 1
	row["_force_create"] = 0
	row["error"] = ""
	if cand:
		row["linked_item_name"] = cand.get("item_name") or template_name
		row["linked_style_code"] = cand.get("style_code") or template_name
		row["match_candidates"] = [cand]
	else:
		row["linked_item_name"] = frappe.db.get_value("Item", template_name, "item_name") or template_name
		row["linked_style_code"] = (
			frappe.db.get_value("Item", template_name, "item_code") or template_name
		)
	_set_action_for_linked(row)
	# Clarify why we linked when it's a new color/size under an existing style
	if row.get("action") == "add_variant":
		flags = set(row.get("flags") or [])
		flags.discard("needs_match_choice")
		flags.discard("needs_match")
		flags.add("style_exists_new_variant")
		row["flags"] = sorted(flags)
	elif row.get("action") == "receive":
		flags = set(row.get("flags") or [])
		flags.discard("needs_match_choice")
		flags.discard("needs_match")
		row["flags"] = sorted(flags)


def match_rows_to_catalog(rows: list[dict]) -> list[dict]:
	"""
	Match draft rows to catalog.

	Rules:
	- Style number is the product identity. If the style already exists as a template,
	  link to that template → receive (same color/size) or add_variant (new color/size).
	- Auto-link when there is a single clear style fingerprint match (name may differ —
	  paper OCR names are often wrong; the style code is trusted).
	- Multiple style format twins (B 12345 vs B-12345 as different Items) → needs_match
	  with ONLY those templates — never fuzzy junk.
	- Fuzzy / prefix suggestions only when no style-equivalent template exists.
	- Never silent-create when a style-equivalent already exists unless _force_create.
	"""
	templates = _load_templates()
	by_code = {}
	for t in templates:
		code = _normalize_item_code(t.item_code or t.name)
		by_code[code] = t

	for row in rows:
		if row.get("status") == "applied":
			continue
		if cint(row.get("_link_confirmed")) and row.get("linked_template"):
			_set_action_for_linked(row)
			continue
		if row.get("action") == "skip":
			continue
		if cint(row.get("_force_create")):
			# Staff explicitly chose Create as new despite possible twins
			row["action"] = "create"
			row["match_candidates"] = []
			row["linked_template"] = ""
			row["linked_item"] = ""
			keep_flags = [
				f
				for f in (row.get("flags") or [])
				if f
				not in (
					"needs_match_choice",
					"needs_match",
					"missing_variant_attrs",
				)
			]
			row["flags"] = sorted(set(keep_flags + ["force_create"]))
			continue

		style = cstr(row.get("style_code") or "").strip()
		name = cstr(row.get("product_name") or "").strip()
		style_norm = _normalize_item_code(style) if style else ""
		candidates: list[dict] = []

		# 1) Exact / format style twins (B 12345 ↔ B-12345) — these are real templates
		style_hits = _find_style_equivalents(style, templates)
		for eq in style_hits:
			candidates.append(eq)

		# Prefer same-name among style hits when the paper name matches catalog
		name_hits = [
			c
			for c in style_hits
			if name and _norm_text(c.get("item_name")) == _norm_text(name)
		]
		for c in name_hits:
			c["score"] = max(flt(c.get("score")), 0.98)
			c["reason"] = "style_format_same_name"

		# Unique strong style hit → auto-link (new color/size becomes add_variant)
		strong = [c for c in style_hits if flt(c.get("score")) >= 0.97]
		auto_cand = None
		if name_hits and len(name_hits) == 1:
			auto_cand = name_hits[0]
		elif len(strong) == 1:
			auto_cand = strong[0]
		elif len(style_hits) == 1 and flt(style_hits[0].get("score")) >= 0.97:
			auto_cand = style_hits[0]
		# Exact item_code key in by_code (normalized) also counts as unique template
		exact = by_code.get(style_norm) if style_norm else None
		if exact and not auto_cand:
			auto_cand = _candidate_from_template(
				exact,
				1.0 if name and _norm_text(exact.item_name) == _norm_text(name) else 0.99,
				"exact_name_and_style"
				if name and _norm_text(exact.item_name) == _norm_text(name)
				else "style_identical",
			)
			# Ensure it appears in candidates for the Match UI history
			if exact.name not in {c["item_code"] for c in candidates}:
				candidates.insert(0, auto_cand)

		if auto_cand:
			_link_row_to_template(row, auto_cand["item_code"], auto_cand)
			continue

		# Multiple style twins → staff must pick; do NOT mix in fuzzy noise
		if style_hits:
			candidates.sort(key=lambda x: x["score"], reverse=True)
			row["match_candidates"] = candidates[:6]
			row["linked_template"] = ""
			row["_link_confirmed"] = 0
			row["action"] = "needs_match"
			flags = set(row.get("flags") or [])
			flags.add("needs_match_choice")
			flags.add("style_format_twin")
			row["flags"] = sorted(flags)
			continue

		# 2) No style hit — truncated OCR / fuzzy recovery only
		if style and len(_style_fingerprint(style)) >= 5:
			fp = _style_fingerprint(style)
			digit_core = _style_digit_core(style)
			seen = {c["item_code"] for c in candidates}
			for t in templates:
				if t.name in seen:
					continue
				t_code = cstr(t.item_code or t.name)
				t_fp = _style_fingerprint(t_code)
				if not t_fp or len(t_fp) < 5:
					continue
				# Require shared digit core when both have digits (blocks CRJ → random)
				t_digits = _style_digit_core(t_code)
				if digit_core and t_digits and digit_core != t_digits:
					# Allow prefix only if one digit core contains the other (truncated OCR)
					if not (t_digits.startswith(digit_core) or digit_core.startswith(t_digits)):
						continue
				if not (fp == t_fp or t_fp.startswith(fp) or fp.startswith(t_fp)):
					continue
				if abs(len(fp) - len(t_fp)) > max(4, len(fp) // 2) and not (
					t_fp.startswith(fp) or fp.startswith(t_fp)
				):
					continue
				seen.add(t.name)
				candidates.append(
					{
						"item_code": t.name,
						"item_name": t.item_name,
						"style_code": t_code,
						"item_group": t.item_group,
						"score": 0.9 if fp == t_fp else 0.86,
						"reason": "style_format_variant" if fp == t_fp else "style_prefix",
						"has_variants": cint(t.get("has_variants")),
					}
				)

		# Fuzzy name/style — last resort when style number is missing or unknown
		scored = []
		for t in templates:
			t_code = t.item_code or t.name
			style_score = max(
				_similarity(style, t_code) if style else 0.0,
				_similarity(_style_fingerprint(style), _style_fingerprint(t_code)) if style else 0.0,
			)
			name_score = _similarity(name, t.item_name) if name else 0.0
			score = max(style_score, name_score)
			if style_score >= 0.82 and name_score >= 0.82:
				score = 0.5 * style_score + 0.5 * name_score + 0.05
			# Raise bar for fuzzy-only when a style was typed (avoid junk suggestions)
			min_score = 0.88 if style else 0.78
			if score < min_score:
				continue
			# If draft has a style, require decent style overlap — don't suggest by name alone
			if style and style_score < 0.82:
				continue
			reason = "fuzzy"
			if style_score >= 0.9 and name_score < 0.9:
				reason = "style_near_name_fuzzy"
			elif name_score >= 0.9 and style_score < 0.9:
				reason = "name_exact_style_fuzzy"
			elif style_score >= 0.9 and name_score >= 0.9:
				reason = "name_and_style_fuzzy"
			scored.append(
				{
					"item_code": t.name,
					"item_name": t.item_name,
					"style_code": t_code,
					"item_group": t.item_group,
					"score": round(score, 3),
					"reason": reason,
					"has_variants": cint(t.get("has_variants")),
				}
			)

		scored.sort(key=lambda x: x["score"], reverse=True)
		seen = {c["item_code"] for c in candidates}
		for c in scored:
			if c["item_code"] in seen:
				continue
			candidates.append(c)
			seen.add(c["item_code"])
			if len(candidates) >= 6:
				break

		candidates.sort(key=lambda x: x["score"], reverse=True)
		row["match_candidates"] = candidates[:6]
		row["linked_template"] = ""
		row["_link_confirmed"] = 0

		if candidates:
			row["action"] = "needs_match"
			flags = set(row.get("flags") or [])
			flags.add("needs_match_choice")
			if any(
				c.get("reason")
				in ("style_format_variant", "style_format_same_name", "style_normalized", "style_prefix")
				for c in candidates
			):
				flags.add("style_format_twin")
			row["flags"] = sorted(flags)
		else:
			row["action"] = "create"
	return rows


def suggest_categories_and_spellings(rows: list[dict]) -> list[dict]:
	"""Suggest Item Groups + spelling fixes from live catalog — never silent overwrite of locked spelling."""
	leaf_groups = frappe.get_all(
		"Item Group",
		filters={"is_group": 0},
		fields=["name", "parent_item_group"],
		limit_page_length=500,
	)
	templates = _load_templates(3000)
	# Distinct catalog names / styles for spelling
	name_index = []
	seen_names = set()
	for t in templates:
		n = cstr(t.item_name).strip()
		if n and n.lower() not in seen_names:
			seen_names.add(n.lower())
			name_index.append(n)
	style_index = []
	seen_styles = set()
	for t in templates:
		s = cstr(t.item_code or t.name).strip()
		if s and s.upper() not in seen_styles:
			seen_styles.add(s.upper())
			style_index.append(s)

	for row in rows:
		if row.get("status") == "applied":
			continue

		# --- Category suggestions ---
		cat_scores = []
		probe = f"{row.get('product_name') or ''} {row.get('style_code') or ''}".strip()
		for g in leaf_groups:
			score = max(
				_similarity(probe, g.name),
				_similarity(cstr(row.get("product_name")), g.name),
				_similarity(cstr(row.get("product_name")), cstr(g.parent_item_group)),
				_similarity(cstr(row.get("style_code")), g.name),
			)
			# Boost if similar catalog items use this group
			for t in templates[:200]:
				if cstr(t.item_group) != g.name:
					continue
				s2 = max(
					_similarity(cstr(row.get("product_name")), cstr(t.item_name)),
					_similarity(cstr(row.get("style_code")), cstr(t.item_code or t.name)),
				)
				if s2 >= 0.82:
					score = max(score, 0.55 + 0.4 * s2)
			if score >= 0.45:
				cat_scores.append({"name": g.name, "score": round(score, 3), "reason": "catalog_match"})
		cat_scores.sort(key=lambda x: x["score"], reverse=True)
		# Keep unique top 5
		seen_c = set()
		cats = []
		for c in cat_scores:
			if c["name"] in seen_c:
				continue
			seen_c.add(c["name"])
			cats.append(c)
			if len(cats) >= 5:
				break
		row["category_candidates"] = cats

		# Auto-fill empty category from best suggestion (editable afterward)
		if not cstr(row.get("item_group")).strip() and cats and cats[0]["score"] >= 0.55:
			row["item_group"] = cats[0]["name"]
			row["_category_suggested"] = 1
			flags = set(row.get("flags") or [])
			flags.add("category_suggested")
			row["flags"] = sorted(flags)

		# --- Spelling suggestions (never auto-apply) ---
		# Prefer dictionary / brand knowledge over reinforcing bad catalog spellings.
		if cint(row.get("_spelling_locked")):
			row["name_spelling_suggestions"] = []
			row["style_spelling_suggestions"] = []
			continue

		name = cstr(row.get("product_name")).strip()
		style = cstr(row.get("style_code")).strip()

		name_sugs: list[dict] = []
		if name:
			lex_fix, lex_sc = _lexicon_correct_phrase(name)
			if lex_fix:
				name_sugs.append(
					{"value": lex_fix, "score": round(lex_sc, 3), "reason": "dictionary"}
				)
			for cand in name_index:
				sc = _similarity(name, cand)
				if 0.78 <= sc < 1.0:
					# If catalog itself is misspelled, offer the lexicon-fixed form instead
					fixed_cand, _ = _lexicon_correct_phrase(cand)
					show = fixed_cand or cand
					if _norm_text(show) == _norm_text(name):
						continue
					name_sugs.append(
						{
							"value": show,
							"score": round(sc, 3),
							"reason": "catalog_name_fixed" if fixed_cand else "catalog_name",
						}
					)
			name_sugs.sort(key=lambda x: (0 if x.get("reason") == "dictionary" else 1, -x["score"]))
			row["name_spelling_suggestions"] = _merge_spelling_suggestions([], name_sugs, limit=4)
			if row["name_spelling_suggestions"]:
				flags = set(row.get("flags") or [])
				flags.add("spelling_suggestion")
				row["flags"] = sorted(flags)
		else:
			row["name_spelling_suggestions"] = []

		style_sugs: list[dict] = []
		if style:
			lex_fix, lex_sc = _lexicon_correct_phrase(style)
			if lex_fix and not _style_digit_cores_differ(style, lex_fix):
				style_sugs.append(
					{"value": lex_fix, "score": round(lex_sc, 3), "reason": "dictionary"}
				)
			# Catalog style suggestions: format twins only (FJ 16208 → FJ-16208).
			# Never suggest a different SKU that only differs by a digit (08 ↔ 09).
			for cand in style_index:
				show = cand
				if _norm_text(show) == _norm_text(style):
					continue
				if _normalize_item_code(show) == _normalize_item_code(style) and show.strip() == style.strip():
					continue
				if _styles_equivalent(style, cand):
					# Same product code, different punctuation/spacing
					if _normalize_item_code(style) != _normalize_item_code(cand) or style.strip().upper() != cand.strip().upper():
						style_sugs.append(
							{
								"value": show,
								"score": 0.99,
								"reason": "catalog_style_format",
							}
						)
					continue
				# Block near-neighbor SKUs (FJ-16208 vs FJ-16209)
				if _style_digit_cores_differ(style, cand):
					continue
				sc = _similarity(style, cand)
				sc2 = _similarity(_normalize_item_code(style), _normalize_item_code(cand))
				sc = max(sc, sc2)
				# Letter-only typos on the same digit core — rare; keep a high bar
				if sc >= 0.92:
					style_sugs.append(
						{"value": show, "score": round(sc, 3), "reason": "catalog_style"}
					)
			style_sugs.sort(
				key=lambda x: (
					0 if x.get("reason") == "dictionary" else 1 if "format" in cstr(x.get("reason")) else 2,
					-x["score"],
				)
			)
			row["style_spelling_suggestions"] = _sanitize_style_spelling_suggestions(
				style, _merge_spelling_suggestions([], style_sugs, limit=3)
			)
			if row["style_spelling_suggestions"]:
				flags = set(row.get("flags") or [])
				flags.add("spelling_suggestion")
				row["flags"] = sorted(flags)
		else:
			row["style_spelling_suggestions"] = []

	return rows


def _sanitize_style_spelling_suggestions(style: str, suggestions: list[dict] | None) -> list[dict]:
	"""Drop circular near-neighbor SKU suggestions (FJ-16208 ↔ FJ-16209) even if stored on old drafts."""
	style = cstr(style).strip()
	out = []
	seen = set()
	for s in suggestions or []:
		val = cstr(s.get("value") if isinstance(s, dict) else s).strip()
		if not val or not style:
			continue
		if _norm_text(val) == _norm_text(style):
			continue
		# Different digit cores = different styles, not a spelling fix
		if _style_digit_cores_differ(style, val):
			continue
		# Keep format twins (spaces/hyphens) or true letter typos on same digits
		if not _styles_equivalent(style, val):
			sc = max(
				_similarity(style, val),
				_similarity(_normalize_item_code(style), _normalize_item_code(val)),
			)
			if sc < 0.92:
				continue
		key = _norm_text(val)
		if key in seen:
			continue
		seen.add(key)
		out.append(s if isinstance(s, dict) else {"value": val, "score": 0.99, "reason": "catalog_style_format"})
	return out[:3]


SPELLING_REVIEW_SYSTEM = (
	"You review retail product name spellings for a clothing/footwear/bag store. "
	"Return ONLY valid JSON. Never invent stock rows."
)

SPELLING_REVIEW_PROMPT = """Review these import draft lines for spelling that would look embarrassing on a website.

Rules (strict):
1. NEVER auto-change names yourself in the ERP — only suggest. Staff will Accept or Keep.
2. Brand / label names: leave alone when they look intentional, even if unusual, non-English, or uncommon
   (examples of the kind of names we stock: Love Rose, Skaloni, Soviet, and many other small brands).
   Do NOT "fix" brands into English or famous brands.
3. Descriptive English words that are clearly misspelled: DO suggest a fix
   (e.g. "black penthy" → "Black Panty", "Nike snicker" → "Nike Sneaker", "sport bagg" → "Sport Bag").
4. If unsure whether something is a brand vs a typo, return no suggestion for that field.
5. Style / SKU codes: only suggest if an obvious letter typo; leave weird codes alone.
6. Suggest at most 2 alternatives per field. Prefer the most natural retail spelling.

Known product names already in this store (do not "correct" these into something else unless the draft is a clear typo of English words):
{known_names}

Draft rows:
{rows_json}

Return ONLY JSON:
{{
  "suggestions": [
    {{
      "row_id": "...",
      "product_name": [{{"value": "Black Panty", "reason": "descriptive_typo"}}],
      "style_code": []
    }}
  ]
}}

Omit a row entirely when both fields look fine. Empty arrays mean no suggestion for that field.
"""


def _known_names_for_spelling_prompt(limit: int = 100) -> str:
	"""Sample of live product names so AI does not 'correct' store brands like Love Rose / Skaloni."""
	seen = set()
	out = []
	for t in _load_templates(limit * 2):
		n = cstr(t.item_name).strip()
		if not n or n.lower() in seen:
			continue
		seen.add(n.lower())
		out.append(n)
		if len(out) >= limit:
			break
	if not out:
		return "(none yet)"
	return "\n".join(f"- {n}" for n in out)


def ai_suggest_spellings(rows: list[dict]) -> list[dict]:
	"""
	AI spelling review — suggestions only, never overwrites product_name/style_code.
	Skips when AI is not configured or all rows are locked/applied.
	"""
	cfg = get_ai_config()
	if not cfg.get("configured"):
		return rows

	payload_rows = []
	for row in rows:
		if row.get("status") == "applied" or cint(row.get("_spelling_locked")):
			continue
		name = cstr(row.get("product_name")).strip()
		style = cstr(row.get("style_code")).strip()
		if not name and not style:
			continue
		payload_rows.append(
			{
				"row_id": row.get("row_id"),
				"product_name": name,
				"style_code": style,
			}
		)

	if not payload_rows:
		return rows

	# Batch to keep prompts small
	by_id = {r.get("row_id"): r for r in rows}
	batch_size = 40
	for start in range(0, len(payload_rows), batch_size):
		chunk = payload_rows[start : start + batch_size]
		try:
			raw = complete_chat(
				SPELLING_REVIEW_PROMPT.format(
					known_names=_known_names_for_spelling_prompt(),
					rows_json=json.dumps(chunk, ensure_ascii=False, indent=2),
				),
				system=SPELLING_REVIEW_SYSTEM,
				temperature=0.1,
				timeout=90,
			)
			parsed = parse_json_from_ai_text(raw)
		except Exception:
			# Spelling AI is best-effort — never fail the whole import
			frappe.log_error(frappe.get_traceback(), "KQS bulk import AI spelling")
			break

		suggestions = []
		if isinstance(parsed, dict):
			suggestions = parsed.get("suggestions") or []
		elif isinstance(parsed, list):
			suggestions = parsed

		for item in suggestions:
			if not isinstance(item, dict):
				continue
			row = by_id.get(item.get("row_id"))
			if not row or cint(row.get("_spelling_locked")):
				continue
			name_alts = item.get("product_name") or item.get("name_suggestions") or []
			style_alts = item.get("style_code") or item.get("style_suggestions") or []
			ai_name = []
			for alt in name_alts:
				if isinstance(alt, str):
					val = alt.strip()
					reason = "ai"
				elif isinstance(alt, dict):
					val = cstr(alt.get("value")).strip()
					reason = cstr(alt.get("reason") or "ai")
				else:
					continue
				if not val or _norm_text(val) == _norm_text(row.get("product_name")):
					continue
				ai_name.append({"value": val, "score": 0.97, "reason": reason or "ai"})
			ai_style = []
			draft_style = cstr(row.get("style_code") or "")
			for alt in style_alts:
				if isinstance(alt, str):
					val = alt.strip()
					reason = "ai"
				elif isinstance(alt, dict):
					val = cstr(alt.get("value")).strip()
					reason = cstr(alt.get("reason") or "ai")
				else:
					continue
				if not val or _norm_text(val) == _norm_text(draft_style):
					continue
				# Never let AI swap one real style number for another (08 ↔ 09)
				if _style_digit_cores_differ(draft_style, val):
					continue
				ai_style.append({"value": val, "score": 0.97, "reason": reason or "ai"})

			if ai_name:
				row["name_spelling_suggestions"] = _merge_spelling_suggestions(
					ai_name, row.get("name_spelling_suggestions") or [], limit=4
				)
				flags = set(row.get("flags") or [])
				flags.add("spelling_suggestion")
				row["flags"] = sorted(flags)
			if ai_style:
				row["style_spelling_suggestions"] = _merge_spelling_suggestions(
					ai_style, row.get("style_spelling_suggestions") or [], limit=4
				)
				flags = set(row.get("flags") or [])
				flags.add("spelling_suggestion")
				row["flags"] = sorted(flags)

	return rows


def enrich_rows(
	raw_rows: list[dict],
	pack_map: dict | None = None,
	*,
	use_ai_spelling: bool = True,
) -> list[dict]:
	pack_map = pack_map or {}
	rows = resolve_ditto_rows(raw_rows)
	rows = expand_multi_size_qty_rows(rows)
	rows = apply_qty_and_flags(rows, pack_map)
	rows = match_rows_to_catalog(rows)
	rows = suggest_categories_and_spellings(rows)
	if use_ai_spelling:
		rows = ai_suggest_spellings(rows)
	for row in rows:
		flags = set(row.get("flags") or [])
		if row.get("action") == "create" and row.get("price") in (None, ""):
			flags.add("missing_price")
		elif row.get("action") in ("receive", "add_variant"):
			flags.discard("missing_price")
		row["flags"] = sorted(flags)
	return rows


def _default_warehouse(company: str = "") -> str:
	"""Hint only — never silent-apply on create/import; staff must choose a branch."""
	company = company or get_default_company()
	central = get_kqs_central_warehouse(company)
	if central and frappe.db.exists("Warehouse", central):
		return central
	return ""


def _require_warehouse(warehouse: str = "", company: str = "") -> str:
	company = company or get_default_company()
	warehouse = cstr(warehouse or "").strip()
	if not warehouse:
		frappe.throw(
			_("Select which warehouse / branch receives this stock — do not leave it blank.")
		)
	if not is_kqs_store_warehouse(warehouse, company):
		frappe.throw(_("Select a valid KQS warehouse."))
	return warehouse


def _parse_csv_content(content: str) -> list[dict]:
	content = content.lstrip("\ufeff")
	sample = content[:4096]
	try:
		dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
	except csv.Error:
		dialect = csv.excel
	reader = csv.DictReader(io.StringIO(content), dialect=dialect)
	if not reader.fieldnames:
		frappe.throw(_("CSV has no header row."))

	def pick(row_dict, *keys):
		lower_map = {cstr(k).strip().lower(): v for k, v in row_dict.items() if k is not None}
		for key in keys:
			if key in lower_map and cstr(lower_map[key]).strip() != "":
				return cstr(lower_map[key]).strip()
		return ""

	rows = []
	for row in reader:
		name = pick(row, "name", "product_name", "product", "item_name", "group")
		style = pick(row, "style", "style_code", "style_number", "sku", "code")
		color = pick(row, "color", "colour", "color_raw")
		size = pick(row, "size", "size_raw")
		qty = pick(row, "qty", "qty_raw", "quantity")
		price = pick(row, "price", "rate", "standard_rate")
		category = pick(row, "category", "item_group")
		barcode = pick(row, "barcode")
		if not any([name, style, color, qty]):
			continue
		rows.append(
			{
				"name_raw": name,
				"style_raw": style,
				"color_raw": color,
				"size_raw": size,
				"qty_raw": qty,
				"price": flt(price) if price else None,
				"item_group": category,
				"barcode": barcode,
				"confidence": 1.0,
			}
		)
	if not rows:
		frappe.throw(_("No data rows found in CSV."))
	return rows


def _row_blocking_errors(row: dict, all_rows: list[dict] | None = None) -> list[str]:
	"""Hard gates before a row may be published."""
	errs = []
	action = cstr(row.get("action") or "").strip()
	if row.get("status") == "applied":
		return []
	if action == "skip":
		return []
	if action == "needs_match" or not action:
		errs.append(
			_("Possible existing product — Accept a match, Search catalog, or Create as new (required)")
		)
		return errs

	name = cstr(row.get("product_name") or "").strip()
	style = cstr(row.get("style_code") or "").strip()
	if not name:
		errs.append(_("Name is required"))
	if not style:
		errs.append(_("Style number is required"))

	if action == "create":
		price = row.get("price")
		if price in (None, "") or flt(price) <= 0:
			errs.append(_("Price is required to create (must be greater than zero)"))
		group = cstr(row.get("item_group") or "").strip()
		if not group:
			errs.append(_("Category is required to create"))
		elif not frappe.db.exists("Item Group", group):
			errs.append(_("Category {0} was not found — pick an existing Item Group").format(group))
		elif cint(frappe.db.get_value("Item Group", group, "is_group")):
			errs.append(_("Category {0} is a folder — pick a leaf category").format(group))
		if flt(row.get("qty")) <= 0:
			errs.append(_("Qty must be greater than zero"))
		# Same style with multiple create rows → each must be a distinct color/size
		if style and all_rows is not None:
			style_key = _normalize_item_code(style)
			siblings = [
				r
				for r in all_rows
				if r.get("status") != "applied"
				and cstr(r.get("action")) == "create"
				and _normalize_item_code(r.get("style_code") or "") == style_key
			]
			if len(siblings) > 1:
				attrs_ok = bool(cstr(row.get("color") or "").strip() or cstr(row.get("size") or "").strip())
				if not attrs_ok:
					errs.append(
						_("Color or size is required — this style has multiple rows (fill each variant)")
					)
		# Hard gate: style twins (B 12345 vs B-12345) cannot create unless staff clicked Create as new
		if not cint(row.get("_force_create")) and style:
			twins = _find_style_equivalents(style, _load_templates(3000), limit=3)
			if twins:
				sample = twins[0]
				errs.append(
					_(
						"Style looks like existing {0} ({1}) — Accept that match or click Create as new"
					).format(sample.get("item_name"), sample.get("style_code"))
				)
	elif action == "add_variant":
		if not cstr(row.get("linked_template") or "").strip():
			errs.append(_("Link to an existing product before adding a variant"))
		attrs_ok = bool(cstr(row.get("color") or "").strip() or cstr(row.get("size") or "").strip())
		if not attrs_ok:
			errs.append(_("Color or size is required to add a variant"))
		if flt(row.get("qty")) <= 0:
			errs.append(_("Qty must be greater than zero"))
	elif action == "receive":
		if not cstr(row.get("linked_item") or row.get("linked_template") or "").strip():
			errs.append(_("Link to an existing SKU before adding stock"))
		if flt(row.get("qty")) <= 0:
			errs.append(_("Qty must be greater than zero to add stock"))
	else:
		errs.append(_("Unknown action {0}").format(action))

	if "missing_variant_attrs" in (row.get("flags") or []):
		errs.append(_("Color or size required"))
	return errs


def _count_publishable(rows: list[dict], default_group: str = "") -> tuple[int, int, list[dict]]:
	"""Return (publishable, blocked, sample_blockers)."""
	publishable = 0
	blocked = 0
	samples = []
	for row in rows:
		if row.get("status") == "applied" or row.get("action") == "skip":
			continue
		probe = dict(row)
		if default_group and not cstr(probe.get("item_group") or "").strip():
			probe["item_group"] = default_group
		blockers = _row_blocking_errors(probe, all_rows=rows)
		if blockers:
			blocked += 1
			if len(samples) < 8:
				samples.append(
					{
						"row_id": probe.get("row_id"),
						"name": probe.get("product_name"),
						"style": probe.get("style_code"),
						"errors": blockers,
					}
				)
		else:
			publishable += 1
	return publishable, blocked, samples


def _is_lock_conflict(exc: BaseException) -> bool:
	msg = cstr(exc).lower()
	return any(
		token in msg
		for token in (
			"deadlock",
			"1213",
			"lock wait timeout",
			"1205",
			"try restarting transaction",
		)
	)


def _save_batch_rows(doc, rows: list[dict]):
	"""Persist draft rows with short retries — style edits can overlap autosave/rematch."""
	payload = _dumps(rows)
	name = doc.name
	warehouse = cstr(getattr(doc, "warehouse", None) or "")
	pack_map_json = getattr(doc, "pack_map_json", None)
	last_err: BaseException | None = None
	for attempt in range(5):
		try:
			d = frappe.get_doc("KQS Stock Import Batch", name)
			d.rows_json = payload
			if warehouse:
				d.warehouse = warehouse
			if pack_map_json is not None:
				d.pack_map_json = pack_map_json
			d.save(ignore_permissions=True)
			doc.rows_json = payload
			return
		except Exception as exc:
			last_err = exc
			if not _is_lock_conflict(exc) or attempt >= 4:
				raise
			try:
				frappe.db.rollback()
			except Exception:
				pass
			time.sleep(0.12 * (attempt + 1))
	if last_err:
		raise last_err


def _get_batch_for_update(batch_name: str):
	"""Load draft with a row lock when the DB supports it (avoids overlapping writers)."""
	try:
		frappe.db.sql(
			"SELECT name FROM `tabKQS Stock Import Batch` WHERE name=%s FOR UPDATE",
			batch_name,
		)
	except Exception:
		# Some storage engines / permissions may not support FOR UPDATE — fall through.
		pass
	return frappe.get_doc("KQS Stock Import Batch", batch_name)


CSV_TEMPLATE_HEADERS = [
	"name",
	"style",
	"size",
	"color",
	"qty",
	"price",
	"barcode",
	"category",
]

CSV_TEMPLATE_SAMPLE_ROWS = [
	# qty is a plain number in ERPNext. Paper habits like "x3" / "1box" are also accepted on import and parsed to integers.
	["Sportbag", "Boca L", "", "black", "3", "299", "", "Unisex — Backpacks & Bags"],
	["Sportbag", "Boca L", "", "Navy", "3", "299", "", "Unisex — Backpacks & Bags"],
	["Sidebag", "SKA", "", "Iguana", "2", "199", "", "Unisex — Backpacks & Bags"],
	["Soviet", "K Hollywood Core Vulcanised", "9", "Black Mono", "1", "899", "", "Men — Sneakers & Takkies"],
]


def _csv_template_text(include_samples: bool = True) -> str:
	buf = io.StringIO()
	writer = csv.writer(buf)
	writer.writerow(CSV_TEMPLATE_HEADERS)
	if include_samples:
		for row in CSV_TEMPLATE_SAMPLE_ROWS:
			writer.writerow(row)
	return buf.getvalue()


@frappe.whitelist()
def get_import_defaults():
	assert_stock_manager()
	company = get_default_company()
	ai = get_ai_config()
	return {
		"company": company,
		# Never auto-select Central — staff must pick the branch on the page / dialog.
		"warehouse": "",
		"central_warehouse": _default_warehouse(company),
		"warehouses": list_kqs_warehouse_choices(company),
		"ai": {
			"provider": ai.get("provider") or "",
			"model": ai.get("model") or "",
			"configured": bool(ai.get("configured")),
			"providers": ["openai", "deepseek", "qwen"],
		},
		"pack_map": {"box": 1, "pack": 1},
		"csv_columns": ",".join(CSV_TEMPLATE_HEADERS),
		"csv_template": _csv_template_text(include_samples=True),
		"csv_template_blank": _csv_template_text(include_samples=False),
		"settings_hint": _(
			"Desk → search “KQS Retail Settings” (or KQS Retail workspace) → Bulk Import AI"
		),
	}


@frappe.whitelist()
def list_import_categories():
	"""Leaf Item Groups for per-row category pickers on Bulk Import."""
	assert_stock_manager()
	rows = frappe.get_all(
		"Item Group",
		filters={"is_group": 0},
		fields=["name", "parent_item_group"],
		order_by="name",
		limit_page_length=500,
	)
	return [{"name": r.name, "parent": r.parent_item_group or ""} for r in rows]


@frappe.whitelist()
def get_csv_template(with_samples: int = 1):
	"""Return CSV template text for catalogue migration / formatting help."""
	assert_stock_manager()
	return {
		"filename": "kqs-stock-import-template.csv"
		if cint(with_samples)
		else "kqs-stock-import-blank.csv",
		"content": _csv_template_text(include_samples=bool(cint(with_samples))),
	}


@frappe.whitelist()
def list_import_batches(status: str = "", limit: int = 30):
	"""List recent import drafts / batches so managers can resume after reload."""
	assert_stock_manager()
	limit = min(cint(limit) or 30, 100)
	filters: dict = {}
	status = cstr(status).strip()
	if status:
		filters["status"] = status
	else:
		filters["status"] = ["in", ["Draft", "Reviewed", "Partial"]]

	rows = frappe.get_all(
		"KQS Stock Import Batch",
		filters=filters,
		fields=["name", "status", "source_type", "warehouse", "modified", "owner", "ai_provider"],
		order_by="modified desc",
		limit_page_length=limit,
	)
	out = []
	for r in rows:
		raw = frappe.db.get_value("KQS Stock Import Batch", r.name, "rows_json") or "[]"
		try:
			parsed = json.loads(raw)
			n = len(parsed) if isinstance(parsed, list) else 0
		except Exception:
			n = 0
		out.append(
			{
				"name": r.name,
				"status": r.status,
				"source_type": r.source_type,
				"warehouse": r.warehouse,
				"modified": r.modified,
				"owner": r.owner,
				"ai_provider": r.ai_provider,
				"row_count": n,
			}
		)
	return out


@frappe.whitelist()
def delete_import_batch(batch_name: str):
	"""Delete a draft/partial import batch so staff can start fresh."""
	assert_stock_manager()
	batch_name = cstr(batch_name).strip()
	if not batch_name or not frappe.db.exists("KQS Stock Import Batch", batch_name):
		frappe.throw(_("Draft {0} was not found.").format(batch_name or ""))
	status = frappe.db.get_value("KQS Stock Import Batch", batch_name, "status")
	if status == "Committed":
		frappe.throw(_("Cannot delete a fully committed import batch."))
	frappe.delete_doc("KQS Stock Import Batch", batch_name, ignore_permissions=True)
	return {"ok": 1, "deleted": batch_name}


@frappe.whitelist()
def create_empty_batch(warehouse: str = "", company: str = ""):
	"""Start a blank draft for manual row entry (no CSV/photo)."""
	assert_stock_manager()
	company = company or get_default_company()
	warehouse = _require_warehouse(warehouse, company)
	doc = frappe.get_doc(
		{
			"doctype": "KQS Stock Import Batch",
			"status": "Draft",
			"source_type": "Mixed",
			"warehouse": warehouse,
			"company": company,
			"pack_map_json": "{}",
			"rows_json": "[]",
		}
	)
	doc.insert(ignore_permissions=True)
	return get_batch(doc.name)


@frappe.whitelist()
def append_draft_rows(batch_name: str, rows_json: str = "[]", mode: str = "blank"):
	"""Insert manual rows into a draft (blank product at end, or variant clone under source)."""
	assert_stock_manager()
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	if doc.status == "Committed":
		frappe.throw(_("This import batch is already fully committed."))
	existing = _loads(doc.rows_json, [])
	incoming = _loads(rows_json, [])
	if not isinstance(incoming, list):
		frappe.throw(_("Invalid rows."))
	if not incoming:
		incoming = [{}]
	mode = cstr(mode).strip() or "blank"
	added: list[dict] = []
	insert_after_id = ""
	for raw in incoming:
		base = dict(raw) if isinstance(raw, dict) else {}
		force = 1
		action = "create"
		linked = ""
		link_confirmed = 0
		if mode == "variant" and base.get("from_row_id"):
			insert_after_id = cstr(base.get("from_row_id")).strip()
			src = next((r for r in existing if r.get("row_id") == insert_after_id), None)
			if src:
				linked_tpl = cstr(src.get("linked_template") or "").strip()
				if linked_tpl and not cint(src.get("_force_create")):
					force = 0
					action = "add_variant"
					linked = linked_tpl
					link_confirmed = 1
				else:
					force = 1
					action = "create"
				base = {
					"product_name": src.get("product_name"),
					"style_code": src.get("style_code"),
					"item_group": src.get("item_group"),
					"price": src.get("price"),
					"barcode": src.get("barcode") or "",
					"color": cstr(base.get("color") or ""),
					"size": cstr(base.get("size") or ""),
					"qty": flt(base.get("qty") or 1),
				}
		row = {
			"row_id": f"r-{uuid.uuid4().hex[:10]}",
			"product_name": cstr(base.get("product_name") or ""),
			"style_code": cstr(base.get("style_code") or ""),
			"color": _normalize_color(cstr(base.get("color") or base.get("color_raw") or "")),
			"color_raw": cstr(base.get("color_raw") or base.get("color") or ""),
			"size": _normalize_size_label(cstr(base.get("size") or base.get("size_raw") or "")),
			"size_raw": cstr(base.get("size_raw") or base.get("size") or ""),
			"qty": flt(base.get("qty") if base.get("qty") not in (None, "") else 1),
			"qty_raw": cstr(base.get("qty_raw") or base.get("qty") or "1"),
			"price": base.get("price"),
			"item_group": cstr(base.get("item_group") or ""),
			"barcode": cstr(base.get("barcode") or ""),
			"action": action,
			"status": "pending",
			"match_candidates": [],
			"flags": ["manual_row"] + (["force_create"] if force else []),
			"_force_create": force,
			"_qty_edited": 1,
			"_link_confirmed": link_confirmed,
			"linked_template": linked,
			"linked_item": "",
			"error": "",
			"confidence": 1,
		}
		if row["size"] and not row["size_raw"]:
			row["size_raw"] = row["size"]
		added.append(row)

	to_match = [r for r in added if not cint(r.get("_force_create")) and not r.get("linked_template")]
	if to_match:
		matched = match_rows_to_catalog(to_match)
		by_id = {r.get("row_id"): r for r in matched}
		for i, r in enumerate(added):
			if r.get("row_id") in by_id:
				m = by_id[r["row_id"]]
				m["flags"] = sorted(set((m.get("flags") or []) + ["manual_row"]))
				m["_qty_edited"] = 1
				added[i] = m

	# Variant clones sit directly under the source row; blank products go at the end.
	if mode == "variant" and insert_after_id:
		idx = next((i for i, r in enumerate(existing) if r.get("row_id") == insert_after_id), -1)
		if idx >= 0:
			existing[idx + 1 : idx + 1] = added
		else:
			existing.extend(added)
	else:
		existing.extend(added)

	_save_batch_rows(doc, existing)
	out = get_batch(batch_name)
	out["added_row_ids"] = [r.get("row_id") for r in added]
	return out


@frappe.whitelist()
def remove_draft_rows(batch_name: str, row_ids_json: str = "[]"):
	"""Remove pending draft rows the staff no longer wants to publish."""
	assert_stock_manager()
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	if doc.status == "Committed":
		frappe.throw(_("This import batch is already fully committed."))
	ids = set(_loads(row_ids_json, []) or [])
	if not ids:
		frappe.throw(_("No rows selected to remove."))
	existing = _loads(doc.rows_json, [])
	kept = []
	removed = 0
	for r in existing:
		rid = r.get("row_id")
		if rid in ids:
			if cstr(r.get("status")) == "applied":
				frappe.throw(_("Cannot remove a row that was already published ({0}).").format(rid))
			removed += 1
			continue
		kept.append(r)
	if not removed:
		frappe.throw(_("Those rows were not found in this draft."))
	_save_batch_rows(doc, kept)
	out = get_batch(batch_name)
	out["removed_count"] = removed
	return out


@frappe.whitelist()
def export_batch_csv(batch_name: str):
	"""Export current draft preview rows as CSV (same columns as template)."""
	assert_stock_manager()
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	rows = _loads(doc.rows_json, [])
	buf = io.StringIO()
	writer = csv.writer(buf)
	writer.writerow(CSV_TEMPLATE_HEADERS)
	for r in rows:
		writer.writerow(
			[
				cstr(r.get("product_name") or ""),
				cstr(r.get("style_code") or ""),
				cstr(r.get("size") or ""),
				cstr(r.get("color") or r.get("color_raw") or ""),
				cstr(r.get("qty_raw") or r.get("qty") or ""),
				"" if r.get("price") in (None, "") else cstr(r.get("price")),
				cstr(r.get("barcode") or ""),
				cstr(r.get("item_group") or ""),
			]
		)
	safe = frappe.scrub(batch_name).replace("_", "-")
	return {"filename": f"{safe}-preview.csv", "content": buf.getvalue()}


@frappe.whitelist()
def create_batch_from_csv(
	csv_content: str,
	warehouse: str = "",
	pack_map_json: str = "{}",
	company: str = "",
	default_item_group: str = "",
):
	assert_stock_manager()
	company = company or get_default_company()
	warehouse = _require_warehouse(warehouse, company)

	pack_map = _loads(pack_map_json, {})
	raw_rows = _parse_csv_content(csv_content)
	default_group = cstr(default_item_group).strip()
	if default_group:
		for r in raw_rows:
			if not r.get("item_group"):
				r["item_group"] = default_group
	rows = enrich_rows(raw_rows, pack_map)

	doc = frappe.get_doc(
		{
			"doctype": "KQS Stock Import Batch",
			"status": "Draft",
			"source_type": "CSV",
			"warehouse": warehouse,
			"company": company,
			"pack_map_json": _dumps(pack_map),
			"rows_json": _dumps(rows),
		}
	)
	doc.insert(ignore_permissions=True)
	return {"batch": doc.name, "rows": rows, "warehouse": warehouse}


@frappe.whitelist()
def create_batch_from_images(
	file_urls: str,
	warehouse: str = "",
	pack_map_json: str = "{}",
	company: str = "",
	default_item_group: str = "",
):
	assert_stock_manager()
	company = company or get_default_company()
	warehouse = _require_warehouse(warehouse, company)

	urls = _loads(file_urls, [])
	if isinstance(urls, str):
		urls = [urls]
	if not urls:
		frappe.throw(_("Upload at least one image."))

	image_bytes = []
	mimes = []
	for url in urls:
		url = cstr(url).strip()
		name = frappe.db.get_value("File", {"file_url": url}, "name")
		if not name:
			frappe.throw(_("Could not read image {0}. Upload the file first.").format(url))
		file_doc = frappe.get_doc("File", name)
		raw = file_doc.get_content()
		if isinstance(raw, str):
			raw = raw.encode("utf-8")
		image_bytes.append(raw)
		fname = (file_doc.file_name or "").lower()
		mimes.append("image/png" if fname.endswith(".png") else "image/jpeg")

	ai_text = complete_vision(
		EXTRACT_PROMPT.format(category_list=_category_list_for_prompt()),
		image_bytes,
		mimes,
	)
	parsed = parse_json_from_ai_text(ai_text)
	raw_rows = parsed.get("rows") if isinstance(parsed, dict) else parsed
	if not isinstance(raw_rows, list) or not raw_rows:
		frappe.throw(_("AI did not return any stock rows. Try a clearer photo or use CSV."))

	default_group = cstr(default_item_group).strip()
	for r in raw_rows:
		sug = cstr(r.get("suggested_category") or "").strip()
		if sug and not cstr(r.get("item_group") or "").strip():
			if frappe.db.exists("Item Group", sug) and not cint(
				frappe.db.get_value("Item Group", sug, "is_group")
			):
				r["item_group"] = sug
				r["_category_suggested"] = 1
		if default_group and not cstr(r.get("item_group") or "").strip():
			r["item_group"] = default_group

	pack_map = _loads(pack_map_json, {})
	rows = enrich_rows(raw_rows, pack_map)
	ai = get_ai_config()

	doc = frappe.get_doc(
		{
			"doctype": "KQS Stock Import Batch",
			"status": "Draft",
			"source_type": "Paper",
			"warehouse": warehouse,
			"company": company,
			"ai_provider": ai.get("provider") or "",
			"pack_map_json": _dumps(pack_map),
			"rows_json": _dumps(rows),
		}
	)
	doc.insert(ignore_permissions=True)
	return {
		"batch": doc.name,
		"rows": rows,
		"warehouse": warehouse,
		"ai_provider": ai.get("provider"),
	}


def _scrub_row_style_suggestions(rows: list[dict]) -> list[dict]:
	"""Remove stale circular style suggestions from draft rows (08↔09)."""
	for row in rows or []:
		style = cstr(row.get("style_code") or "")
		cleaned = _sanitize_style_spelling_suggestions(
			style, row.get("style_spelling_suggestions") or []
		)
		row["style_spelling_suggestions"] = cleaned
		flags = set(row.get("flags") or [])
		if cleaned:
			flags.add("spelling_suggestion")
		elif "spelling_suggestion" in flags and not (row.get("name_spelling_suggestions") or []):
			flags.discard("spelling_suggestion")
		row["flags"] = sorted(flags)
	return rows


@frappe.whitelist()
def get_batch(batch_name: str):
	assert_stock_manager()
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	rows = _scrub_row_style_suggestions(_loads(doc.rows_json, []))
	return {
		"name": doc.name,
		"status": doc.status,
		"source_type": doc.source_type,
		"warehouse": doc.warehouse,
		"company": doc.company,
		"ai_provider": doc.ai_provider,
		"pack_map": _loads(doc.pack_map_json, {}),
		"rows": rows,
		"result": _loads(doc.result_json, {}),
		"error_summary": doc.error_summary or "",
	}


@frappe.whitelist()
def update_batch(
	batch_name: str,
	rows_json: str = "",
	warehouse: str = "",
	pack_map_json: str = "",
	re_enrich: int = 1,
):
	assert_stock_manager()
	doc = _get_batch_for_update(batch_name)
	if doc.status == "Committed":
		frappe.throw(_("This import batch is already fully committed."))

	if warehouse:
		company = doc.company or get_default_company()
		if not is_kqs_store_warehouse(warehouse, company):
			frappe.throw(_("Select a valid KQS warehouse."))
		doc.warehouse = warehouse

	pack_map = _loads(pack_map_json, None)
	if pack_map is not None and pack_map_json != "":
		doc.pack_map_json = _dumps(pack_map)
	else:
		pack_map = _loads(doc.pack_map_json, {})

	if rows_json:
		rows = _loads(rows_json, [])
		# Always re-apply published markers from the server draft — silent autosave
		# must never wipe applied / commit_result after a partial publish.
		server_by_id = {
			cstr(r.get("row_id")): r for r in _loads(doc.rows_json, [])
		}
		for r in rows:
			prev_server = server_by_id.get(cstr(r.get("row_id")))
			if not prev_server:
				continue
			if _row_already_published(prev_server) or cstr(prev_server.get("status")) == "applied":
				r["status"] = "applied"
				r["commit_result"] = prev_server.get("commit_result") or r.get("commit_result")
				r["action"] = prev_server.get("action") or r.get("action")
				r["linked_template"] = prev_server.get("linked_template") or r.get(
					"linked_template"
				)
				r["linked_item"] = prev_server.get("linked_item") or r.get("linked_item")
				r["error"] = ""
		if cint(re_enrich):
			preserved = {
				r.get("row_id"): r
				for r in rows
				if cint(r.get("_link_confirmed"))
				or cint(r.get("_force_create"))
				or r.get("status") == "applied"
				or cint(r.get("_qty_edited"))
			}
			rows = enrich_rows(rows, pack_map)
			for r in rows:
				prev = preserved.get(r.get("row_id"))
				if not prev:
					continue
				if cint(prev.get("_force_create")):
					r["action"] = "create"
					r["_force_create"] = 1
					r["linked_template"] = ""
					r["match_candidates"] = []
					keep_flags = [
						f
						for f in (r.get("flags") or [])
						if f
						not in (
							"needs_match_choice",
							"needs_match",
							"missing_variant_attrs",
						)
					]
					r["flags"] = sorted(set(keep_flags + ["force_create"]))
				elif cint(prev.get("_link_confirmed")) and prev.get("linked_template"):
					r["linked_template"] = prev["linked_template"]
					r["_link_confirmed"] = 1
					_set_action_for_linked(r)
				if cint(prev.get("_qty_edited")):
					r["qty"] = flt(prev.get("qty"))
					r["_qty_edited"] = 1
					r["qty_uncertain"] = 0
				if prev.get("item_group"):
					r["item_group"] = prev["item_group"]
					r["_category_suggested"] = cint(prev.get("_category_suggested"))
				if cint(prev.get("_spelling_locked")):
					r["_spelling_locked"] = 1
					r["product_name"] = prev.get("product_name") or r.get("product_name")
					r["style_code"] = prev.get("style_code") or r.get("style_code")
					r["name_spelling_suggestions"] = []
					r["style_spelling_suggestions"] = []
				if prev.get("price") not in (None, ""):
					r["price"] = prev["price"]
				if prev.get("status") == "applied":
					r["status"] = "applied"
					r["commit_result"] = prev.get("commit_result")
					r["action"] = prev.get("action") or r.get("action")
			# Re-merge server applied after enrich (enrich can drop markers)
			for r in rows:
				prev_server = server_by_id.get(cstr(r.get("row_id")))
				if prev_server and (
					_row_already_published(prev_server)
					or cstr(prev_server.get("status")) == "applied"
				):
					r["status"] = "applied"
					r["commit_result"] = prev_server.get("commit_result") or r.get(
						"commit_result"
					)
					r["error"] = ""
		_save_batch_rows(doc, rows)
	else:
		doc.save(ignore_permissions=True)

	return get_batch(batch_name)


@frappe.whitelist()
def accept_match(batch_name: str, row_id: str, template: str):
	assert_stock_manager()
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	rows = _loads(doc.rows_json, [])
	template = cstr(template).strip()
	if not template or not frappe.db.exists("Item", template):
		frappe.throw(_("Item {0} was not found.").format(template or ""))

	row_id = cstr(row_id)
	found = False
	for row in rows:
		if cstr(row.get("row_id")) != row_id:
			continue
		found = True
		row["linked_template"] = template
		row["_link_confirmed"] = 1
		row["_force_create"] = 0
		row["error"] = ""
		row["linked_item_name"] = frappe.db.get_value("Item", template, "item_name") or template
		row["linked_style_code"] = (
			frappe.db.get_value("Item", template, "item_code") or template
		)
		_set_action_for_linked(row)
		break
	if not found:
		frappe.throw(_("Row not found."))
	_save_batch_rows(doc, rows)
	return get_batch(batch_name)


@frappe.whitelist()
def force_create_row(batch_name: str, row_id: str):
	assert_stock_manager()
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	rows = _loads(doc.rows_json, [])
	row_id = cstr(row_id)
	found = False
	for row in rows:
		if cstr(row.get("row_id")) != row_id:
			continue
		found = True
		row["action"] = "create"
		row["_force_create"] = 1
		row["_link_confirmed"] = 0
		row["linked_template"] = ""
		row["linked_item"] = ""
		row["match_candidates"] = []
		row["error"] = ""
		# Drop orange “needs match” flags — staff already chose Create as new.
		keep_flags = [
			f
			for f in (row.get("flags") or [])
			if f
			not in (
				"needs_match_choice",
				"needs_match",
				"missing_variant_attrs",
			)
		]
		row["flags"] = sorted(set(keep_flags + ["force_create"]))
		break
	if not found:
		frappe.throw(_("Row not found."))
	_save_batch_rows(doc, rows)
	return get_batch(batch_name)


@frappe.whitelist()
def search_catalog_matches(query: str = "", limit: int = 20):
	"""Return a flat list of catalog templates for the Match → Search dialog."""
	assert_stock_manager()
	from kqs_retail.api.product_setup import search_products_for_edit

	payload = search_products_for_edit(query=query, start=0, limit=limit)
	items = payload.get("items") if isinstance(payload, dict) else payload
	out = []
	for it in items or []:
		out.append(
			{
				"item_code": it.get("item_code") or it.get("name"),
				"item_name": it.get("item_name"),
				"style_code": it.get("item_code") or it.get("name"),
				"item_group": it.get("item_group"),
				"has_variants": cint(it.get("has_variants")),
			}
		)
	return out


@frappe.whitelist()
def rematch_batch(batch_name: str, rows_json: str = ""):
	"""
	Re-run catalog match after Name/Style edits.

	Pass rows_json from the client so save + rematch happen in one write
	(avoids deadlock from overlapping update_batch + rematch_batch).
	"""
	assert_stock_manager()
	doc = _get_batch_for_update(batch_name)
	if doc.status == "Committed":
		frappe.throw(_("This import batch is already fully committed."))

	if rows_json:
		rows = _loads(rows_json, [])
	else:
		rows = _loads(doc.rows_json, [])

	# Sync raw mirrors so future enrich paths cannot resurrect stale paper text.
	for r in rows:
		if r.get("product_name") is not None:
			r["name_raw"] = cstr(r.get("product_name") or "")
		if r.get("style_code") is not None:
			r["style_raw"] = cstr(r.get("style_code") or "")
		if r.get("color") is not None:
			r["color_raw"] = cstr(r.get("color") or "")
		if r.get("size") is not None:
			r["size_raw"] = cstr(r.get("size") or "")
		# Name/Style changed → drop previous auto/manual link and rematch (keep Create as new).
		if r.get("status") == "applied" or cint(r.get("_force_create")):
			continue
		r["_link_confirmed"] = 0
		r["linked_template"] = ""
		r["linked_item"] = ""
		r["linked_item_name"] = ""
		r["linked_style_code"] = ""

	prev_by_id = {r.get("row_id"): dict(r) for r in rows}
	matched = match_rows_to_catalog(rows)
	out_rows = []
	for r in matched:
		prev = prev_by_id.get(r.get("row_id")) or {}
		# Keep every staff-edited field; only refresh match/action metadata.
		merged = dict(prev)
		for key in (
			"action",
			"match_candidates",
			"linked_template",
			"linked_item",
			"linked_item_name",
			"linked_style_code",
			"_link_confirmed",
			"flags",
			"error",
			"confidence",
		):
			if key in r:
				merged[key] = r.get(key)
		if cint(prev.get("_force_create")):
			merged["action"] = "create"
			merged["_force_create"] = 1
			merged["_link_confirmed"] = 0
			merged["linked_template"] = ""
			merged["match_candidates"] = []
			keep_flags = [
				f
				for f in (merged.get("flags") or [])
				if f
				not in (
					"needs_match_choice",
					"needs_match",
					"missing_variant_attrs",
				)
			]
			merged["flags"] = sorted(set(keep_flags + ["force_create"]))
		if prev.get("status") == "applied":
			merged["status"] = "applied"
			merged["commit_result"] = prev.get("commit_result")
			merged["action"] = prev.get("action") or merged.get("action")
		out_rows.append(merged)

	_save_batch_rows(doc, out_rows)
	return get_batch(batch_name)


@frappe.whitelist()
def commit_batch(batch_name: str, commit_valid_only: int = 1, item_group: str = ""):
	assert_stock_manager()
	batch_name = cstr(batch_name or "").strip()
	if not _acquire_commit_lock(batch_name):
		frappe.throw(
			_("Publish already in progress for this draft. Wait a moment, then try again."),
			title=_("Publish in progress"),
		)
	try:
		return _commit_batch_inner(batch_name, commit_valid_only, item_group)
	finally:
		_release_commit_lock(batch_name)


def _acquire_commit_lock(batch_name: str) -> bool:
	"""Single-flight publish per draft (cache NX + DB row lock)."""
	if not batch_name:
		return False
	key = f"kqs_bi_commit:{batch_name}"
	cache = frappe.cache()
	# Prefer Redis SET NX when available
	try:
		ok = cache.set(key, frappe.session.user or "1", ex=600, nx=True)
		if ok is False:
			return False
		if ok is None:
			# Some cache backends ignore nx — fall through to get/set
			if cache.get(key):
				return False
			cache.set(key, frappe.session.user or "1", ex=600)
	except TypeError:
		if cache.get_value(key):
			return False
		cache.set_value(key, frappe.session.user or "1", expires_in_sec=600)
	except Exception:
		# Still proceed with FOR UPDATE below
		pass
	try:
		frappe.db.sql(
			"SELECT name FROM `tabKQS Stock Import Batch` WHERE name=%s FOR UPDATE",
			batch_name,
		)
	except Exception:
		pass
	return True


def _release_commit_lock(batch_name: str) -> None:
	key = f"kqs_bi_commit:{batch_name}"
	try:
		frappe.cache().delete(key)
	except Exception:
		try:
			frappe.cache().delete_value(key)
		except Exception:
			pass


def _commit_batch_inner(batch_name: str, commit_valid_only: int = 1, item_group: str = ""):
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	if doc.status == "Committed":
		frappe.throw(_("This import batch is already fully committed."))

	rows = _loads(doc.rows_json, [])
	warehouse = cstr(doc.warehouse or "").strip()
	if not warehouse:
		frappe.throw(_("Warehouse is required."))
	company = doc.company or get_default_company()
	if not is_kqs_store_warehouse(warehouse, company):
		frappe.throw(_("Select a valid KQS warehouse."))

	default_group = (item_group or "").strip()
	prev_result = _loads(doc.result_json, {}) if doc.result_json else {}
	published_skus = dict(prev_result.get("published_skus") or {})
	results = {
		"created": [],
		"variants_added": [],
		"received": [],
		"skipped": [],
		"errors": [],
		"published_skus": published_skus,
		"warehouse": warehouse,
	}

	rows = _scrub_row_style_suggestions(rows)

	# Apply default category to empty create rows before validation; clear stale publish errors
	for row in rows:
		if row.get("status") != "applied":
			row["error"] = ""
		if default_group and not cstr(row.get("item_group") or "").strip():
			row["item_group"] = default_group

	# Existing Colour/Color abbrs often collide (Gold+Grey → G). Repair before any publish.
	for attr_name in ("Colour", "Color"):
		if frappe.db.exists("Item Attribute", attr_name):
			try:
				_repair_duplicate_attribute_abbrs(attr_name)
			except Exception:
				frappe.log_error(frappe.get_traceback(), "KQS repair attribute abbrs")

	already_applied_ids = {
		cstr(r.get("row_id")) for r in rows if cstr(r.get("status")) == "applied"
	}

	publishable, blocked, samples = _count_publishable(rows, default_group="")
	if publishable == 0:
		detail = ""
		if samples:
			detail = "<br>".join(
				f"• {frappe.utils.escape_html(cstr(s.get('name') or s.get('style') or s.get('row_id')))}: "
				f"{frappe.utils.escape_html('; '.join(s.get('errors') or []))}"
				for s in samples
			)
		frappe.throw(
			_(
				"Nothing to publish. Fix required fields on draft rows first "
				"(Name, Style; for new products also Price + Category; resolve Needs match).<br><br>{0}"
			).format(detail or _("No pending rows.")),
			title=_("Required fields missing"),
		)

	create_groups: dict[str, list[dict]] = {}
	ordered_actions = []

	for row in rows:
		if _row_already_published(row) or row.get("status") == "applied":
			results["skipped"].append({"row_id": row["row_id"], "reason": "already_applied"})
			continue
		action = row.get("action")
		if action == "skip":
			results["skipped"].append({"row_id": row["row_id"], "reason": "skip"})
			row["error"] = _("Marked Skip — change action or remove row if not needed")
			continue
		blockers = _row_blocking_errors(row, all_rows=rows)
		if blockers:
			hint = "; ".join(blockers)
			row["error"] = _("Skipped — fix this: {0}").format(hint)
			if cint(commit_valid_only):
				results["skipped"].append(
					{"row_id": row["row_id"], "reason": hint, "needs_fix": 1}
				)
				continue
			results["errors"].append({"row_id": row["row_id"], "error": hint})
			row["status"] = "error"
			continue
		# Preflight: ensure colours / stockable target BEFORE any catalog write
		prep_errs = _preflight_publish_row(row, warehouse)
		if prep_errs:
			hint = "; ".join(prep_errs)
			row["error"] = _("Skipped — fix this: {0}").format(hint)
			results["skipped"].append(
				{"row_id": row["row_id"], "reason": hint, "needs_fix": 1}
			)
			continue
		if cstr(row.get("error") or "").startswith("Skipped"):
			row["error"] = ""
		if action == "create":
			key = _normalize_item_code(row.get("style_code") or "")
			create_groups.setdefault(key, []).append(row)
		else:
			ordered_actions.append(row)

	ctx = {
		"batch_name": batch_name,
		"warehouse": warehouse,
		"published_skus": published_skus,
	}

	for _style_key, group in create_groups.items():
		# Entire style group must pass — never create a template then fail mid-colours
		group_block = []
		for r in group:
			errs = _preflight_publish_row(r, warehouse)
			if errs:
				group_block.extend(errs)
				r["error"] = _("Skipped — fix this: {0}").format("; ".join(errs))
		if group_block:
			for r in group:
				if not r.get("error"):
					r["error"] = _("Skipped — fix sibling rows for this style first")
				results["skipped"].append(
					{
						"row_id": r["row_id"],
						"reason": cstr(r.get("error")),
						"needs_fix": 1,
					}
				)
			continue
		try:
			_commit_create_group(group, warehouse, default_group, results, ctx=ctx)
			_save_batch_rows(doc, rows)
			frappe.db.commit()
		except Exception as exc:
			# Recover any variants that already received stock before the failure
			_apply_partial_create_success(group, results, ctx)
			frappe.logger("kqs_bulk_import").exception("bulk import create failed")
			msg = str(exc)[:300]
			for row in group:
				if _row_already_published(row):
					continue
				row["error"] = msg
				row["status"] = "error"
				results["errors"].append({"row_id": row["row_id"], "error": msg})
			_save_batch_rows(doc, rows)
			frappe.db.commit()

	for row in ordered_actions:
		if _row_already_published(row):
			results["skipped"].append({"row_id": row["row_id"], "reason": "already_applied"})
			continue
		try:
			if row.get("action") == "add_variant":
				_commit_add_variant(row, warehouse, results, ctx=ctx)
			elif row.get("action") == "receive":
				_commit_receive(row, warehouse, results, ctx=ctx)
			_save_batch_rows(doc, rows)
			frappe.db.commit()
		except Exception as exc:
			frappe.logger("kqs_bulk_import").exception("bulk import row failed")
			msg = str(exc)[:300]
			row["error"] = msg
			row["status"] = "error"
			results["errors"].append({"row_id": row["row_id"], "error": msg})
			_save_batch_rows(doc, rows)
			frappe.db.commit()

	applied = sum(1 for r in rows if r.get("status") == "applied")
	errored = sum(1 for r in rows if r.get("status") == "error")
	pending = sum(
		1
		for r in rows
		if r.get("status") not in ("applied", "error") and r.get("action") != "skip"
	)

	if applied and not errored and not pending:
		doc.status = "Committed"
	elif applied and (errored or pending):
		doc.status = "Partial"
	elif errored and not applied:
		doc.status = "Failed"
	else:
		doc.status = "Reviewed"

	# Line-by-line publish log (success / failed / skipped) for staff retries
	log = _build_publish_log(rows, results, already_applied_ids)
	results["log"] = log
	results["summary"] = {
		"succeeded": sum(1 for x in log if x.get("outcome") == "succeeded"),
		"failed": sum(1 for x in log if x.get("outcome") == "failed"),
		"skipped": sum(1 for x in log if x.get("outcome") == "skipped"),
		"at": cstr(frappe.utils.now()),
		"warehouse": warehouse,
	}
	history = list(prev_result.get("history") or [])
	history.append(
		{
			"at": results["summary"]["at"],
			"summary": results["summary"],
			"log": log,
		}
	)
	results["history"] = history[-15:]
	results["published_skus"] = published_skus

	doc.result_json = _dumps(results)
	doc.error_summary = "; ".join(
		f"{e.get('name') or e.get('style') or e.get('row_id')}: {e.get('detail') or e.get('error')}"
		for e in log
		if e.get("outcome") in ("failed", "skipped") and e.get("detail")
	)[:500]
	_save_batch_rows(doc, rows)
	frappe.db.commit()
	return {"batch": get_batch(batch_name), "result": results}


def _build_publish_log(
	rows: list[dict], results: dict, already_applied_ids: set[str] | None = None
) -> list[dict]:
	"""Human-readable per-row outcomes for the last Approve & publish."""
	already_applied_ids = already_applied_ids or set()
	by_id = {cstr(r.get("row_id")): r for r in rows or []}
	log: list[dict] = []
	seen: set[str] = set()

	def _label(row: dict) -> tuple[str, str, str]:
		return (
			cstr(row.get("product_name") or ""),
			cstr(row.get("style_code") or ""),
			cstr(row.get("color") or row.get("color_raw") or ""),
		)

	def _enrich_codes(entry: dict, row: dict) -> None:
		cr = row.get("commit_result") if isinstance(row.get("commit_result"), dict) else {}
		codes = []
		for c in cr.get("item_codes") or []:
			if cstr(c).strip():
				codes.append(cstr(c).strip())
		one = cstr(cr.get("item_code") or row.get("linked_item") or "").strip()
		if one and one not in codes:
			codes.insert(0, one)
		tpl = cstr(cr.get("template") or row.get("linked_template") or "").strip()
		wh = cstr(cr.get("warehouse") or results.get("warehouse") or "").strip()
		entry["item_codes"] = codes
		entry["item_code"] = codes[0] if codes else ""
		entry["template"] = tpl
		entry["warehouse"] = wh
		if tpl and tpl not in codes:
			entry["open_item"] = codes[0] if codes else tpl
		else:
			entry["open_item"] = codes[0] if codes else tpl

	for row in rows or []:
		rid = cstr(row.get("row_id"))
		name, style, color = _label(row)
		status = cstr(row.get("status") or "")
		action = cstr(row.get("action") or "")
		entry = {
			"row_id": rid,
			"name": name,
			"style": style,
			"color": color,
			"action": action,
			"qty": flt(row.get("qty")),
		}
		if status == "applied":
			_enrich_codes(entry, row)
			if rid in already_applied_ids:
				entry["outcome"] = "skipped"
				entry["needs_fix"] = 0
				entry["detail"] = _(
					"Already published earlier — nothing to fix; will not add again"
				)
			else:
				detail = _("Published this run")
				cr = row.get("commit_result") or {}
				if isinstance(cr, dict):
					codes = entry.get("item_codes") or []
					wh = entry.get("warehouse") or ""
					bits = []
					if codes:
						bits.append(_("SKU {0}").format(", ".join(codes[:3])))
					if entry.get("template"):
						bits.append(_("style {0}").format(entry.get("template")))
					if wh:
						bits.append(_("at {0}").format(wh))
					if cr.get("stock_entry"):
						bits.append(_("SE {0}").format(cr.get("stock_entry")))
					if bits:
						detail = _("Published — {0}").format(" · ".join(bits))
					elif cr.get("template"):
						detail = _("Published — product {0}").format(cr.get("template"))
				entry["outcome"] = "succeeded"
				entry["detail"] = detail
			log.append(entry)
			seen.add(rid)
		elif status == "error":
			entry["outcome"] = "failed"
			entry["detail"] = cstr(row.get("error") or _("Publish failed"))
			log.append(entry)
			seen.add(rid)

	for s in results.get("skipped") or []:
		rid = cstr(s.get("row_id"))
		if rid in seen:
			continue
		row = by_id.get(rid) or {}
		name, style, color = _label(row)
		reason = cstr(s.get("reason") or "")
		if reason == "already_applied":
			continue
		detail = reason
		needs_fix = cint(s.get("needs_fix"))
		if reason == "skip":
			detail = _("Marked Skip")
			needs_fix = 1
		elif reason == "zero_qty":
			detail = _("Zero qty — enter a quantity")
			needs_fix = 1
		elif reason:
			detail = _("Not published — {0}").format(reason)
			needs_fix = 1
		log.append(
			{
				"row_id": rid,
				"name": name or cstr(row.get("product_name") or ""),
				"style": style or cstr(row.get("style_code") or ""),
				"color": color,
				"action": cstr(row.get("action") or ""),
				"qty": flt(row.get("qty")),
				"outcome": "skipped",
				"needs_fix": needs_fix,
				"detail": detail,
			}
		)

	for e in results.get("errors") or []:
		rid = cstr(e.get("row_id"))
		if rid in seen:
			continue
		row = by_id.get(rid) or {}
		name, style, color = _label(row)
		log.append(
			{
				"row_id": rid,
				"name": name,
				"style": style,
				"color": color,
				"action": cstr(row.get("action") or ""),
				"qty": flt(row.get("qty")),
				"outcome": "failed",
				"detail": cstr(e.get("error") or row.get("error") or _("Error")),
			}
		)
		seen.add(rid)

	order = {"failed": 0, "skipped": 1, "succeeded": 2}
	log.sort(
		key=lambda x: (
			order.get(x.get("outcome") or "", 9),
			x.get("style") or "",
			x.get("name") or "",
		)
	)
	return log


def _preflight_publish_row(row: dict, warehouse: str) -> list[str]:
	"""
	Validate a row can be published WITHOUT writing catalog/stock.
	Used so Approve does not create products then fail with an error popup.
	"""
	errs: list[str] = []
	action = cstr(row.get("action") or "").strip()
	try:
		if action in ("create", "add_variant"):
			template = cstr(row.get("linked_template") or "").strip() or None
			if action == "create":
				template = None
			attrs = _variant_attrs_for_row(row, template=template)
			for k, v in (attrs or {}).items():
				if not cstr(v).strip():
					continue
				try:
					_ensure_attribute_value(k, v)
				except Exception as exc:
					errs.append(cstr(exc)[:200])
			if action == "add_variant":
				tpl = cstr(row.get("linked_template") or "").strip()
				if not tpl or not frappe.db.exists("Item", tpl):
					errs.append(_("Linked product is missing — Search / change the match"))
				elif not attrs:
					errs.append(_("Color or size required to add a variant"))
		elif action == "receive":
			from kqs_retail.api.product_setup import _resolve_stockable_item

			code = cstr(row.get("linked_item") or row.get("linked_template") or "").strip()
			if not code:
				errs.append(_("No linked SKU to receive into"))
			else:
				attrs = _variant_attrs_for_row(
					row, template=row.get("linked_template") or code
				)
				_resolve_stockable_item(code, attrs)
		if flt(row.get("qty")) <= 0 and action in ("create", "add_variant", "receive"):
			errs.append(_("Qty must be greater than zero"))
	except Exception as exc:
		errs.append(cstr(exc)[:200])
	return errs


def _row_already_published(row: dict) -> bool:
	"""True if this draft row already wrote catalog/stock — never receive again on retry."""
	if cstr(row.get("status")) == "applied":
		return True
	cr = row.get("commit_result")
	if not isinstance(cr, dict):
		return False
	if cr.get("stock_entry") or cr.get("template") or cr.get("idempotent"):
		return True
	if cr.get("variants") and cr.get("stock_entry") is not None:
		return True
	return False


def _mark_row_published(row: dict, commit_result: dict | None = None) -> None:
	if commit_result is not None:
		row["commit_result"] = commit_result
	cr = row.get("commit_result")
	if isinstance(cr, dict):
		cr["idempotent"] = 1
		row["commit_result"] = cr
	row["status"] = "applied"
	row["error"] = ""
	row["_published_at"] = cstr(frappe.utils.now())


def _sku_map_key(item_code: str, warehouse: str) -> str:
	return f"{cstr(item_code).strip()}|{cstr(warehouse).strip()}"


def _record_published_sku(
	ctx: dict | None,
	item_code: str,
	warehouse: str,
	qty: float,
	stock_entry: str | None = None,
) -> None:
	if not ctx or not item_code:
		return
	published = ctx.setdefault("published_skus", {})
	published[_sku_map_key(item_code, warehouse)] = {
		"qty": flt(qty),
		"stock_entry": cstr(stock_entry or ""),
		"at": cstr(frappe.utils.now()),
	}


def _sku_already_published_in_batch(
	ctx: dict | None, item_code: str, warehouse: str
) -> dict | None:
	if not ctx or not item_code:
		return None
	return (ctx.get("published_skus") or {}).get(_sku_map_key(item_code, warehouse))


def _apply_line_results_to_rows(
	rows_by_id: dict[str, dict],
	line_results: list[dict],
	base_result: dict,
	results: dict,
	ctx: dict | None,
) -> None:
	for lr in line_results or []:
		rid = cstr(lr.get("row_id") or "")
		row = rows_by_id.get(rid)
		if not row:
			continue
		code = cstr(lr.get("item_code") or "")
		se = cstr(lr.get("stock_entry") or "")
		wh = cstr(lr.get("warehouse") or (ctx or {}).get("warehouse") or "")
		cr = dict(base_result or {})
		cr.update(
			{
				"item_code": code,
				"item_codes": [code] if code else [],
				"stock_entry": se,
				"warehouse": wh,
				"template": cr.get("template"),
				"idempotent": 1,
			}
		)
		if code:
			row["linked_item"] = code
		if cr.get("template"):
			row["linked_template"] = cr.get("template")
		_mark_row_published(row, cr)
		_record_published_sku(ctx, code, wh, flt(row.get("qty")), se)


def _apply_partial_create_success(
	group: list[dict], results: dict, ctx: dict | None
) -> None:
	partial = getattr(frappe.flags, "kqs_create_partial", None) or {}
	frappe.flags.kqs_create_partial = None
	if not partial:
		return
	by_id = {cstr(r.get("row_id")): r for r in group}
	_apply_line_results_to_rows(
		by_id, partial.get("line_results") or [], partial, results, ctx
	)
	results.setdefault("created", []).append(partial)


def _commit_create_group(
	group: list[dict],
	warehouse: str,
	default_group: str,
	results: dict,
	ctx: dict | None = None,
):
	# Skip rows already published (retry safety)
	pending = [r for r in group if not _row_already_published(r)]
	if not pending:
		for r in group:
			results["skipped"].append({"row_id": r["row_id"], "reason": "already_applied"})
		return

	first = pending[0]
	item_name = first.get("product_name")
	style_code = first.get("style_code")
	item_group = cstr(first.get("item_group") or default_group).strip()
	if not item_group:
		frappe.throw(_("Select a category (Item Group) before creating products."))

	batch_name = cstr((ctx or {}).get("batch_name") or "")
	template_code = _normalize_item_code(style_code or "")
	# Style already in catalog (retries / F-720) → add stock / variants, never re-create
	if template_code and frappe.db.exists("Item", template_code):
		for r in pending:
			r["linked_template"] = template_code
			r["_link_confirmed"] = 1
			r["_force_create"] = 0
			_set_action_for_linked(r)
			if r.get("action") == "receive":
				_commit_receive(r, warehouse, results, ctx=ctx)
			elif r.get("action") == "add_variant":
				_commit_add_variant(r, warehouse, results, ctx=ctx)
			else:
				frappe.throw(
					_("SKU / Style number {0} already exists — Accept the match or Search catalog.").format(
						template_code
					)
				)
			r["linked_template"] = template_code
		results.setdefault("redirected_existing", []).append(template_code)
		return

	has_size = any(cstr(r.get("size")).strip() for r in pending)
	has_color = any(cstr(r.get("color")).strip() for r in pending)
	size_name, color_name = _size_color_attr_names(None)
	attr_names = []
	if has_size:
		attr_names.append(size_name)
	if has_color:
		attr_names.append(color_name)

	matrix = []
	for r in pending:
		attrs = _variant_attrs_for_row(r)
		canonical = {}
		for k, v in attrs.items():
			canonical[k] = _ensure_attribute_value(k, v) or v
		attrs = canonical
		rate = flt(r.get("price"))
		if rate <= 0:
			frappe.throw(_("Price is required for {0} / {1}.").format(item_name, style_code))
		row_id = cstr(r.get("row_id") or "")
		matrix.append(
			{
				"attributes": attrs,
				"rate": rate,
				"qty": flt(r.get("qty")),
				"barcode": cstr(r.get("barcode") or ""),
				"row_id": row_id,
				"import_batch": batch_name,
			}
		)

	has_variants = 1 if attr_names else 0
	if not has_variants:
		matrix = [
			{
				"attributes": {},
				"rate": flt(first.get("price")),
				"qty": sum(flt(r.get("qty")) for r in pending),
				"barcode": cstr(first.get("barcode") or ""),
				"row_id": cstr(first.get("row_id") or ""),
				"import_batch": batch_name,
			}
		]

	out = create_product_with_variants(
		item_name=item_name,
		item_group=item_group,
		variant_matrix=_dumps(matrix),
		style_code=style_code,
		has_variants=has_variants,
		central_warehouse=warehouse,
		variant_attributes=_dumps(attr_names),
		item_groups=_dumps([item_group]),
	)
	results["created"].append(out)
	by_id = {cstr(r.get("row_id")): r for r in pending}
	line_results = out.get("line_results") or []
	if line_results:
		_apply_line_results_to_rows(by_id, line_results, out, results, ctx)
		# Any pending without a line_result still mark with template (edge: zero lines)
		for r in pending:
			if not _row_already_published(r):
				r["linked_template"] = out.get("template")
				_mark_row_published(
					r,
					{
						"template": out.get("template"),
						"warehouse": warehouse,
						"idempotent": 1,
					},
				)
	else:
		for r in pending:
			r["linked_template"] = out.get("template")
			_mark_row_published(r, out)


def _commit_add_variant(
	row: dict, warehouse: str, results: dict, ctx: dict | None = None
):
	if _row_already_published(row):
		results["skipped"].append({"row_id": row["row_id"], "reason": "already_applied"})
		return
	template = row.get("linked_template")
	attrs = _variant_attrs_for_row(row, template=template)
	if not attrs:
		frappe.throw(_("Color or size required to add a variant."))
	canonical = {}
	for k, v in attrs.items():
		canonical[k] = _ensure_attribute_value(k, v) or v
	attrs = canonical
	rate = flt(row.get("price"))
	batch_name = cstr((ctx or {}).get("batch_name") or "")
	variants = [
		{
			"attributes": attrs,
			"rate": rate,
			"qty": flt(row.get("qty")),
			"barcode": cstr(row.get("barcode") or ""),
			"row_id": cstr(row.get("row_id") or ""),
			"import_batch": batch_name,
		}
	]
	out = add_variants_to_product(
		template=template,
		variants_json=_dumps(variants),
		receive_warehouse=warehouse,
	)
	results["variants_added"].append(out)
	line_results = out.get("line_results") or []
	if line_results:
		_apply_line_results_to_rows(
			{cstr(row.get("row_id")): row}, line_results, out, results, ctx
		)
	else:
		_mark_row_published(row, {**out, "warehouse": warehouse})
		for code in out.get("variants") or []:
			_record_published_sku(ctx, code, warehouse, flt(row.get("qty")), out.get("stock_entry"))


def _commit_receive(
	row: dict, warehouse: str, results: dict, ctx: dict | None = None
):
	from kqs_retail.api.product_setup import (
		_resolve_stockable_item,
		find_receipt_by_idempotency_key,
		make_bulk_import_receipt_key,
	)

	if _row_already_published(row):
		results["skipped"].append({"row_id": row["row_id"], "reason": "already_applied"})
		return
	item_code = row.get("linked_item") or row.get("linked_template")
	qty = flt(row.get("qty"))
	if qty <= 0:
		results["skipped"].append({"row_id": row["row_id"], "reason": "zero_qty"})
		row["commit_result"] = {"skipped": "zero_qty", "idempotent": 1}
		return
	attrs = _variant_attrs_for_row(row, template=row.get("linked_template") or item_code)
	item_code = _resolve_stockable_item(cstr(item_code), attrs)

	# Batch map: already received this SKU into this warehouse for this draft
	prior = _sku_already_published_in_batch(ctx, item_code, warehouse)
	if prior:
		_mark_row_published(
			row,
			{
				"stock_entry": prior.get("stock_entry"),
				"item_code": item_code,
				"item_codes": [item_code],
				"warehouse": warehouse,
				"idempotent": 1,
				"skipped_duplicate": 1,
			},
		)
		row["linked_item"] = item_code
		results["skipped"].append({"row_id": row["row_id"], "reason": "already_applied"})
		return

	batch_name = cstr((ctx or {}).get("batch_name") or "")
	row_id = cstr(row.get("row_id") or "")
	idem_key = (
		make_bulk_import_receipt_key(batch_name, row_id, item_code)
		if batch_name and row_id
		else ""
	)
	if idem_key:
		existing_se = find_receipt_by_idempotency_key(idem_key)
		if existing_se:
			_mark_row_published(
				row,
				{
					"stock_entry": existing_se,
					"item_code": item_code,
					"item_codes": [item_code],
					"warehouse": warehouse,
					"idempotent": 1,
					"skipped_duplicate": 1,
				},
			)
			row["linked_item"] = item_code
			_record_published_sku(ctx, item_code, warehouse, qty, existing_se)
			results["skipped"].append({"row_id": row["row_id"], "reason": "already_applied"})
			return

	rate = flt(row.get("price"))
	payload = [
		{
			"item_code": item_code,
			"qty": qty,
			"rate": rate,
			"idempotency_key": idem_key,
		}
	]
	out = receive_stock(warehouse=warehouse, items_json=_dumps(payload))
	out = dict(out or {})
	out["item_code"] = item_code
	out["item_codes"] = [item_code]
	out["warehouse"] = warehouse
	results["received"].append(out)
	row["linked_item"] = item_code
	_mark_row_published(row, out)
	_record_published_sku(ctx, item_code, warehouse, qty, out.get("stock_entry"))
