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
| AI Provider | `openai`, `deepseek`, or `qwen` — switch anytime |
| OpenAI / DeepSeek / Qwen API Key | **Separate saved keys** — switching provider does not erase the others |
| Legacy AI API Key | Fallback only if the active provider’s key is empty |
| AI Base URL | Optional override (leave blank for defaults) |
| AI Model | Optional override for the **active** provider. Leave blank for defaults: `gpt-4o` / `deepseek-flash` / `qwen-vl-max` |

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

## Other POS → KQS (cheat-sheet)

Use this when exporting from another till system (e.g. **ROBOTILL**) into Bulk Stock Import.

### How KQS stores products

| Case | CSV rows | size / color | Result after Approve |
|------|----------|--------------|----------------------|
| Variant product (sizes/colours) | **One row per combination** | Fill size and/or color | One template (`style`) + sellable variant SKUs |
| No variants (plain product) | **One row** | Leave **both blank** | One standalone sellable SKU |
| Same style, more stock later | Rows with existing style | Match existing size/color | **Add stock** (receive), not a duplicate product |

`style` is the product identity. Same style → same product. Different size/colour under that style → variants. `price` is required to **create** a new style. `qty` must be a number. `category` must be an existing leaf Item Group (or set **Default category** on the Bulk Import page).

### Typical column mapping

| Other POS (ROBOTILL-style) | KQS column |
|----------------------------|------------|
| Description / Product name / Item name | `name` |
| SKU / Style / Article / Product code | `style` |
| Size | `size` (blank if none) |
| Colour / Color | `color` (blank if none) |
| On hand / Qty / Stock | `qty` |
| Retail / Selling price / Price | `price` |
| Barcode / EAN / PLU | `barcode` |
| Category / Department / Group | `category` |

If ROBOTILL exports one row per barcode/size already, map 1:1. If it exports one product with sizes in one cell, **split into one KQS row per size** before import.

### Branch stock (e.g. BB Botha / Bothe)

1. Convert export → KQS CSV (`name,style,size,color,qty,price,barcode,category`).
2. Open `/app/bulk-stock-import` → Parse CSV.
3. Set **Receive into** to that branch warehouse (Bothe / BB Botha POS warehouse — use the name on your site).
4. Fix **Needs match** rows → **Approve & publish**.
5. Cashiers on that till: hard-refresh POS; sellable qty appears for that warehouse only.
6. To move stock to another store later: **Assign to Branch** — do **not** re-Approve the same draft (idempotent; will not double qty, and will not move stock).

A stdlib converter script can be added under `scripts/` when a sample ROBOTILL export is available (see next-chat ROBOTILL prompt). Do not build a second importer UI.

## Drafts (survive reload)

- Parsing CSV or AI extract **creates a draft** (`KQS Stock Import Batch`).
- Edits **auto-save** every few seconds; **Save draft now** forces a save.
- Top of the page lists **Open drafts** → **Continue** after a browser reload, or **Delete** to discard and start fresh.
- Menu → **New draft** clears the current preview (server drafts remain until you Delete them).
- **Approve & publish** moves valid rows live (create / add variant / receive). Unresolved **Needs match** rows stay in the draft.

## Publish retries (no double qty)

- Each successful draft row is marked **Done / applied**. Approve again **skips** those rows.
- Material Receipts from bulk import store a durable key `KQSBI|{batch}|{row}|{item}` on Stock Entry remarks. If stock already landed but the draft mark was lost, retry **finds that receipt and does not receive again**.
- Autosave cannot clear Done markers. Overlapping Approve clicks are blocked (one publish at a time per draft).
- **Hide published (Done) rows** keeps the fix list focused on what still needs work.
- A **new** import batch (or Receive Stock / Assign) for the same SKU is a separate receive — that is intentional.

## Where stock appears / finding Items

- Stock lands only in **Receive into (branch)** chosen on the page. Other branches show 0 until **Assign to Branch**.
- If Item list is filtered to **Stock at {branch}** and that branch has no Bin qty, the list looks empty even though the Item exists — clear the filter or search **All**, and search by **style number** (e.g. `6308`), not color name alone.
- After publish, the log lists **SKU / style / warehouse** with **Open Item** links.

## Manual rows (missed lines)

In the preview toolbar:

- **Add product row** — blank line for a style the AI/CSV missed entirely.
- **Add color/size of last style** / per-row **+ Color/size** — copies name, style, price, category; you fill the missing color/size/qty.

## Paper columns

| Column | Meaning | Example |
|--------|---------|---------|
| Name | Product line → Item name | T-Shirt, Sweater |
| Style | Style number → template SKU | PD2-7056, J0492 |
| Color | One Color attribute value | green, **white/black** (dual-tone = one value) |
| Size + qty | Often several tokens on one line | see below |
| Price | Often `> 70` | 70 |

### Kids / footwear size formats

Writers mix these on the same line; each token becomes its **own preview row**:

| Paper | Size | Qty |
|-------|------|-----|
| `9-10/3` or `9/10/3` | 9-10 | 3 |
| `(8/9)/2` or `8/9/2` | 8-9 | 2 |
| `6/2` | 6 | 2 |
| `8/9/2 9/10/1 10/11/2` | three rows | 2, 1, 2 |

Bare `8/9` (no qty after) is treated as size label **8-9**, not size 8 qty 9.

### Colors & attribute values on publish

- Dual-tone colors (`white/black`, `Grey/DK Grey`) stay **one** Color value — not two products.
- On **Approve & publish**, missing **Color** / **Size** attribute values are **created automatically** (`_ensure_attribute_value`). They are not rejected for being new.

Ditto (`"` / `" "`) copies Name and/or Style from the row above. Crossed-out lines should be skipped by AI.

## Matching rules

- **Style number is the product identity.** If that style already exists as a catalog template, the row **auto-links** to it:
  - same color/size already in catalog → **Add stock** (receive)
  - new color/size → **Add variant** under that template
  - Paper product names may differ (OCR) — style match is enough when the style hit is unique.
- Multiple style format twins (`B 12345` / `B-12345` as different Items) → **Needs match** with **only those templates** (no unrelated fuzzy suggestions). Staff must **Use** existing, **Search**, or **Create as new**.
- Fuzzy / prefix suggestions only when **no** style-equivalent template exists (raised similarity bar so junk products are not offered).
- **Create as new** is always available when a match was suggested — with confirm if a style twin exists.

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

