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

## Figures

1. **The alignment stack** — the four levels of the stack, drawn natively in SVG.
2. **Documents** — the corpus by genre: principles, model cards, announcements / grants / initiatives, and policies. Deliberately uncoloured.
3. **Virtues** and **Risks** — one chip per harmonised item per company, merged across every document that names it, coloured by `risk_virtue_category`.
4. **Training** and **Benchmark associations** — bubble matrices of `risk_virtue_category` against `risk_virtue_training_category` and `risk_virtue_benchmark_category`.
5. **Rankflow** — company → thematic category → training category → benchmark category.

## Constancy

Constancy is a company-level measure of how consistently one company defines a given virtue or risk over time. The unit is `company + risk_virtue_item_harmonized`. It combines the linguistic similarity of that item's definitions within that company (50%), the number of distinct documents mentioning it (30%), and its persistence across the company's documentary timeline (20%), with a penalty for items introduced recently in two or fewer documents.

An item is `Constant` when it appears in at least two distinct documents and scores at least 0.52; everything else is `Variable`. The scores are read from the CSV columns `risk_or_virtue_constancy`, `risk_or_virtue_constancy_score`, `risk_virtue_definition_similarity`, `risk_virtue_document_recurrence` and `risk_virtue_temporal_persistence`, so the site and the published dataset always agree.

## Rebuilding the data

```
python3 build_data.py "/path/to/PoP - Model card readings - Final correct - Final.csv"
```

Flow and association weights use the CSV's `source_record_weight`, which already divides a source record equally across the training and benchmark paths it spans, so companies with more documents are not over-represented by duplicated rows.

## Publishing

GitHub Pages is configured to deploy from a branch: the `main` branch, `/ (root)` folder.
