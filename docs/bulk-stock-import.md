# Bulk Stock Import (CSV + Paper AI)

Manager page: `/app/bulk-stock-import`

Import many products from a **CSV** or a **photo** of a handwritten stock list. Work stays in a **draft** (auto-saved). Nothing is written to live stock until you **Approve & publish**.

## Where to add AI API keys (KQS Retail Settings)

1. Desk Awesome Bar → search **KQS Retail Settings**, **or**
2. **KQS Retail** workspace → **KQS Retail Settings** shortcut, **or**
3. From Bulk Stock Import menu → **KQS Retail Settings**, **or**
4. Direct: `/app/kqs-retail-settings`

Scroll to section **Bulk Import AI (Paper Scan)** (below Silent Printing). If you do not see it, run locally:

```bash
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend execute kqs_retail.setup.kqs_retail_settings.ensure_kqs_retail_settings
docker compose -f docker/compose.dev.yml exec backend \
  bench --site frontend clear-cache
```

Then hard-refresh the settings form (Ctrl+Shift+R).

Fields:

| Field | Notes |
|-------|--------|
| AI Provider | `openai`, `deepseek`, or `qwen` |
| AI API Key | Provider secret |
| AI Base URL | Optional override |
| AI Model | Optional (e.g. `gpt-4o`, `qwen-vl-max`) |

Without a key, **CSV still works**; paper extract stays disabled.

## CSV template (format for old-system migration)

On Bulk Stock Import:

- **Download CSV template** — headers + sample rows  
- **Blank template** — headers only  
- Menu → **Export this draft as CSV** — current preview in the same format  

Columns (what ERPNext/KQS expects):

```text
name,style,size,color,qty,price,barcode,category
```

| Column | Maps to |
|--------|---------|
| name | Item name (e.g. Sportbag, Soviet) |
| style | Style / SKU / template code (e.g. Boca L) |
| size | Optional Size attribute |
| color | Color attribute |
| qty | Prefer a plain number (`3`, `2`). Paper habits like `x3` / `1box` are also accepted and parsed to a number |
| price | Required to **create** new styles |
| barcode | Optional |
| category | Item Group leaf (or use Default category on the page) |

The downloaded sample template uses **integer qty** (`3`, not `x3`). `x3` only appears when someone typed that on paper / in a hand-made CSV — import still turns it into quantity `3`. Stock in ERPNext is always a number.

**Moving a whole old catalogue:** export from the old system → paste/map into this template → Parse CSV into draft → review matches → Approve & publish in batches if needed.

## Drafts (survive reload)

- Parsing CSV or AI extract **creates a draft** (`KQS Stock Import Batch`).
- Edits **auto-save** every few seconds; **Save draft now** forces a save.
- Top of the page lists **Open drafts** → **Continue** after a browser reload.
- **Approve & publish** moves valid rows live (create / add variant / receive). Unresolved **Needs match** rows stay in the draft.

## Paper columns

| Column | Meaning | Example |
|--------|---------|---------|
| Name | Product line → Item name | Soviet, Sportbag |
| Style | Style number → template SKU | Boca L, Y Superboss |
| Color | Variant | blackmono, Navy |
| Qty | Quantity | `3`, or paper notes `x3` / `1box` (parsed to a number) |

Ditto (`"` / `" "`) copies Name and/or Style from the row above.

## Matching rules

- **Auto-link** only when **both** name and style match an existing template.
- Typos → **Needs match** — Accept, Search, or Create as new.
- Never silently overwrite catalog names.

## AI categories + spelling (preview)

After CSV parse or photo extract, the draft is enriched against your **live** data:

- **Categories** — AI / matcher only picks from existing leaf **Item Groups** (same list as Add Product). Empty rows get a best-guess category when confidence is high; chips show other candidates. Staff can change the dropdown anytime before Approve.
- **Spelling** — When AI is configured, it reviews names intelligently: fixes clear descriptive typos (`penthy` → `Panty`, `snicker` → `Sneaker`) but **leaves unusual / non-English brand names alone** (Love Rose, Skaloni, etc.). A small script lexicon is only a fallback if AI is off. Staff always choose **Use “…”** or **Keep spelling** — nothing is overwritten automatically.

Paper labels like **Soviet / Sidebag / Sportbag** are **product names**, not Item Groups — we never invent new groups from handwriting.

- **Default category** on the page only fills **empty** rows (button: Fill empty categories from default).
- CSV column `category` maps to the per-row field when provided.

## Deploy note (Page not found)

If `/app/bulk-stock-import` says **Not found**, the Page is not in the site DB yet. After copying the app:

```bash
bench --site YOUR_SITE migrate
bench --site YOUR_SITE clear-cache
bench build --app kqs_retail
bench restart
```

Or force-sync just this page:

```bash
bench --site YOUR_SITE execute kqs_retail.setup.bulk_import_page.ensure_bulk_import_page
bench --site YOUR_SITE clear-cache
```

Then open from **Add Product** (big blue **Bulk Stock Import** button at the top), Stock sidebar, or KQS Retail workspace.

