#!/usr/bin/env python3
"""Build the bundled dataset for the mapping-value-alignment site.

Reads the primary coded CSV and writes data.js (a window global, so the site
works from file://) alongside data.json for anyone who wants the raw bundle.

Usage:
    python3 build_data.py "/path/to/PoP - Model card readings - Final correct - Final.csv"
"""

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

csv.field_size_limit(10 ** 9)

HERE = Path(__file__).resolve().parent
DEFAULT_CSV = Path.home() / "Downloads" / "PoP - Model card readings - Final correct - Final.csv"

# The eight companies in the sample, in presentation order.
COMPANIES = [
    ("OpenAI", "OpenAI", ("openai",)),
    ("Google", "Google", ("google", "deepmind", "gemini")),
    ("Anthropic", "Anthropic", ("anthropic",)),
    ("xAI", "xAI", ("xai",)),
    ("Meta", "Meta", ("meta", "facebook")),
    ("DeepSeek", "DeepSeek", ("deepseek",)),
    ("Mistral AI", "Mistral", ("mistral",)),
    ("Microsoft", "Microsoft", ("microsoft",)),
]

DOCUMENT_GROUPS = [
    "Principles",
    "Model cards",
    "Announcements / grants / initiatives",
    "Policies",
]

PRINCIPLE_TITLE = re.compile(
    r"constitution|charter|\bprinciple|model spec|framework|approach to (safety|ai)|"
    r"safety and alignment|regulat|governing|research agenda|preparedness",
    re.I,
)
POLICY_TITLE = re.compile(
    r"privacy polic|terms of (service|use)|usage polic|acceptable use|"
    r"data process|community guideline|responsible use|toolkit|developer guidance",
    re.I,
)
ANNOUNCEMENT_TITLE = re.compile(
    r"\bupdate\b|disrupting|introducing|announc|\bgrant\b|initiative|"
    r"powering a new era|our approach for",
    re.I,
)
MODEL_CARD_TITLE = re.compile(r"model card|system card|technical report", re.I)

NOT_REPORTED = {"", "not reported", "none", "n/a", "na", "unspecified", "not specified"}


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def reported(value):
    return clean(value) and clean(value).lower() not in NOT_REPORTED


def slug(value):
    text = re.sub(r"[^a-z0-9]+", "-", clean(value).lower()).strip("-")
    return text[:90] or "untitled"


def to_float(value, default=0.0):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def normalise_company(*candidates):
    """Map a possibly messy author string onto one of the eight sample companies."""
    for candidate in candidates:
        text = clean(candidate)
        if not text:
            continue
        for part in re.split(r"\s*\|\s*", text):
            lowered = part.lower()
            for company_id, _label, keys in COMPANIES:
                if any(key in lowered for key in keys):
                    return company_id
    return None


def document_group(pub_type, title):
    kind = clean(pub_type)
    name = clean(title)
    if kind in {"Announcement", "Initiative", "Grant"}:
        return "Announcements / grants / initiatives"
    if kind == "Principle":
        return "Principles"
    if MODEL_CARD_TITLE.search(name):
        return "Model cards"
    if PRINCIPLE_TITLE.search(name):
        return "Principles"
    if POLICY_TITLE.search(name) or kind in {"Company policy", "Guide", "Other: Toolkit",
                                             "Other: Developer guidance", "Other: Bill"}:
        return "Policies"
    if ANNOUNCEMENT_TITLE.search(name):
        return "Announcements / grants / initiatives"
    return "Model cards"


def document_year(row):
    for key in ("date_of_document", "pub_year"):
        match = re.search(r"(19|20)\d{2}", clean(row.get(key)))
        if match:
            return match.group(0)
    return ""


def build(csv_path):
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as handle:
        rows = list(csv.DictReader(handle))

    company_ids = {company_id for company_id, _, _ in COMPANIES}
    documents = {}
    kept = []
    dropped = Counter()

    for row in rows:
        company = normalise_company(row.get("company"), row.get("pub_author"))
        if company not in company_ids:
            dropped["no sample company"] += 1
            continue
        title = clean(row.get("pub_title"))
        if not title:
            dropped["no document title"] += 1
            continue

        document_id = slug(title)
        year = document_year(row)
        model = clean(row.get("model")) or clean(row.get("company_model"))
        record = documents.setdefault(document_id, {
            "id": document_id,
            "company": company,
            "company_label": dict((c[0], c[1]) for c in COMPANIES)[company],
            "title": title,
            "year": year,
            "type": clean(row.get("pub_type")) or "Document",
            "group": document_group(row.get("pub_type"), title),
            "model": model,
            "url": clean(row.get("pub_url")),
            "categories": set(),
            "records": 0,
        })
        if not record["model"] and model:
            record["model"] = model
        if not record["year"] and year:
            record["year"] = year
        record["records"] += 1

        category = clean(row.get("risk_virtue_category")) or "Other"
        record["categories"].add(category)

        kept.append((row, company, record, category, year))

    label_of = dict((c[0], c[1]) for c in COMPANIES)

    virtues, risks, training, benchmarking = [], [], [], []
    metrics = {}
    flow_totals = defaultdict(float)
    flow_meta = {}
    seen_definition = set()
    seen_training = set()
    seen_benchmark = set()

    for row, company, record, category, year in kept:
        kind_raw = clean(row.get("risk_conduct_type")).lower()
        kind = "virtue" if kind_raw == "conduct" else "risk"
        item = clean(row.get("risk_virtue_item_harmonized")) or clean(row.get("risk_conduct_item"))
        if not item:
            continue
        thematic = clean(row.get("risk_virtue_thematic_category")) or "Other"
        weight = to_float(row.get("source_record_weight"), 1.0)
        definition = clean(row.get("risk_conduct_definition"))

        source_record_id = clean(row.get("source_record_id"))
        # Normalising authors onto one of the eight companies can merge two raw
        # strings ("Google", "Google DeepMind") that were scored separately in
        # the CSV. Keep the higher score so the site's Constant/Variable labels
        # match the published CSV exactly.
        metric_key = (company, item.lower())
        candidate = {
            "score": round(to_float(row.get("risk_or_virtue_constancy_score")), 4),
            "label": clean(row.get("risk_or_virtue_constancy")) or "Variable",
            "similarity": round(to_float(row.get("risk_virtue_definition_similarity")), 4),
            "recurrence": round(to_float(row.get("risk_virtue_document_recurrence")), 4),
            "persistence": round(to_float(row.get("risk_virtue_temporal_persistence")), 4),
        }
        if metric_key not in metrics or candidate["score"] > metrics[metric_key]["score"]:
            metrics[metric_key] = candidate

        # Records carry only what a figure reads. Per-item constancy lives once
        # in the `constancy` lookup rather than on every row.
        base = {
            "company": company,
            "category": category,
            "thematic": thematic,
            "item": item,
        }

        # One entry per distinct definition of an item in a document: the merged
        # chips list source-specific definitions, so exact repeats add nothing.
        definition_key = (company, item.lower(), record["id"], definition.lower())
        if definition_key not in seen_definition:
            seen_definition.add(definition_key)
            (virtues if kind == "virtue" else risks).append(dict(
                base,
                definition=definition,
                document_id=record["id"],
                document_title=record["title"],
                document_year=year or record["year"],
            ))

        training_category = clean(row.get("risk_virtue_training_category"))
        if reported(training_category):
            training_key = (source_record_id, item.lower(), training_category.lower(),
                            clean(row.get("risk_virtue_training_item")).lower())
            if training_key not in seen_training:
                seen_training.add(training_key)
                training.append(dict(base, source_record_id=source_record_id,
                                     training_category=training_category,
                                     training_item=clean(row.get("risk_virtue_training_item"))))

        benchmark_category = clean(row.get("risk_virtue_benchmark_category"))
        if reported(benchmark_category):
            benchmark_key = (source_record_id, item.lower(), benchmark_category.lower(),
                             clean(row.get("risk_virtue_benchmark")).lower())
            if benchmark_key not in seen_benchmark:
                seen_benchmark.add(benchmark_key)
                benchmarking.append(dict(base, source_record_id=source_record_id,
                                         benchmark_category=benchmark_category,
                                         benchmark=clean(row.get("risk_virtue_benchmark"))))

        # Flows keep the CSV's per-row weight, which already divides a source
        # record equally across the training/benchmark paths it spans.
        flow_key = (company, thematic, clean(row.get("risk_virtue_training_category")) or "Not reported",
                    clean(row.get("risk_virtue_benchmark_category")) or "Not reported", category)
        flow_totals[flow_key] += weight
        flow_meta.setdefault(flow_key, {"item_examples": []})
        examples = flow_meta[flow_key]["item_examples"]
        if item not in examples and len(examples) < 5:
            examples.append(item)

    flows = []
    for (company, thematic, training_category, benchmark_category, category), value in flow_totals.items():
        flows.append({
            "company": company,
            "category": category,
            "thematic": thematic,
            "training_category": training_category,
            "benchmark_category": benchmark_category,
            "value": round(value, 5),
        })

    # Company-and-item constancy, read straight from the CSV columns so the site
    # and the published CSV always agree.
    constancy = {f"{company}::{item}": values for (company, item), values in metrics.items()}

    category_stats = {}
    for entry in virtues + risks:
        metric = metrics.get((entry["company"], entry["item"].lower()), {"score": 0.0})
        stat = category_stats.setdefault(entry["category"], {"category": entry["category"], "score": 0.0, "n": 0})
        stat["score"] += metric["score"]
        stat["n"] += 1
    for stat in category_stats.values():
        stat["score"] = round(stat["score"] / max(1, stat["n"]), 4)
        stat["constancy"] = "Constant" if stat["score"] >= 0.52 else "Variable"

    document_list = []
    for record in documents.values():
        record["categories"] = sorted(record.pop("categories"))
        document_list.append(record)
    document_list.sort(key=lambda d: (d["company"], -int(d["year"] or 0), d["title"]))

    data = {
        "companies": [{"id": cid, "label": label} for cid, label, _ in COMPANIES],
        "documentGroups": DOCUMENT_GROUPS,
        "documents": document_list,
        "virtues": virtues,
        "risks": risks,
        "training": training,
        "benchmarking": benchmarking,
        "flows": flows,
        "constancy": constancy,
        "categoryStats": sorted(category_stats.values(), key=lambda s: s["category"]),
        "meta": {
            "source": Path(csv_path).name,
            "rows_in_csv": len(rows),
            "rows_used": len(kept),
            "documents": len(document_list),
            "source_records": len({clean(r.get("source_record_id")) for r, *_ in kept}),
        },
    }

    (HERE / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    (HERE / "data.js").write_text("window.VALUE_MAP_DATA=" + json.dumps(data, ensure_ascii=False) + ";",
                                  encoding="utf-8")

    print(f"documents        {len(document_list)}")
    print(f"virtues          {len(virtues)}")
    print(f"risks            {len(risks)}")
    print(f"training rows    {len(training)}")
    print(f"benchmark rows   {len(benchmarking)}")
    print(f"flows            {len(flows)}  (total weight {sum(f['value'] for f in flows):.1f})")
    print(f"rows used        {len(kept)} of {len(rows)}")
    for reason, count in dropped.most_common():
        print(f"  dropped: {reason}: {count}")
    print("groups           " + ", ".join(
        f"{group} {sum(1 for d in document_list if d['group'] == group)}" for group in DOCUMENT_GROUPS))


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV)
