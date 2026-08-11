# Mapping value alignment

A distant reading of how eight AI companies define desirable conduct and potential harms, translate those definitions into training, and make them measurable through benchmarks.

The site is self-contained: no CDNs, no external fonts, and no dependence on `fetch()`. Open `index.html` directly from disk or serve the directory with any static web server.

## Contents

| File | Purpose |
| --- | --- |
| `index.html` | The article and its figures |
| `app.js` | Rendering and interaction for every figure |
| `style.css` | The parent article template (typography, sidebars, paper layout) |
| `page.css` | Additions specific to this page |
| `data.js` | The bundled dataset, assigned to `window.VALUE_MAP_DATA` |
| `data.json` | The same bundle as a reusable machine-readable copy |
| `d3.min.js`, `d3-sankey.min.js` | Local copies of the plotting libraries |
| `fonts/` | Local copies of the template's typefaces |
| `build_data.py` | Regenerates `data.js` and `data.json` from the coded CSV |
| `constancy.csv` | Constancy scores per company, at both category and item level |

## Figures

1. **The alignment stack** — the four levels of the stack, drawn natively in SVG.
2. **Documents** — the corpus by genre: principles, model cards, announcements / grants / initiatives, and policies. Deliberately uncoloured.
3. **Virtues** and **Risks** — one chip per harmonised item per company, merged across every document that names it, coloured by `risk_virtue_category`.
4. **Training** and **Benchmark associations** — bubble matrices of `risk_virtue_category` against `risk_virtue_training_category` and `risk_virtue_benchmark_category`.
5. **Rankflow** — company → thematic category → training category → benchmark category.

## Constancy

Constancy measures how consistently one company states a given virtue or risk over time: how much its definitions change from document to document, and how steadily the thing appears in its corpus at all. Three components:

| Component | Weight | What it measures |
| --- | --- | --- |
| `risk_virtue_definition_similarity` | 45% | Mean pairwise cosine similarity between the definitions the company attaches to it |
| `risk_virtue_document_recurrence` | 35% | Share of the company's corpus that mentions it; full marks at a quarter of the corpus, never on fewer than three documents |
| `risk_virtue_temporal_persistence` | 20% | Share of the company's active years it spans |

The weighted sum is scaled by a confidence factor, `log(1+documents)/log(5)`, so something stated once or twice stays provisional however closely its few definitions happen to match. A unit is `Constant` when it appears in at least two distinct documents and scores at least 0.45.

The score is computed at two levels, because they answer different questions:

- **Category** (`company + risk_virtue_category`, split by virtue/risk) — the level at which a company can be said to hold a settled position, and what ranks the matrix rows. CBRN and child safety score high; political neutrality scores low.
- **Item** (`company + normalised item name`) — badged on each chip. Item names are coded finely, so one category can hold dozens of near-synonyms. Near-duplicate spellings are merged (`Biological and Chemical Risks`, `Biological And Chemical Capabilities` → one chip), but a phrasing used once stays variable even where the concept behind it is constant.

Both levels are written to `constancy.csv`.

## Rebuilding the data

```
python3 build_data.py "/path/to/PoP - Model card readings - Final correct - Final.csv"
```

Add `--write-csv` to also emit a full copy of the source CSV with the recomputed constancy columns, written beside the original under a new name. The source file is never modified.

Virtue and risk are decided per item by majority vote over `risk_conduct_type` (`conduct` → virtue, `risk` → risk), so a single stray row cannot drop a virtue into the risks matrix. A category can legitimately appear in both matrices — "Safety" is stated both as a virtue and as a family of risks — and each side is then scored on its own rows.

Flow and association weights use the CSV's `source_record_weight`, which already divides a source record equally across the training and benchmark paths it spans, so companies with more documents are not over-represented by duplicated rows.

## Publishing

GitHub Pages is configured to deploy from a branch: the `main` branch, `/ (root)` folder.
