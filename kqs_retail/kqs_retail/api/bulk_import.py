# Copyright (c) 2026, KQS
"""Bulk stock import: CSV + paper AI → preview → create / add_variant / receive."""

from __future__ import annotations

import csv
import io
import json
import re
import uuid
from difflib import SequenceMatcher

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

from kqs_retail.api.product_setup import (
	_normalize_item_code,
	add_variants_to_product,
	create_product_with_variants,
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
from kqs_retail.utils.warehouses import get_kqs_central_warehouse, is_kqs_store_warehouse

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

Paper columns (in order):
1. Name (product line / type) e.g. Soviet, Sidebag, Sportbag, School bag, Belt
2. Style number e.g. Boca L, Y Superboss, K Hollywood Core Vulcanised, SKA, Mbappe
3. Color e.g. blackmono, Grey/DK Grey, Iguana, Navy
4. Qty e.g. 1box, x 2, x3, 1pack (B pack)

Ditto marks: " or '' or .... means repeat the value from the row above for that column.
Two dittos " " means repeat both Name and Style.

Allowed Item Group (category) names in this ERPNext site — pick the best match for suggested_category when possible, or null:
{category_list}

Return ONLY JSON:
{{
  "rows": [
    {{
      "name_raw": "Sportbag",
      "style_raw": "Boca L",
      "color_raw": "black",
      "size_raw": "",
      "qty_raw": "x3",
      "price": null,
      "suggested_category": "Unisex",
      "confidence": 0.9
    }}
  ]
}}

Keep ditto marks as literal " in name_raw/style_raw when present so the server can re-resolve.
Do not invent prices. Include every line on the page.
suggested_category MUST be one of the allowed Item Group names above, or null if unsure.
"""


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


def _variant_attrs_for_row(row: dict) -> dict:
	attrs = {}
	if row.get("size"):
		attrs["Size"] = cstr(row["size"]).strip()
	if row.get("color"):
		attrs["Color"] = cstr(row["color"]).strip()
	return attrs


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
			if _norm_text(cstr(vattrs.get(k))) != _norm_text(cstr(v)):
				ok = False
				break
		if ok and set(attrs.keys()) <= set(vattrs.keys()):
			return code
	return None


def _set_action_for_linked(row: dict):
	template = cstr(row.get("linked_template") or "").strip()
	if not template or not frappe.db.exists("Item", template):
		row["action"] = "needs_match"
		return
	attrs = _variant_attrs_for_row(row)
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


def match_rows_to_catalog(rows: list[dict]) -> list[dict]:
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
			row["action"] = "create"
			row["match_candidates"] = []
			row["linked_template"] = ""
			continue

		style = cstr(row.get("style_code") or "").strip()
		name = cstr(row.get("product_name") or "").strip()
		style_norm = _normalize_item_code(style) if style else ""
		candidates = []

		exact = by_code.get(style_norm) if style_norm else None
		if exact:
			name_exact = _norm_text(exact.item_name) == _norm_text(name) if name else False
			if name_exact:
				row["linked_template"] = exact.name
				row["_link_confirmed"] = 1
				row["match_candidates"] = [
					{
						"item_code": exact.name,
						"item_name": exact.item_name,
						"style_code": exact.item_code or exact.name,
						"item_group": exact.item_group,
						"score": 1.0,
						"reason": "exact_name_and_style",
					}
				]
				_set_action_for_linked(row)
				continue
			candidates.append(
				{
					"item_code": exact.name,
					"item_name": exact.item_name,
					"style_code": exact.item_code or exact.name,
					"item_group": exact.item_group,
					"score": 0.92,
					"reason": "style_exact_name_fuzzy" if name else "style_exact",
				}
			)

		scored = []
		for t in templates:
			t_code = t.item_code or t.name
			style_score = _similarity(style, t_code) if style else 0.0
			name_score = _similarity(name, t.item_name) if name else 0.0
			score = max(style_score, name_score)
			if style_score >= 0.82 and name_score >= 0.82:
				score = 0.5 * style_score + 0.5 * name_score + 0.05
			if score < 0.78:
				continue
			reason = "fuzzy"
			if style_score >= 0.9 and name_score < 0.9:
				reason = "style_exact_name_fuzzy"
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
				}
			)

		scored.sort(key=lambda x: x["score"], reverse=True)
		seen = {c["item_code"] for c in candidates}
		for c in scored:
			if c["item_code"] in seen:
				continue
			candidates.append(c)
			seen.add(c["item_code"])
			if len(candidates) >= 5:
				break

		row["match_candidates"] = candidates
		row["linked_template"] = ""
		row["_link_confirmed"] = 0
		row["action"] = "needs_match" if candidates else "create"
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
			if lex_fix:
				style_sugs.append(
					{"value": lex_fix, "score": round(lex_sc, 3), "reason": "dictionary"}
				)
			for cand in style_index:
				sc = _similarity(style, cand)
				sc2 = _similarity(_normalize_item_code(style), _normalize_item_code(cand))
				sc = max(sc, sc2)
				if 0.78 <= sc < 1.0:
					fixed_cand, _ = _lexicon_correct_phrase(cand)
					show = fixed_cand or cand
					if _norm_text(show) == _norm_text(style):
						continue
					style_sugs.append(
						{
							"value": show,
							"score": round(sc, 3),
							"reason": "catalog_style_fixed" if fixed_cand else "catalog_style",
						}
					)
			style_sugs.sort(key=lambda x: (0 if x.get("reason") == "dictionary" else 1, -x["score"]))
			row["style_spelling_suggestions"] = _merge_spelling_suggestions([], style_sugs, limit=4)
			if row["style_spelling_suggestions"]:
				flags = set(row.get("flags") or [])
				flags.add("spelling_suggestion")
				row["flags"] = sorted(flags)
		else:
			row["style_spelling_suggestions"] = []

	return rows


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
			for alt in style_alts:
				if isinstance(alt, str):
					val = alt.strip()
					reason = "ai"
				elif isinstance(alt, dict):
					val = cstr(alt.get("value")).strip()
					reason = cstr(alt.get("reason") or "ai")
				else:
					continue
				if not val or _norm_text(val) == _norm_text(row.get("style_code")):
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
	company = company or get_default_company()
	central = get_kqs_central_warehouse(company)
	if central and frappe.db.exists("Warehouse", central):
		return central
	return ""


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


def _ensure_attribute_value(attribute: str, value: str):
	value = cstr(value).strip()
	if not value:
		return
	if not frappe.db.exists("Item Attribute", attribute):
		frappe.get_doc(
			{
				"doctype": "Item Attribute",
				"attribute_name": attribute,
				"item_attribute_values": [
					{"attribute_value": value, "abbr": frappe.utils.get_abbr(value, 4)}
				],
			}
		).insert(ignore_permissions=True)
		return
	exists = frappe.db.exists(
		"Item Attribute Value",
		{"parent": attribute, "parenttype": "Item Attribute", "attribute_value": value},
	)
	if exists:
		return
	doc = frappe.get_doc("Item Attribute", attribute)
	doc.append(
		"item_attribute_values",
		{"attribute_value": value, "abbr": frappe.utils.get_abbr(value, 4)},
	)
	doc.save(ignore_permissions=True)


def _row_blocking_errors(row: dict) -> list[str]:
	"""Hard gates before a row may be published."""
	errs = []
	action = cstr(row.get("action") or "").strip()
	if row.get("status") == "applied":
		return []
	if action == "skip":
		return []
	if action == "needs_match" or not action:
		errs.append(_("Needs match — accept a suggestion or create as new"))
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
		# Color-only / size-only products OK; if neither and has_variants intended, still allow standalone
	elif action == "add_variant":
		if not cstr(row.get("linked_template") or "").strip():
			errs.append(_("Link to an existing product before adding a variant"))
		attrs_ok = bool(cstr(row.get("color") or "").strip() or cstr(row.get("size") or "").strip())
		if not attrs_ok:
			errs.append(_("Color or size is required to add a variant"))
		# Price optional — uses catalog rate when blank
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
		blockers = _row_blocking_errors(probe)
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


def _save_batch_rows(doc, rows: list[dict]):
	doc.rows_json = _dumps(rows)
	doc.save(ignore_permissions=True)


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
	["Sportbag", "Boca L", "", "black", "3", "299", "", "Unisex"],
	["Sportbag", "Boca L", "", "Navy", "3", "299", "", "Unisex"],
	["Sidebag", "SKA", "", "Iguana", "2", "199", "", "Unisex"],
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
		"warehouse": _default_warehouse(company),
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
	warehouse = (warehouse or "").strip() or _default_warehouse(company)
	if warehouse and not is_kqs_store_warehouse(warehouse, company):
		frappe.throw(_("Select a valid KQS warehouse."))

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
	warehouse = (warehouse or "").strip() or _default_warehouse(company)
	if warehouse and not is_kqs_store_warehouse(warehouse, company):
		frappe.throw(_("Select a valid KQS warehouse."))

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


@frappe.whitelist()
def get_batch(batch_name: str):
	assert_stock_manager()
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
	return {
		"name": doc.name,
		"status": doc.status,
		"source_type": doc.source_type,
		"warehouse": doc.warehouse,
		"company": doc.company,
		"ai_provider": doc.ai_provider,
		"pack_map": _loads(doc.pack_map_json, {}),
		"rows": _loads(doc.rows_json, []),
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
	doc = frappe.get_doc("KQS Stock Import Batch", batch_name)
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
		doc.rows_json = _dumps(rows)

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

	found = False
	for row in rows:
		if row.get("row_id") != row_id:
			continue
		found = True
		row["linked_template"] = template
		row["_link_confirmed"] = 1
		row["_force_create"] = 0
		row["error"] = ""
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
	found = False
	for row in rows:
		if row.get("row_id") != row_id:
			continue
		found = True
		row["action"] = "create"
		row["_force_create"] = 1
		row["_link_confirmed"] = 0
		row["linked_template"] = ""
		row["linked_item"] = ""
		row["error"] = ""
		break
	if not found:
		frappe.throw(_("Row not found."))
	_save_batch_rows(doc, rows)
	return get_batch(batch_name)


@frappe.whitelist()
def search_catalog_matches(query: str = "", limit: int = 20):
	assert_stock_manager()
	from kqs_retail.api.product_setup import search_products_for_edit

	return search_products_for_edit(query=query, start=0, limit=limit)


@frappe.whitelist()
def commit_batch(batch_name: str, commit_valid_only: int = 1, item_group: str = ""):
	assert_stock_manager()
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
	results = {"created": [], "variants_added": [], "received": [], "skipped": [], "errors": []}

	# Apply default category to empty create rows before validation
	for row in rows:
		if default_group and not cstr(row.get("item_group") or "").strip():
			row["item_group"] = default_group

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
		if row.get("status") == "applied":
			results["skipped"].append({"row_id": row["row_id"], "reason": "already_applied"})
			continue
		action = row.get("action")
		if action == "skip":
			results["skipped"].append({"row_id": row["row_id"], "reason": "skip"})
			continue
		blockers = _row_blocking_errors(row)
		if blockers:
			if cint(commit_valid_only):
				results["skipped"].append({"row_id": row["row_id"], "reason": "; ".join(blockers)})
				continue
			results["errors"].append({"row_id": row["row_id"], "error": "; ".join(blockers)})
			continue
		if action == "create":
			key = _normalize_item_code(row.get("style_code") or "")
			create_groups.setdefault(key, []).append(row)
		else:
			ordered_actions.append(row)

	for _style_key, group in create_groups.items():
		try:
			_commit_create_group(group, warehouse, default_group, results)
			for row in group:
				row["status"] = "applied"
		except Exception as exc:
			frappe.log_error(title="KQS bulk import create", message=frappe.get_traceback())
			msg = str(exc)[:300]
			for row in group:
				row["error"] = msg
				row["status"] = "error"
				results["errors"].append({"row_id": row["row_id"], "error": msg})

	for row in ordered_actions:
		try:
			if row.get("action") == "add_variant":
				_commit_add_variant(row, warehouse, results)
			elif row.get("action") == "receive":
				_commit_receive(row, warehouse, results)
			row["status"] = "applied"
			row["error"] = ""
		except Exception as exc:
			frappe.log_error(title="KQS bulk import row", message=frappe.get_traceback())
			msg = str(exc)[:300]
			row["error"] = msg
			row["status"] = "error"
			results["errors"].append({"row_id": row["row_id"], "error": msg})

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

	doc.result_json = _dumps(results)
	doc.error_summary = "; ".join(e.get("error", "") for e in results["errors"][:5])
	_save_batch_rows(doc, rows)
	frappe.db.commit()
	return {"batch": get_batch(batch_name), "result": results}


def _commit_create_group(group: list[dict], warehouse: str, default_group: str, results: dict):
	first = group[0]
	item_name = first.get("product_name")
	style_code = first.get("style_code")
	item_group = cstr(first.get("item_group") or default_group).strip()
	if not item_group:
		frappe.throw(_("Select a category (Item Group) before creating products."))

	has_size = any(cstr(r.get("size")).strip() for r in group)
	has_color = any(cstr(r.get("color")).strip() for r in group)
	attr_names = []
	if has_size:
		attr_names.append("Size")
	if has_color:
		attr_names.append("Color")

	matrix = []
	for r in group:
		attrs = _variant_attrs_for_row(r)
		for k, v in attrs.items():
			_ensure_attribute_value(k, v)
		rate = flt(r.get("price"))
		if rate <= 0:
			frappe.throw(_("Price is required for {0} / {1}.").format(item_name, style_code))
		matrix.append(
			{
				"attributes": attrs,
				"rate": rate,
				"qty": flt(r.get("qty")),
				"barcode": cstr(r.get("barcode") or ""),
			}
		)

	has_variants = 1 if attr_names else 0
	if not has_variants:
		matrix = [
			{
				"attributes": {},
				"rate": flt(first.get("price")),
				"qty": sum(flt(r.get("qty")) for r in group),
				"barcode": cstr(first.get("barcode") or ""),
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
	for r in group:
		r["commit_result"] = out
		r["linked_template"] = out.get("template")


def _commit_add_variant(row: dict, warehouse: str, results: dict):
	template = row.get("linked_template")
	attrs = _variant_attrs_for_row(row)
	if not attrs:
		frappe.throw(_("Color or size required to add a variant."))
	for k, v in attrs.items():
		_ensure_attribute_value(k, v)
	rate = flt(row.get("price"))
	variants = [
		{
			"attributes": attrs,
			"rate": rate,
			"qty": flt(row.get("qty")),
			"barcode": cstr(row.get("barcode") or ""),
		}
	]
	out = add_variants_to_product(
		template=template,
		variants_json=_dumps(variants),
		receive_warehouse=warehouse,
	)
	results["variants_added"].append(out)
	row["commit_result"] = out


def _commit_receive(row: dict, warehouse: str, results: dict):
	item_code = row.get("linked_item") or row.get("linked_template")
	qty = flt(row.get("qty"))
	if qty <= 0:
		results["skipped"].append({"row_id": row["row_id"], "reason": "zero_qty"})
		row["commit_result"] = {"skipped": "zero_qty"}
		return
	rate = flt(row.get("price"))
	payload = [{"item_code": item_code, "qty": qty, "rate": rate}]
	out = receive_stock(warehouse=warehouse, items_json=_dumps(payload))
	results["received"].append(out)
	row["commit_result"] = out
