# Mapping value alignment

A distant reading of how eight AI companies define desirable conduct and potential harms, translate those definitions into training, and make them measurable through benchmarks.

The site is self-contained: no CDNs, no external fonts, and no dependence on `fetch()`. Open `index.html` directly from disk or serve the directory with any static web server.

## Contents

| File | Purpose |
| --- | --- |
| `index.html` | The article, its three figures, and the findings under each |
| `app.js` | Rendering and interaction |
| `style.css` | The parent article template (typography, sidebars, paper layout) |
| `page.css` | Additions specific to this page |
| `data.js` | The bundled dataset, assigned to `window.VALUE_MAP_DATA` |
| `data.json` | The same bundle as a reusable machine-readable copy |
| `consistency.csv` | Consistency scores at item, category and thematic level |
| `d3.min.js`, `d3-sankey.min.js` | Local copies of the plotting libraries |
| `fonts/` | Local copies of the template's typefaces |
| `build_data.py` | Regenerates `data.js`, `data.json` and `consistency.csv` from the coded CSV |

## Figures

1. **The alignment stack** — the four levels of the stack, drawn natively in SVG.
2. **Virtues** — the thematic families of desirable conduct, ranked by consistency.
3. **Risks** — the thematic families of harm, ranked by the same measure.
4. **From company to evaluation** — a five-stage rankflow: company → virtue or risk → thematic family → training → benchmark.

Each of figures 2–4 is followed by findings answering one question: what virtues are trained for and how consistently they are defined; what risks are mitigated and how consistently they are defined; and what training goes with which family, and what benchmarks evaluate it.

## Consistency

Consistency is not how often something is mentioned. A virtue or risk is consistent when three things hold at once, counted equally:

| Component | What it measures |
| --- | --- |
| **Predominance** | Present and frequent across the companies' documents — half the share of companies naming it, half the share of the corpus mentioning it |
| **Generality** | Companies define it in the same terms as one another — mean pairwise cosine similarity between each company's pooled definitions |
| **Consistency** | It recurs steadily inside each company's own corpus — recurrence and temporal span within a company, averaged across companies |

The score is their mean, so a bar's length is the score out of 100 and its three segments show what produced it. A unit reads as `Consistent` when it appears in at least two documents and scores at least 0.45.

It is computed at three levels — item, `risk_virtue_category`, and `risk_virtue_thematic_category` — each split by virtue and risk, since a category can host both. All three levels are written to `consistency.csv`.

## Rebuilding the data

```
python3 build_data.py "/path/to/PoP - Model card readings - Final correct - Final.csv"
```

Add `--write-csv` to also emit a full copy of the source CSV with the recomputed consistency columns, written beside the original under a new name. The source file is never modified.

Virtue and risk are decided per item by majority vote over `risk_conduct_type` (`conduct` → virtue, `risk` → risk), so a single stray row cannot drop a virtue into the risks figure. A family can legitimately appear on both sides — "behavioral alignment & control" is stated both as a virtue and as a family of risks — and each side is scored on its own rows.

Flow weights use the CSV's `source_record_weight`, which already divides a source record equally across the training and benchmark paths it spans, so companies with more documents are not over-represented by duplicated rows.

## Publishing

GitHub Pages is configured to deploy from a branch: the `main` branch, `/ (root)` folder.
