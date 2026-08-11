#!/usr/bin/env python3
"""Build the bundled dataset for the mapping-value-alignment site.

Reads the primary coded CSV and writes data.js (a window global, so the site
works from file://) alongside data.json for anyone who wants the raw bundle.
Also writes constancy.csv, the per-company constancy scores in tabular form.

Usage:
    python3 build_data.py "/path/to/PoP - Model card readings - Final correct - Final.csv"
    python3 build_data.py <csv> --write-csv     # also emit a full CSV with
                                                # the recomputed constancy columns,
                                                # written beside the source file
"""

import csv
import json
import math
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

# Item names are coded very finely: "Biological and Chemical", "Biological and
# Chemical Risks" and "Biological And Chemical Capabilities" are three separate
# strings for one thing. Peeling generic tails merges them so that a chip — and
# its constancy — covers the item rather than one phrasing of it.
GENERIC_TAIL = (
    r"(risks?|capabilit(?:y|ies)|content|harms?|safety|threats?|materials?|"
    r"behaviou?rs?|abuse|misuse|issues?|concerns?|violations?|attacks?|prompts?|"
    r"generation|creation|uplift|robustness|mitigation)"
)
STOPWORDS = set(
    "the a an and or of to in for on with by from is are was were be been being this "
    "that these those it its as at into their they we our you your model models system "
    "systems may can should will would could about across when where which who how than "
    "then also such using used use other others including include includes not no more "
    "most any all each per via within without over under between during while ai llm".split()
)

# Constancy weights. Definition stability counts for most, then how much of the
# company's corpus mentions the item, then how much of its timeline it spans.
W_SIMILARITY, W_RECURRENCE, W_PERSISTENCE = 0.45, 0.35, 0.20
LONE_DEFINITION_SIMILARITY = 0.30   # a single definition is unproven, not similar
CONSTANT_THRESHOLD = 0.45
MIN_DOCUMENTS_FOR_CONSTANT = 2


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


def normalise_item(value):
    """Collapse near-duplicate spellings of one item onto a single key."""
    text = re.sub(r"[^a-z0-9\s&/-]", " ", clean(value).lower())
    text = re.sub(r"\s+", " ", text).strip()
    previous = None
    while previous != text:
        previous = text
        text = re.sub(rf"\s+{GENERIC_TAIL}$", "", text).strip()
    text = re.sub(r"\bcsam\b", "child sexual abuse", text)
    text = re.sub(r"\bcbrn\b", "chemical biological radiological nuclear", text)
    text = re.sub(r"\bchemical and biological\b", "biological and chemical", text)
    if len(text) > 4 and text.endswith("s") and not text.endswith("ss"):
        text = text[:-1]
    return text or clean(value).lower()


def tokens(text):
    words = re.sub(r"[^a-z0-9\s-]", " ", clean(text).lower()).split()
    return Counter(word for word in words if len(word) > 2 and word not in STOPWORDS)


def cosine(left, right):
    if not left or not right:
        return 0.0
    numerator = sum(left[word] * right[word] for word in set(left) & set(right))
    left_norm = math.sqrt(sum(value * value for value in left.values()))
    right_norm = math.sqrt(sum(value * value for value in right.values()))
    return numerator / (left_norm * right_norm) if left_norm and right_norm else 0.0


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


def score_constancy(units, company_documents, company_years):
    """Score how consistently each company states one item over its documents.

    `units` maps (company, key) to a list of (document title, year, definition).
    Three things move the score: whether the definitions say the same thing from
    one document to the next, how much of the company's corpus mentions the item,
    and how much of the company's timeline it spans. The result is then scaled by
    a confidence factor, so an item seen once or twice stays provisional however
    closely its few definitions happen to match.
    """
    scored = {}
    for (company, key), occurrences in units.items():
        documents = {}
        for title, year, definition in occurrences:
            documents.setdefault(title, (year, definition))
        count = len(documents)
        years = {year for year, _ in documents.values() if year}
        definitions = [tokens(definition) for _, definition in documents.values() if clean(definition)]

        if len(definitions) >= 2:
            pairs = [cosine(definitions[i], definitions[j])
                     for i in range(len(definitions)) for j in range(i + 1, len(definitions))]
            similarity = sum(pairs) / len(pairs)
        else:
            similarity = LONE_DEFINITION_SIMILARITY

        # Full marks for appearing in a quarter of the company's documents, but
        # never on fewer than three, so small corpora cannot top the ranking.
        target = max(3.0, 0.25 * len(company_documents.get(company, ())))
        recurrence = min(1.0, count / target)

        active_years = company_years.get(company, set())
        persistence = min(1.0, len(years) / len(active_years)) if len(active_years) > 1 else 0.5

        base = W_SIMILARITY * similarity + W_RECURRENCE * recurrence + W_PERSISTENCE * persistence
        confidence = min(1.0, math.log(1 + count) / math.log(1 + 4))
        score = max(0.0, min(1.0, base * confidence))

        scored[(company, key)] = {
            "score": round(score, 4),
            "label": ("Constant" if count >= MIN_DOCUMENTS_FOR_CONSTANT and score >= CONSTANT_THRESHOLD
                      else "Variable"),
            "similarity": round(similarity, 4),
            "recurrence": round(recurrence, 4),
            "persistence": round(persistence, 4),
            "documents": count,
            "years": sorted(years),
        }
    return scored


def build(csv_path, write_csv=False):
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as handle:
        rows = list(csv.DictReader(handle))

    company_ids = {company_id for company_id, _, _ in COMPANIES}
    label_of = {company_id: label for company_id, label, _ in COMPANIES}
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
            "company_label": label_of[company],
            "title": title,
            "year": year,
            "type": clean(row.get("pub_type")) or "Document",
            "group": document_group(row.get("pub_type"), title),
            "model": model,
            "url": clean(row.get("pub_url")),
            "categories": set(),
        })
        if not record["model"] and model:
            record["model"] = model
        if not record["year"] and year:
            record["year"] = year

        category = clean(row.get("risk_virtue_category")) or "Other"
        record["categories"].add(category)
        kept.append((row, company, record, category, year))

    # A company's corpus and timeline, the baselines constancy is measured against.
    company_documents = defaultdict(set)
    company_years = defaultdict(set)
    for _row, company, record, _category, year in kept:
        company_documents[company].add(record["id"])
        if year:
            company_years[company].add(int(year))

    # risk_conduct_type is coded per row, so one stray row can drop a virtue into
    # the risks matrix. Decide once per item, by majority across all its rows.
    item_votes = defaultdict(Counter)
    for row, _company, _record, _category, _year in kept:
        item = clean(row.get("risk_virtue_item_harmonized")) or clean(row.get("risk_conduct_item"))
        if item:
            item_votes[normalise_item(item)][clean(row.get("risk_conduct_type")).lower()] += 1
    item_kind = {}
    for key, votes in item_votes.items():
        virtue_votes = votes.get("conduct", 0)
        risk_votes = votes.get("risk", 0)
        item_kind[key] = "virtue" if virtue_votes > risk_votes else "risk"

    item_units = defaultdict(list)
    category_units = defaultdict(list)
    for row, company, record, category, year in kept:
        item = clean(row.get("risk_virtue_item_harmonized")) or clean(row.get("risk_conduct_item"))
        if not item:
            continue
        item_key = normalise_item(item)
        definition = clean(row.get("risk_conduct_definition"))
        occurrence = (record["id"], int(year) if year else 0, definition)
        item_units[(company, item_key)].append(occurrence)
        # A category can host both a virtue and a risk side — "Safety" is stated
        # as a virtue and as a risk — so each side is scored on its own rows.
        category_units[(company, f"{item_kind.get(item_key, 'risk')}::{category}")].append(occurrence)

    item_constancy = score_constancy(item_units, company_documents, company_years)
    category_constancy = score_constancy(category_units, company_documents, company_years)

    virtues, risks, training, benchmarking = [], [], [], []
    display_name = defaultdict(Counter)
    flow_totals = defaultdict(float)
    seen_definition, seen_training, seen_benchmark = set(), set(), set()

    for row, company, record, category, year in kept:
        item = clean(row.get("risk_virtue_item_harmonized")) or clean(row.get("risk_conduct_item"))
        if not item:
            continue
        item_key = normalise_item(item)
        display_name[item_key][item] += 1
        kind = item_kind.get(item_key, "risk")
        thematic = clean(row.get("risk_virtue_thematic_category")) or "Other"
        weight = to_float(row.get("source_record_weight"), 1.0)
        definition = clean(row.get("risk_conduct_definition"))
        source_record_id = clean(row.get("source_record_id"))

        base = {
            "company": company,
            "category": category,
            "thematic": thematic,
            "item": item,
            "item_key": item_key,
        }

        definition_key = (company, item_key, record["id"], definition.lower())
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
            key = (source_record_id, item_key, training_category.lower(),
                   clean(row.get("risk_virtue_training_item")).lower())
            if key not in seen_training:
                seen_training.add(key)
                training.append(dict(base, source_record_id=source_record_id,
                                     training_category=training_category,
                                     training_item=clean(row.get("risk_virtue_training_item"))))

        benchmark_category = clean(row.get("risk_virtue_benchmark_category"))
        if reported(benchmark_category):
            key = (source_record_id, item_key, benchmark_category.lower(),
                   clean(row.get("risk_virtue_benchmark")).lower())
            if key not in seen_benchmark:
                seen_benchmark.add(key)
                benchmarking.append(dict(base, source_record_id=source_record_id,
                                         benchmark_category=benchmark_category,
                                         benchmark=clean(row.get("risk_virtue_benchmark"))))

        # Flows keep the CSV's per-row weight, which already divides a source
        # record equally across the training/benchmark paths it spans.
        flow_key = (company, thematic,
                    clean(row.get("risk_virtue_training_category")) or "Not reported",
                    clean(row.get("risk_virtue_benchmark_category")) or "Not reported", category)
        flow_totals[flow_key] += weight

    flows = [{
        "company": company,
        "category": category,
        "thematic": thematic,
        "training_category": training_category,
        "benchmark_category": benchmark_category,
        "value": round(value, 5),
    } for (company, thematic, training_category, benchmark_category, category), value
        in flow_totals.items()]

    # Show the spelling the company used most often for each merged item.
    for entry in virtues + risks + training + benchmarking:
        entry["item"] = display_name[entry["item_key"]].most_common(1)[0][0]

    def pack(scored):
        return {f"{company}::{key}": {k: v for k, v in values.items() if k != "years"}
                for (company, key), values in scored.items()}

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
        "constancy": pack(item_constancy),
        "categoryConstancy": pack(category_constancy),
        "meta": {
            "source": Path(csv_path).name,
            "rows_in_csv": len(rows),
            "rows_used": len(kept),
            "constant_threshold": CONSTANT_THRESHOLD,
            "weights": {"similarity": W_SIMILARITY, "recurrence": W_RECURRENCE,
                        "persistence": W_PERSISTENCE},
        },
    }

    (HERE / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    (HERE / "data.js").write_text("window.VALUE_MAP_DATA=" + json.dumps(data, ensure_ascii=False) + ";",
                                  encoding="utf-8")

    with open(HERE / "constancy.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["unit", "company", "name", "kind", "risk_or_virtue_constancy",
                         "risk_or_virtue_constancy_score", "risk_virtue_definition_similarity",
                         "risk_virtue_document_recurrence", "risk_virtue_temporal_persistence",
                         "distinct_documents", "years"])
        for (company, key), values in sorted(item_constancy.items()):
            writer.writerow(["item", company, display_name[key].most_common(1)[0][0] if display_name[key] else key,
                             item_kind.get(key, "risk"), values["label"], values["score"],
                             values["similarity"], values["recurrence"], values["persistence"],
                             values["documents"], " ".join(str(y) for y in values["years"])])
        for (company, key), values in sorted(category_constancy.items()):
            kind, _, category = key.partition("::")
            writer.writerow(["category", company, category, kind, values["label"], values["score"],
                             values["similarity"], values["recurrence"], values["persistence"],
                             values["documents"], " ".join(str(y) for y in values["years"])])

    if write_csv:
        target = Path(csv_path).with_name(Path(csv_path).stem + " (constancy recomputed).csv")
        fieldnames = list(rows[0].keys()) if rows else []
        with open(target, "w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                company = normalise_company(row.get("company"), row.get("pub_author"))
                item = clean(row.get("risk_virtue_item_harmonized")) or clean(row.get("risk_conduct_item"))
                values = item_constancy.get((company, normalise_item(item))) if company and item else None
                if values:
                    row["risk_or_virtue_constancy"] = values["label"]
                    row["risk_or_virtue_constancy_score"] = values["score"]
                    row["risk_virtue_definition_similarity"] = values["similarity"]
                    row["risk_virtue_document_recurrence"] = values["recurrence"]
                    row["risk_virtue_temporal_persistence"] = values["persistence"]
                writer.writerow(row)
        print(f"wrote            {target}")

    constant_items = sum(1 for v in item_constancy.values() if v["label"] == "Constant")
    constant_categories = sum(1 for v in category_constancy.values() if v["label"] == "Constant")
    print(f"documents        {len(document_list)}")
    print(f"virtues          {len(virtues)}   ({len({(e['company'], e['item_key']) for e in virtues})} chips)")
    print(f"risks            {len(risks)}  ({len({(e['company'], e['item_key']) for e in risks})} chips)")
    print(f"training rows    {len(training)}")
    print(f"benchmark rows   {len(benchmarking)}")
    print(f"flows            {len(flows)}  (total weight {sum(f['value'] for f in flows):.1f})")
    print(f"item constancy   {constant_items} constant of {len(item_constancy)}")
    print(f"category const.  {constant_categories} constant of {len(category_constancy)}")
    print(f"rows used        {len(kept)} of {len(rows)}")
    for reason, count in dropped.most_common():
        print(f"  dropped: {reason}: {count}")
    print("groups           " + ", ".join(
        f"{group} {sum(1 for d in document_list if d['group'] == group)}" for group in DOCUMENT_GROUPS))


if __name__ == "__main__":
    arguments = [a for a in sys.argv[1:] if not a.startswith("--")]
    build(arguments[0] if arguments else DEFAULT_CSV, write_csv="--write-csv" in sys.argv)
