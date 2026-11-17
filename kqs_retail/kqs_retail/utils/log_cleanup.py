# Copyright (c) 2026, KQS
"""Purge old Error Logs and filesystem logs so the VPS disk does not fill up."""

from __future__ import annotations

import os
import time
from pathlib import Path

import frappe
from frappe.utils import add_days, now_datetime


LOG_RETENTION_DAYS = 7


def purge_old_logs(days: int | None = None) -> dict:
	"""
	Daily job: delete Error Log / Activity Log older than N days, and prune
	*.log files under the bench logs folders older than N days.
	"""
	days = int(days or LOG_RETENTION_DAYS)
	cutoff = add_days(now_datetime(), -days)
	out: dict = {"cutoff": str(cutoff), "error_log": 0, "activity_log": 0, "files": 0}

	# Desk Error Log (frappe.log_error)
	try:
		names = frappe.get_all(
			"Error Log",
			filters={"creation": ("<", cutoff)},
			pluck="name",
			limit_page_length=5000,
		)
		for name in names:
			frappe.delete_doc("Error Log", name, ignore_permissions=True, force=True)
		out["error_log"] = len(names)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "KQS purge Error Log")

	# Activity Log (optional noise)
	try:
		if frappe.db.exists("DocType", "Activity Log"):
			names = frappe.get_all(
				"Activity Log",
				filters={"creation": ("<", cutoff)},
				pluck="name",
				limit_page_length=5000,
			)
			for name in names:
				frappe.delete_doc("Activity Log", name, ignore_permissions=True, force=True)
			out["activity_log"] = len(names)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "KQS purge Activity Log")

	# Trim publish history on old import batches (keep draft rows; shrink result_json)
	try:
		out["batch_history"] = _trim_import_batch_history(cutoff)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "KQS purge import batch history")

	# Filesystem logs (bench + site)
	try:
		out["files"] = _purge_log_files(days)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "KQS purge log files")

	frappe.db.commit()
	return out


def _trim_import_batch_history(cutoff) -> int:
	"""Drop publish history entries older than cutoff from KQS Stock Import Batch.result_json."""
	if not frappe.db.exists("DocType", "KQS Stock Import Batch"):
		return 0
	import json

	trimmed = 0
	batches = frappe.get_all(
		"KQS Stock Import Batch",
		filters={"modified": (">=", add_days(cutoff, -30))},
		pluck="name",
		limit_page_length=200,
	)
	for name in batches:
		raw = frappe.db.get_value("KQS Stock Import Batch", name, "result_json") or ""
		if not raw or "history" not in raw:
			continue
		try:
			data = json.loads(raw)
		except Exception:
			continue
		history = data.get("history") or []
		if not history:
			continue
		kept = []
		for entry in history:
			at = entry.get("at") or ""
			# Keep recent entries only (string compare works for ISO-like frappe timestamps)
			if at and str(at) >= str(cutoff):
				kept.append(entry)
		if len(kept) != len(history):
			data["history"] = kept[-15:]
			frappe.db.set_value(
				"KQS Stock Import Batch",
				name,
				"result_json",
				json.dumps(data, ensure_ascii=False, default=str),
				update_modified=False,
			)
			trimmed += 1
	return trimmed


def _purge_log_files(days: int) -> int:
	"""Delete rotated / old .log files under common bench log directories."""
	cutoff_ts = time.time() - (days * 86400)
	removed = 0
	sites_path = Path(frappe.get_site_path()).resolve()
	bench_path = sites_path.parent.parent  # .../frappe-bench/sites/<site> → bench
	candidates = [
		sites_path / "logs",
		bench_path / "logs",
		bench_path / "sites" / "logs",
		Path("/home/frappe/frappe-bench/logs"),
		Path("/home/frappe/logs"),
	]
	seen: set[str] = set()
	for folder in candidates:
		try:
			folder = folder.resolve()
		except Exception:
			continue
		key = str(folder)
		if key in seen or not folder.is_dir():
			continue
		seen.add(key)
		for path in folder.rglob("*"):
			try:
				if not path.is_file():
					continue
				name = path.name.lower()
				if not (name.endswith(".log") or ".log." in name or name.endswith(".txt")):
					continue
				if name.endswith(".lock"):
					continue
				mtime = path.stat().st_mtime
				if mtime < cutoff_ts:
					path.unlink(missing_ok=True)
					removed += 1
				elif path.stat().st_size > 50 * 1024 * 1024 and name.endswith(".log"):
					with open(path, "w", encoding="utf-8"):
						pass
					removed += 1
			except Exception:
				continue
	return removed
