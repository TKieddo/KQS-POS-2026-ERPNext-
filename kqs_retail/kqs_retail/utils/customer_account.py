# Copyright (c) 2026, KQS
"""Customer AR balance, credit limit, layby totals, and sell-on-account validation."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt

from kqs_retail.utils.store_credit import (
	_get_unallocated_return_credits,
	get_customer_store_credit_balance,
	is_walk_in_customer,
)

RETURN_CREDIT_DOCTYPES = ("Sales Invoice", "POS Invoice")
ACCOUNT_SALE_MODE_CANDIDATES = ("On Account", "Account")


def _skip_consolidated_pos_merge(doc) -> bool:
	"""POS closing merge builds a consolidated Sales Invoice from already-submitted POS Invoices."""
	return doc.doctype == "Sales Invoice" and doc.get("is_consolidated")


def resolve_account_sale_mode() -> str | None:
	for name in ACCOUNT_SALE_MODE_CANDIDATES:
		if frappe.db.exists("Mode of Payment", name):
			return name
	return None


def is_account_sale_mode(mode_of_payment: str | None) -> bool:
	if not mode_of_payment:
		return False
	resolved = resolve_account_sale_mode()
	return mode_of_payment == resolved or mode_of_payment in ACCOUNT_SALE_MODE_CANDIDATES


def _sum_unpaid_sales_invoice_outstanding(customer: str, company: str) -> float:
	"""Submitted sales/POS invoices with open outstanding (excludes returns)."""
	total = 0.0
	for doctype in RETURN_CREDIT_DOCTYPES:
		total += flt(
			frappe.db.sql(
				f"""
				SELECT COALESCE(SUM(outstanding_amount), 0)
				FROM `tab{doctype}`
				WHERE customer = %s AND company = %s AND docstatus = 1
				  AND IFNULL(is_return, 0) = 0 AND outstanding_amount > 0.009
				""",
				(customer, company),
			)[0][0]
		)
	return total


def _sum_unrecorded_on_account_portions(customer: str, company: str) -> float:
	"""On Account rows on fully-paid invoices — legacy when POS outstanding was not set."""
	if not resolve_account_sale_mode():
		return 0.0
	modes = list(ACCOUNT_SALE_MODE_CANDIDATES)
	placeholders = ", ".join(["%s"] * len(modes))
	total = 0.0
	for doctype in RETURN_CREDIT_DOCTYPES:
		total += flt(
			frappe.db.sql(
				f"""
				SELECT COALESCE(SUM(pay.amount), 0)
				FROM `tabSales Invoice Payment` pay
				INNER JOIN `tab{doctype}` inv
				  ON inv.name = pay.parent AND pay.parenttype = %s
				WHERE inv.customer = %s AND inv.company = %s AND inv.docstatus = 1
				  AND IFNULL(inv.is_return, 0) = 0
				  AND IFNULL(inv.outstanding_amount, 0) <= 0.009
				  AND pay.mode_of_payment IN ({placeholders})
				""",
				(doctype, customer, company, *modes),
			)[0][0]
		)
	return total


def repair_legacy_on_account_outstanding(customer: str, company: str) -> int:
	"""Fix invoices where On Account debt was never written to outstanding_amount.

	Older on-account POS sales kept outstanding at zero while On Account payment rows
	remained. Consolidated POS invoices must update the linked Sales Invoice for
	Payment Entry allocation.
	"""
	if not customer or not company:
		return 0

	modes = [mode for mode in ACCOUNT_SALE_MODE_CANDIDATES if frappe.db.exists("Mode of Payment", mode)]
	if not modes:
		return 0

	placeholders = ", ".join(["%s"] * len(modes))
	repaired = 0
	consolidated_si_debt: dict[str, float] = {}

	for doctype in RETURN_CREDIT_DOCTYPES:
		rows = frappe.db.sql(
			f"""
			SELECT inv.name, inv.grand_total,
			       COALESCE(SUM(pay.amount), 0) AS on_account_amount
			FROM `tab{doctype}` inv
			INNER JOIN `tabSales Invoice Payment` pay
			  ON pay.parent = inv.name AND pay.parenttype = %s
			WHERE inv.customer = %s AND inv.company = %s AND inv.docstatus = 1
			  AND IFNULL(inv.is_return, 0) = 0
			  AND IFNULL(inv.outstanding_amount, 0) <= 0.009
			  AND pay.mode_of_payment IN ({placeholders})
			GROUP BY inv.name, inv.grand_total
			HAVING on_account_amount > 0.009
			""",
			(doctype, customer, company, *modes),
			as_dict=True,
		)
		for inv in rows:
			unpaid = flt(inv.on_account_amount)
			grand = flt(inv.grand_total)
			paid = max(0.0, grand - unpaid)

			if doctype == "POS Invoice":
				consolidated = frappe.db.get_value("POS Invoice", inv.name, "consolidated_invoice")
				if consolidated:
					consolidated_si_debt[consolidated] = consolidated_si_debt.get(consolidated, 0.0) + unpaid
					frappe.db.set_value(
						"POS Invoice",
						inv.name,
						{"outstanding_amount": 0, "paid_amount": paid},
						update_modified=False,
					)
				else:
					frappe.db.set_value(
						"POS Invoice",
						inv.name,
						{"outstanding_amount": unpaid, "paid_amount": paid},
						update_modified=False,
					)
			else:
				frappe.db.set_value(
					"Sales Invoice",
					inv.name,
					{"outstanding_amount": unpaid, "paid_amount": paid},
					update_modified=False,
				)

			for row in frappe.get_all(
				"Sales Invoice Payment",
				filters={
					"parent": inv.name,
					"parenttype": doctype,
					"mode_of_payment": ["in", modes],
				},
				pluck="name",
			):
				frappe.db.delete("Sales Invoice Payment", row)
			repaired += 1

	for si_name, unpaid in consolidated_si_debt.items():
		grand = flt(frappe.db.get_value("Sales Invoice", si_name, "grand_total"))
		frappe.db.set_value(
			"Sales Invoice",
			si_name,
			{
				"outstanding_amount": unpaid,
				"paid_amount": max(0.0, grand - unpaid),
			},
			update_modified=False,
		)
		repaired += 1

	# Prior repair may have set POS outstanding while consolidated SI stayed at zero.
	misaligned = frappe.db.sql(
		"""
		SELECT name, outstanding_amount, consolidated_invoice
		FROM `tabPOS Invoice`
		WHERE customer = %s AND company = %s AND docstatus = 1
		  AND IFNULL(is_return, 0) = 0
		  AND IFNULL(outstanding_amount, 0) > 0.009
		  AND IFNULL(consolidated_invoice, '') != ''
		""",
		(customer, company),
		as_dict=True,
	)
	si_adjust: dict[str, float] = {}
	for pos in misaligned:
		si_name = pos.consolidated_invoice
		si_adjust[si_name] = si_adjust.get(si_name, 0.0) + flt(pos.outstanding_amount)
		frappe.db.set_value(
			"POS Invoice",
			pos.name,
			{"outstanding_amount": 0},
			update_modified=False,
		)
	for si_name, extra in si_adjust.items():
		current = flt(frappe.db.get_value("Sales Invoice", si_name, "outstanding_amount"))
		grand = flt(frappe.db.get_value("Sales Invoice", si_name, "grand_total"))
		new_outstanding = current + extra
		frappe.db.set_value(
			"Sales Invoice",
			si_name,
			{
				"outstanding_amount": new_outstanding,
				"paid_amount": max(0.0, grand - new_outstanding),
			},
			update_modified=False,
		)
		repaired += 1

	return repaired


def get_customer_ar_outstanding(customer: str, company: str) -> float:
	"""Unpaid on-account / credit sales (POS **Owes**). Never netted with store credit."""
	if not customer or not company:
		return 0.0
	return _sum_unpaid_sales_invoice_outstanding(customer, company) + _sum_unrecorded_on_account_portions(
		customer, company
	)


def get_customer_credit_limit(customer: str, company: str) -> float:
	"""Credit limit row for company on Customer master."""
	if not customer or not company:
		return 0.0
	try:
		from erpnext.selling.doctype.customer.customer import get_credit_limit

		return flt(get_credit_limit(customer, company))
	except Exception:
		limit = frappe.db.get_value(
			"Customer Credit Limit",
			{"parent": customer, "parenttype": "Customer", "company": company},
			"credit_limit",
		)
		return flt(limit)


def customer_allows_account_sales(customer: str) -> bool:
	if not customer or is_walk_in_customer(customer):
		return False
	return bool(frappe.db.get_value("Customer", customer, "kqs_allow_account_sales"))


def get_credit_available(customer: str, company: str) -> float:
	"""Headroom for new AR before hitting credit limit. Zero if no limit set."""
	limit = get_customer_credit_limit(customer, company)
	if limit <= 0:
		return 0.0
	outstanding = get_customer_ar_outstanding(customer, company)
	return max(0.0, limit - outstanding)


def get_active_laybys_for_customer(customer: str, warehouse: str = "") -> list[dict]:
	filters: dict = {"docstatus": 1, "status": "Active", "customer": customer}
	if warehouse:
		filters["warehouse"] = warehouse
	return frappe.get_all(
		"Layby Agreement",
		filters=filters,
		fields=[
			"name",
			"customer",
			"customer_name",
			"warehouse",
			"total_amount",
			"paid_amount",
			"balance_amount",
			"status",
			"due_date",
		],
		order_by="modified desc",
		limit_page_length=50,
	)


def get_layby_balance_total(customer: str, warehouse: str = "") -> float:
	laybys = get_active_laybys_for_customer(customer, warehouse)
	return sum(flt(row.get("balance_amount")) for row in laybys)


def get_customer_loyalty_summary(customer: str, company: str) -> dict:
	"""Active loyalty points for customer (ERPNext Loyalty Program, company-scoped)."""
	empty = {
		"loyalty_points": 0.0,
		"loyalty_program": "",
		"loyalty_amount": 0.0,
		"conversion_factor": 0.0,
	}
	if not customer or not company or is_walk_in_customer(customer):
		return empty

	loyalty_program = frappe.db.get_value("Customer", customer, "loyalty_program")
	if not loyalty_program:
		return empty

	program_company = frappe.db.get_value("Loyalty Program", loyalty_program, "company")
	if program_company and program_company != company:
		return {**empty, "loyalty_program": loyalty_program}

	try:
		from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
			get_loyalty_program_details_with_points,
		)

		details = get_loyalty_program_details_with_points(
			customer,
			loyalty_program,
			company=company,
			silent=True,
		)
		points = flt(details.get("loyalty_points"))
		conversion = flt(details.get("conversion_factor"))
		return {
			"loyalty_points": points,
			"loyalty_program": loyalty_program,
			"loyalty_amount": points * conversion if conversion else 0.0,
			"conversion_factor": conversion,
		}
	except Exception:
		frappe.log_error(message=frappe.get_traceback(), title="KQS customer loyalty summary")
		return {**empty, "loyalty_program": loyalty_program}


def build_customer_account_summary(
	customer: str,
	company: str,
	warehouse: str = "",
	include_credit_notes: bool = False,
) -> dict:
	walk_in = is_walk_in_customer(customer)
	if not walk_in and customer and company:
		repair_legacy_on_account_outstanding(customer, company)
	credit_limit = 0.0 if walk_in else get_customer_credit_limit(customer, company)
	ar_outstanding = 0.0 if walk_in else get_customer_ar_outstanding(customer, company)
	store_credit = 0.0 if walk_in else get_customer_store_credit_balance(customer, company)
	laybys = [] if walk_in else get_active_laybys_for_customer(customer, warehouse)
	layby_total = sum(flt(row.get("balance_amount")) for row in laybys)
	loyalty = (
		{
			"loyalty_points": 0.0,
			"loyalty_program": "",
			"loyalty_amount": 0.0,
			"conversion_factor": 0.0,
		}
		if walk_in
		else get_customer_loyalty_summary(customer, company)
	)

	summary = {
		"customer": customer,
		"company": company,
		"walk_in": walk_in,
		"ar_outstanding": ar_outstanding,
		"credit_limit": credit_limit,
		"credit_available": max(0.0, credit_limit - ar_outstanding) if credit_limit > 0 else 0.0,
		"allow_account_sales": customer_allows_account_sales(customer),
		"account_sale_mode": resolve_account_sale_mode(),
		"store_credit_balance": store_credit,
		"active_laybys": laybys,
		"layby_count": len(laybys),
		"layby_balance_total": layby_total,
		"loyalty_points": loyalty["loyalty_points"],
		"loyalty_program": loyalty["loyalty_program"],
		"loyalty_amount": loyalty["loyalty_amount"],
		"loyalty_conversion_factor": loyalty["conversion_factor"],
	}
	if include_credit_notes and not walk_in:
		summary["store_credit_notes"] = _get_unallocated_return_credits(customer, company)
	return summary


def _invoice_grand_total(doc) -> float:
	return flt(doc.rounded_total or doc.grand_total)


def get_account_sale_payment_amount(doc) -> float:
	"""Explicit On Account payment row amount (debt portion of this sale)."""
	total = 0.0
	for row in doc.get("payments") or []:
		if is_account_sale_mode(row.mode_of_payment):
			total += flt(row.amount)
	return total


def _invoice_real_money_paid(doc) -> float:
	"""Cash/card/mobile — excludes store credit and On Account rows."""
	from kqs_retail.utils.store_credit import is_store_credit_mode

	total = 0.0
	for row in doc.get("payments") or []:
		if is_store_credit_mode(row.mode_of_payment) or is_account_sale_mode(row.mode_of_payment):
			continue
		total += flt(row.amount)
	return total


def _invoice_allocated_total(doc) -> float:
	from kqs_retail.utils.store_credit import get_store_credit_payment_amount

	return _invoice_real_money_paid(doc) + get_store_credit_payment_amount(doc) + get_account_sale_payment_amount(
		doc
	)


def validate_pos_payment_totals_before_submit(doc, method=None) -> None:
	"""Cashier must allocate the full sale across payment modes before submit."""
	if doc.is_return or not doc.get("is_pos"):
		return
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	# POS closing merges already-submitted POS Invoices; do not re-check payment splits.
	if _skip_consolidated_pos_merge(doc):
		return

	grand = _invoice_grand_total(doc)
	allocated = _invoice_allocated_total(doc)
	if allocated <= 0.009:
		frappe.throw(_("Enter payment amounts before completing the order."))

	diff = grand - allocated
	if abs(diff) <= 0.02:
		return

	if allocated > grand + 0.02:
		frappe.throw(
			_("Payments total {0} exceeds sale total {1}. Adjust the amounts entered.").format(
				frappe.format(allocated, {"fieldtype": "Currency"}),
				frappe.format(grand, {"fieldtype": "Currency"}),
			)
		)

	shortfall = max(0.0, diff)
	account = get_account_sale_payment_amount(doc)
	if account <= 0.009:
		frappe.throw(
			_("Payments are short by {0}. Collect more or allocate the balance to On Account.").format(
				frappe.format(shortfall, {"fieldtype": "Currency"})
			)
		)
	frappe.throw(
		_("Payments total {0} does not match sale total {1}.").format(
			frappe.format(allocated, {"fieldtype": "Currency"}),
			frappe.format(grand, {"fieldtype": "Currency"}),
		)
	)


def prepare_account_sale_before_submit(doc, method=None) -> None:
	"""Strip On Account rows so invoice outstanding equals the debt portion."""
	if doc.is_return or not doc.get("is_pos"):
		return
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	if _skip_consolidated_pos_merge(doc):
		return
	if is_walk_in_customer(doc.customer):
		return

	account = get_account_sale_payment_amount(doc)
	if account <= 0:
		return

	doc._kqs_account_sale_unpaid = account
	kept = [row for row in doc.get("payments") or [] if not is_account_sale_mode(row.mode_of_payment)]
	doc.set("payments", kept)
	if hasattr(doc, "set_paid_amount"):
		doc.set_paid_amount()
	# POS Invoice.before_submit runs before hooks and zeros outstanding when On Account is in payments.
	if hasattr(doc, "set_outstanding_amount"):
		doc.set_outstanding_amount()


def finalize_account_sale_on_submit(doc, method=None) -> None:
	"""Persist on-account debt on the invoice after submit (POS hook-order safety net)."""
	if doc.is_return or not doc.get("is_pos"):
		return
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return
	if _skip_consolidated_pos_merge(doc):
		return
	if is_walk_in_customer(doc.customer):
		return

	unpaid = flt(getattr(doc, "_kqs_account_sale_unpaid", 0))
	if unpaid <= 0.009:
		return

	grand = _invoice_grand_total(doc)
	paid = grand - unpaid
	frappe.db.set_value(
		doc.doctype,
		doc.name,
		{
			"outstanding_amount": unpaid,
			"paid_amount": paid,
			"kqs_on_account_unpaid": unpaid,
			"status": "Unpaid",
		},
		update_modified=False,
	)
	for row in list(doc.get("payments") or []):
		if is_account_sale_mode(row.mode_of_payment):
			frappe.db.delete("Sales Invoice Payment", row.name)


def get_on_account_unpaid(doctype: str, name: str) -> float:
	"""On-account portion stored on the invoice, or inferred for legacy rows."""
	if doctype not in RETURN_CREDIT_DOCTYPES or not name:
		return 0.0
	stored = flt(frappe.db.get_value(doctype, name, "kqs_on_account_unpaid"))
	if stored > 0:
		return stored
	return infer_on_account_unpaid(doctype, name)


def infer_on_account_unpaid(doctype: str, name: str) -> float:
	"""Legacy rows: outstanding with payment rows stripped after On Account submit."""
	if doctype not in RETURN_CREDIT_DOCTYPES or not name:
		return 0.0
	row = frappe.db.get_value(
		doctype,
		name,
		["is_return", "grand_total", "outstanding_amount", "paid_amount"],
		as_dict=True,
	)
	if not row or row.is_return:
		return 0.0
	outstanding = flt(row.outstanding_amount)
	if outstanding <= 0.009:
		return 0.0
	payment_total = flt(
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(amount), 0)
			FROM `tabSales Invoice Payment`
			WHERE parenttype = %s AND parent = %s
			""",
			(doctype, name),
		)[0][0]
	)
	if payment_total > 0.009:
		return 0.0
	return min(outstanding, abs(flt(row.grand_total)))


def is_on_account_pos_invoice(doctype: str, name: str) -> bool:
	return get_on_account_unpaid(doctype, name) > 0.009


def settle_on_account_original_on_return(doc, method=None) -> None:
	"""Clear on-account debt on the original sale when a return is submitted."""
	if not doc.is_return or not doc.return_against:
		return
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return

	original_name = doc.return_against
	doctype = doc.doctype
	on_account = get_on_account_unpaid(doctype, original_name)
	if on_account <= 0.009:
		return

	return_amount = abs(flt(doc.grand_total))
	if return_amount <= 0.009:
		return

	original = frappe.db.get_value(
		doctype,
		original_name,
		["grand_total", "outstanding_amount", "kqs_on_account_unpaid"],
		as_dict=True,
	)
	if not original:
		return

	original_grand = abs(flt(original.grand_total))
	settle = min(return_amount, on_account, original_grand, flt(original.outstanding_amount))
	if settle <= 0.009:
		return

	remaining_on_account = max(0.0, on_account - settle)
	remaining_outstanding = max(0.0, flt(original.outstanding_amount) - settle)
	paid = max(0.0, original_grand - remaining_outstanding)
	status = "Paid" if remaining_outstanding <= 0.009 else "Unpaid"

	frappe.db.set_value(
		doctype,
		original_name,
		{
			"kqs_on_account_unpaid": remaining_on_account,
			"outstanding_amount": remaining_outstanding,
			"paid_amount": paid,
			"status": status,
		},
		update_modified=False,
	)
	if remaining_outstanding <= 0.009:
		sync_paid_payment_row_for_merge(doctype, original_name)


def _default_cash_mode_and_account(company: str) -> tuple[str | None, str | None]:
	mode = "Cash" if frappe.db.exists("Mode of Payment", "Cash") else None
	if not mode:
		return None, None
	account = frappe.db.get_value(
		"Mode of Payment Account",
		{"parent": mode, "company": company},
		"default_account",
	)
	return mode, account


def sync_paid_payment_row_for_merge(doctype: str, name: str) -> None:
	"""POS closing merge totals payment child rows — align when invoice is fully paid."""
	if doctype not in RETURN_CREDIT_DOCTYPES or not name:
		return
	row = frappe.db.get_value(
		doctype,
		name,
		["grand_total", "paid_amount", "outstanding_amount", "company", "docstatus", "is_return", "is_pos"],
		as_dict=True,
	)
	if not row or row.docstatus != 1 or row.is_return:
		return
	if doctype == "Sales Invoice" and not row.get("is_pos"):
		return
	if flt(row.outstanding_amount) > 0.009:
		return

	target = flt(row.paid_amount) or abs(flt(row.grand_total))
	if target <= 0.009:
		return

	existing = flt(
		frappe.db.sql(
			"""
			SELECT COALESCE(SUM(amount), 0)
			FROM `tabSales Invoice Payment`
			WHERE parenttype = %s AND parent = %s
			""",
			(doctype, name),
		)[0][0]
	)
	if existing + 0.02 >= target:
		return

	mode, account = _default_cash_mode_and_account(row.company)
	if not mode or not account:
		return

	frappe.get_doc(
		{
			"doctype": "Sales Invoice Payment",
			"parenttype": doctype,
			"parentfield": "payments",
			"parent": name,
			"mode_of_payment": mode,
			"amount": target - existing,
			"base_amount": target - existing,
			"account": account,
			"type": "Cash",
		}
	).insert(ignore_permissions=True)


def repair_paid_invoices_missing_payment_rows(doctype: str = "POS Invoice") -> list[str]:
	"""Legacy paid POS invoices with no payment rows break closing merge."""
	repaired: list[str] = []
	filters = {"docstatus": 1, "is_return": 0, "outstanding_amount": ["<=", 0.009]}
	if doctype == "Sales Invoice":
		filters["is_pos"] = 1
	rows = frappe.get_all(doctype, filters=filters, pluck="name")
	for name in rows:
		before = flt(
			frappe.db.sql(
				"SELECT COALESCE(SUM(amount),0) FROM `tabSales Invoice Payment` WHERE parenttype=%s AND parent=%s",
				(doctype, name),
			)[0][0]
		)
		sync_paid_payment_row_for_merge(doctype, name)
		after = flt(
			frappe.db.sql(
				"SELECT COALESCE(SUM(amount),0) FROM `tabSales Invoice Payment` WHERE parenttype=%s AND parent=%s",
				(doctype, name),
			)[0][0]
		)
		if after > before + 0.009:
			repaired.append(name)
	return repaired


def repair_on_account_return_pairs(doctype: str = "POS Invoice") -> list[str]:
	"""One-time repair: originals still showing on-account debt after a full return."""
	fixed: list[str] = []
	returns = frappe.get_all(
		doctype,
		filters={"docstatus": 1, "is_return": 1, "return_against": ["is", "set"]},
		fields=["name", "return_against", "grand_total"],
	)
	for ret in returns:
		orig_name = ret.return_against
		if not orig_name or not frappe.db.exists(doctype, orig_name):
			continue
		outstanding = flt(frappe.db.get_value(doctype, orig_name, "outstanding_amount"))
		if outstanding <= 0.009:
			continue
		on_account = get_on_account_unpaid(doctype, orig_name)
		if on_account <= 0.009:
			on_account = outstanding
		orig_grand = abs(flt(frappe.db.get_value(doctype, orig_name, "grand_total")))
		return_amount = abs(flt(ret.grand_total))
		if return_amount + 0.02 < min(on_account, orig_grand):
			continue
		settle_on_account_original_on_return(
			frappe.get_doc(doctype, ret.name),
		)
		fixed.append(orig_name)
	return list(dict.fromkeys(fixed))


def account_sale_unpaid_amount(doc) -> float:
	"""Debt portion — only from explicit On Account payment rows."""
	if doc.is_return or not doc.get("is_pos"):
		return 0.0
	if doc.doctype not in RETURN_CREDIT_DOCTYPES:
		return 0.0
	if is_walk_in_customer(doc.customer):
		return 0.0

	stored = flt(getattr(doc, "_kqs_account_sale_unpaid", 0))
	if stored > 0:
		return stored
	return get_account_sale_payment_amount(doc)


def validate_account_sale_before_submit(doc, method=None) -> None:
	"""Allow POS debt only when cashier used On Account payment mode."""
	if _skip_consolidated_pos_merge(doc):
		return
	unpaid = account_sale_unpaid_amount(doc)
	if unpaid <= 0.009:
		return

	if is_walk_in_customer(doc.customer):
		frappe.throw(_("Select a named customer to use On Account."))

	if not customer_allows_account_sales(doc.customer):
		frappe.throw(
			_("Customer {0} is not approved for On Account sales. Enable Allow Account Sales on the Customer.").format(
				doc.customer
			)
		)

	limit = get_customer_credit_limit(doc.customer, doc.company)
	if limit <= 0:
		frappe.throw(
			_("Set a Credit Limit on customer {0} before selling on account.").format(doc.customer)
		)

	current_ar = get_customer_ar_outstanding(doc.customer, doc.company)
	if current_ar + unpaid > limit + 0.01:
		frappe.throw(
			_("Credit limit exceeded for {0}. Owed: {1}, this sale unpaid: {2}, limit: {3}.").format(
				doc.customer,
				frappe.format(current_ar, {"fieldtype": "Currency"}),
				frappe.format(unpaid, {"fieldtype": "Currency"}),
				frappe.format(limit, {"fieldtype": "Currency"}),
			)
		)

	doc._kqs_account_sale_unpaid = unpaid


def check_account_sale_allowed(customer: str, company: str, unpaid_amount: float) -> dict:
	"""POS pre-check before checkout with partial payment."""
	unpaid_amount = flt(unpaid_amount)
	if unpaid_amount <= 0:
		return {"allowed": True, "reason": ""}

	if is_walk_in_customer(customer):
		return {"allowed": False, "reason": _("Named customer required for account sales.")}

	if not customer_allows_account_sales(customer):
		return {
			"allowed": False,
			"reason": _(
				"Full payment is required. This customer is not approved to buy on account."
			),
		}

	limit = get_customer_credit_limit(customer, company)
	if limit <= 0:
		return {
			"allowed": False,
			"reason": _("No credit limit set for this customer."),
		}

	current_ar = get_customer_ar_outstanding(customer, company)
	if current_ar + unpaid_amount > limit + 0.01:
		return {
			"allowed": False,
			"reason": _("Credit limit would be exceeded."),
			"ar_outstanding": current_ar,
			"credit_limit": limit,
			"unpaid_amount": unpaid_amount,
		}

	return {
		"allowed": True,
		"ar_outstanding": current_ar,
		"credit_limit": limit,
		"credit_available": max(0.0, limit - current_ar),
		"unpaid_amount": unpaid_amount,
		"ar_after_sale": current_ar + unpaid_amount,
	}
