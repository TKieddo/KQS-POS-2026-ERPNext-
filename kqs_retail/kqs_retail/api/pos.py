# Copyright (c) 2026, KQS

"""Point of Sale extensions — enrich ERPNext POS item payloads."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cstr, flt, get_datetime, getdate

from kqs_retail.utils.items import attach_variant_attributes_to_pos_items

# Widen fetch when multi-word search needs more candidates to re-rank.
_WIDEN_PAGE_LENGTH = 100
_WEAK_HIT_THRESHOLD = 150


@frappe.whitelist()
def get_items(start, page_length, price_list, item_group, pos_profile, search_term=""):
	"""Wrap ERPNext POS get_items — ranking + variant badges + sellable qty."""
	from erpnext.selling.page.point_of_sale.point_of_sale import get_items as erpnext_get_items

	start = int(start or 0)
	page_length = max(1, min(int(page_length or 40), 100))
	term = cstr(search_term or "").strip()
	tokens = _tokenize(term)

	result = erpnext_get_items(
		start, page_length, price_list, item_group, pos_profile, search_term
	)
	if not isinstance(result, dict):
		result = {"items": result or []}

	attach_variant_attributes_to_pos_items(result)
	items = list(result.get("items") or [])

	# Multi-token: ERPNext uses one contiguous LIKE — widen on first token then re-rank.
	if len(tokens) >= 2 and start == 0:
		best = max((_score_item(it, tokens) for it in items), default=0)
		if len(items) < page_length or best < _WEAK_HIT_THRESHOLD:
			wide = erpnext_get_items(
				0,
				_WIDEN_PAGE_LENGTH,
				price_list,
				item_group,
				pos_profile,
				tokens[0],
			)
			if isinstance(wide, dict):
				attach_variant_attributes_to_pos_items(wide)
				items = _merge_items_by_code(items, wide.get("items") or [])

	if tokens and items:
		items.sort(
			key=lambda it: (-_score_item(it, tokens), cstr(it.get("item_name") or ""))
		)
		# Only re-slice when we ranked a fresh first page (not infinite scroll).
		if start == 0:
			items = items[:page_length]

	result["items"] = items
	_apply_sellable_qty_to_pos_items(result, pos_profile)
	return result


def _tokenize(term: str) -> list[str]:
	return [t.lower() for t in cstr(term or "").split() if t.strip()]


def _merge_items_by_code(primary: list, extra: list) -> list:
	seen: set[str] = set()
	out: list = []
	for item in list(primary or []) + list(extra or []):
		code = cstr(item.get("item_code") or "")
		if not code or code in seen:
			continue
		seen.add(code)
		out.append(item)
	return out


def _attr_blob(item: dict) -> str:
	parts = []
	for row in item.get("variant_attributes") or []:
		if isinstance(row, dict):
			parts.append(cstr(row.get("value") or "").lower())
		else:
			parts.append(cstr(row).lower())
	return " ".join(parts)


def _score_item(item: dict, tokens: list[str]) -> float:
	"""Higher = better match. Exact/prefix style/code beat loose name contains."""
	if not tokens:
		return 0.0

	code = cstr(item.get("item_code") or "").lower()
	name = cstr(item.get("item_name") or "").lower()
	style = cstr(item.get("style_code") or item.get("variant_of") or "").lower()
	attrs = _attr_blob(item)

	score = 0.0
	matched = 0
	for t in tokens:
		hit = False
		if code == t or style == t:
			score += 1000
			hit = True
		elif code.startswith(t) or style.startswith(t):
			score += 500
			hit = True
		elif name.startswith(t):
			score += 200
			hit = True
		elif t in code or t in style:
			score += 150
			hit = True
		elif t in attrs:
			score += 120
			hit = True
		elif t in name:
			score += 80
			hit = True
		if hit:
			matched += 1

	if matched == len(tokens):
		score += 300
	elif matched:
		score += matched * 10
	else:
		score -= 50
	return score


def _apply_sellable_qty_to_pos_items(result, pos_profile: str) -> None:
	"""Replace displayed stock with sellable qty at the POS warehouse (batched Bin)."""
	if not result or not isinstance(result, dict):
		return
	items = result.get("items") or []
	if not items or not pos_profile:
		return
	warehouse = frappe.db.get_value("POS Profile", pos_profile, "warehouse")
	if not warehouse:
		return

	from kqs_retail.kqs_layby.stock_reservation import get_reserved_qty_map

	codes = [item.get("item_code") for item in items if item.get("item_code")]
	if not codes:
		return
	reserved = get_reserved_qty_map(warehouse)

	on_hand_from_payload: dict[str, float] = {}
	missing: list[str] = []
	for item in items:
		code = item.get("item_code")
		if not code:
			continue
		on_hand = None
		for key in ("actual_qty", "stock_qty"):
			if key in item and item.get(key) is not None:
				try:
					on_hand = float(item.get(key))
					break
				except (TypeError, ValueError):
					pass
		if on_hand is None:
			missing.append(code)
		else:
			on_hand_from_payload[code] = on_hand

	bin_map: dict[str, float] = {}
	if missing:
		unique_missing = list(dict.fromkeys(missing))
		for row in frappe.db.get_all(
			"Bin",
			filters={"warehouse": warehouse, "item_code": ["in", unique_missing]},
			fields=["item_code", "actual_qty"],
		):
			bin_map[row.item_code] = flt(row.actual_qty)

	for item in items:
		code = item.get("item_code")
		if not code:
			continue
		if code in on_hand_from_payload:
			on_hand = on_hand_from_payload[code]
		else:
			on_hand = bin_map.get(code, 0.0)
		sellable = max(on_hand - float(reserved.get(code, 0) or 0), 0)
		item["actual_qty"] = sellable
		if "stock_qty" in item:
			item["stock_qty"] = sellable


@frappe.whitelist()
def get_kqs_retail_settings():
	"""Return layby/POS policy for client refresh without full reload."""
	from kqs_retail.kqs_layby.settings import get_kqs_retail_settings_for_boot

	return get_kqs_retail_settings_for_boot()


@frappe.whitelist()
def check_opening_entry(user: str | None = None) -> list[dict]:
	"""Open tills for this cashier — match by status=Open (not empty closing link).

	ERPNext's stock filter on empty ``pos_closing_entry`` can miss valid Open
	entries, which wrongly shows the Create Opening dialog after a browser reload
	or when the same cashier signs in on a second phone/tablet.
	"""
	user = frappe.session.user
	rows = frappe.db.get_all(
		"POS Opening Entry",
		filters={"user": user, "status": "Open", "docstatus": 1},
		fields=["name", "company", "pos_profile", "period_start_date", "user"],
		order_by="period_start_date desc",
	)
	if rows:
		return rows
	# Fallback: same buggy ERPNext filter some sites still rely on, then keep only Open.
	legacy = frappe.db.get_all(
		"POS Opening Entry",
		filters={"user": user, "pos_closing_entry": ["in", ["", None]], "docstatus": 1},
		fields=["name", "company", "pos_profile", "period_start_date", "status", "user"],
		order_by="period_start_date desc",
	)
	return [r for r in legacy if (r.get("status") or "Open") == "Open"]


def _opening_is_outdated(period_start_date) -> bool:
	if not period_start_date:
		return False
	return get_datetime(period_start_date).date() < getdate()


def _opening_payload(row) -> dict:
	return {
		"name": row.get("name"),
		"company": row.get("company"),
		"pos_profile": row.get("pos_profile"),
		"period_start_date": row.get("period_start_date"),
		"user": row.get("user"),
	}


def _pos_profile_names_for_user(user: str) -> list[str] | None:
	"""None = all enabled profiles; a list restricts to those names (possibly empty)."""
	from kqs_retail.utils.cashier_security import (
		can_choose_pos_branch,
		get_cashier_pos_profiles,
	)

	if can_choose_pos_branch(user):
		return None
	assigned = list(dict.fromkeys(get_cashier_pos_profiles(user)))
	if assigned:
		return assigned
	via_profile = list(
		dict.fromkeys(
			frappe.get_all(
				"POS Profile User",
				filters={"user": user},
				pluck="parent",
			)
		)
	)
	return via_profile


def _pos_branches_for_user(user: str) -> list[dict]:
	names = _pos_profile_names_for_user(user)
	filters: dict = {"disabled": 0}
	if names is not None:
		if not names:
			return []
		filters["name"] = ["in", names]

	profiles = frappe.get_all(
		"POS Profile",
		filters=filters,
		fields=["name", "warehouse", "company"],
		order_by="name asc",
		limit_page_length=100,
	)
	openings = frappe.get_all(
		"POS Opening Entry",
		filters={"status": "Open", "docstatus": 1},
		fields=["name", "company", "pos_profile", "period_start_date", "user"],
		order_by="period_start_date desc",
		limit_page_length=100,
	)
	open_map: dict[str, dict] = {}
	for row in openings:
		profile = row.get("pos_profile")
		if not profile or profile in open_map:
			continue
		payload = _opening_payload(row)
		payload["outdated"] = _opening_is_outdated(row.get("period_start_date"))
		open_map[profile] = payload

	return [
		{
			"pos_profile": p.name,
			"warehouse": p.warehouse,
			"company": p.company,
			"opening": open_map.get(p.name),
		}
		for p in profiles
	]


@frappe.whitelist()
def resolve_pos_opening_entry(user: str | None = None, pos_profile: str | None = None) -> dict:
	"""Decide whether to resume, pick a branch, cash up, or create a new opening."""
	from kqs_retail.utils.cashier_security import can_choose_pos_branch
	from kqs_retail.utils.manager_access import is_stock_manager

	user = frappe.session.user
	can_pick = can_choose_pos_branch(user)
	can_close = bool(is_stock_manager())
	preferred = (pos_profile or "").strip()

	rows = check_opening_entry()
	if rows:
		opening = _opening_payload(rows[0])
		if _opening_is_outdated(opening.get("period_start_date")):
			return {"action": "close", "opening": opening, "can_close": can_close}
		return {"action": "resume", "opening": opening, "can_join": can_pick, "can_close": can_close}

	branches = _pos_branches_for_user(user)
	branch_by_profile = {row["pos_profile"]: row for row in branches}

	if preferred and preferred in branch_by_profile:
		chosen = branch_by_profile[preferred]
		opening = chosen.get("opening")
		if opening:
			if opening.get("outdated"):
				return {"action": "close", "opening": opening, "can_close": can_close}
			joined = opening.get("user") and opening.get("user") != user
			return {
				"action": "resume",
				"opening": opening,
				"joined": joined,
				"can_join": can_pick,
				"can_close": can_close,
			}
		return {
			"action": "create",
			"opening": None,
			"default_pos_profile": preferred,
			"branches": branches,
			"can_join": can_pick,
			"can_close": can_close,
		}

	# Single assigned till (typical cashier): keep the short path.
	if len(branches) == 1 and not can_pick:
		only = branches[0]
		opening = only.get("opening")
		if opening:
			if opening.get("outdated"):
				return {"action": "close", "opening": opening, "can_close": can_close}
			return {
				"action": "blocked",
				"opening": opening,
				"outdated": False,
				"can_close": can_close,
				"can_join": False,
			}
		return {
			"action": "create",
			"opening": None,
			"default_pos_profile": only["pos_profile"],
			"branches": branches,
			"can_join": False,
			"can_close": can_close,
		}

	if can_pick or len(branches) > 1:
		return {
			"action": "pick",
			"opening": None,
			"branches": branches,
			"can_join": can_pick,
			"can_close": can_close,
			"default_pos_profile": None,
		}

	return {
		"action": "create",
		"opening": None,
		"default_pos_profile": None,
		"branches": branches,
		"can_join": False,
		"can_close": can_close,
	}


TILL_OPEN_REASONS = {
	"change": "Check change",
	"withdraw": "Withdraw to buy something",
	"count": "Count cash",
	"other": "Other",
}


@frappe.whitelist()
def log_till_open(reason: str, notes: str = "") -> dict:
	"""Record a no-sale till open (drawer kick) on the cashier's open session."""
	reason_key = (reason or "").strip().lower()
	label = TILL_OPEN_REASONS.get(reason_key)
	if not label:
		frappe.throw(_("Select a reason to open the till."))

	notes = (notes or "").strip()
	if len(notes) > 240:
		frappe.throw(_("Notes must be 240 characters or less."))
	if reason_key == "other" and not notes:
		frappe.throw(_("Add a short note for Other."))

	rows = check_opening_entry()
	if not rows:
		frappe.throw(_("Open a till session first."))

	opening = rows[0]
	detail = f"{label}."
	if notes:
		detail = f"{label} — {notes}"

	frappe.get_doc(
		{
			"doctype": "Comment",
			"comment_type": "Info",
			"reference_doctype": "POS Opening Entry",
			"reference_name": opening["name"],
			"content": f"Till opened (no sale): {detail}",
		}
	).insert(ignore_permissions=True)

	return {
		"ok": True,
		"reason": reason_key,
		"label": label,
		"opening": opening["name"],
		"pos_profile": opening.get("pos_profile") or "",
	}
