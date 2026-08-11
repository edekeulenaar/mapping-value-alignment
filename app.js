const state = {
  data: null,
  companies: new Set(),
  categories: new Set(),
  categorySearch: "",
  sort: { virtues: "constancy", risks: "constancy" },
  documentSort: "date-desc",
  associationSort: "count",
};

const $ = selector => document.querySelector(selector);
const clean = value => String(value || "").trim();
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char]));
const yearNumber = value => Number.parseInt(value, 10) || 0;
const uniqueBy = (values, keyFn) => { const seen = new Set(); return values.filter(value => { const key = keyFn(value); if (seen.has(key)) return false; seen.add(key); return true; }); };
const activeCompanies = () => state.companies.size ? state.companies : new Set(state.data.companies.map(company => company.id));
const visibleCompany = row => activeCompanies().has(row.company);
const visibleCategory = row => !state.categories.size || state.categories.has(row.category);
const notReported = value => !clean(value) || clean(value).toLowerCase() === "not reported";

/* Colour is carried by risk_virtue_category. With ~80 categories a flat palette
   would repeat arbitrarily, so each thematic family gets a hue and its
   categories are spread across that hue's lightness range. */
const THEMATIC_HUE = {
  "Behavioral alignment & control": [262, 42],
  "Capability & performance": [203, 44],
  "Catastrophic & security risks": [354, 46],
  "Content safety & misuse": [20, 55],
  "Economic & institutional effects": [40, 52],
  "Epistemic integrity": [172, 38],
  "Human wellbeing & interaction": [330, 40],
  "Political & civic integrity": [288, 34],
  "Privacy, rights & provenance": [224, 40],
  "Societal harms & equity": [96, 38],
  "General / cross-cutting": [40, 7],
};
const categoryColor = new Map();
function buildPalette() {
  const families = new Map();
  [...state.data.virtues, ...state.data.risks].forEach(row => {
    const family = families.get(row.thematic) || new Map();
    family.set(row.category, (family.get(row.category) || 0) + 1);
    families.set(row.thematic, family);
  });
  families.forEach((categories, thematic) => {
    const [hue, saturation] = THEMATIC_HUE[thematic] || [40, 10];
    const names = [...categories.keys()].sort();
    names.forEach((name, index) => {
      const step = names.length > 1 ? index / (names.length - 1) : 0.35;
      categoryColor.set(name, `hsl(${hue} ${saturation}% ${86 - step * 24}%)`);
    });
  });
}
const color = category => categoryColor.get(category) || "hsl(40 8% 82%)";

const EMPTY_METRIC = { score: 0, label: "Variable", similarity: 0, recurrence: 0, persistence: 0, documents: 0 };

/* Constancy is measured at two levels. An item chip carries how consistently a
   company states that particular item; the category row carries how consistently
   it states the concept, which is the level most claims are made at. */
function metricFor(company, itemKey) {
  return state.data.constancy[`${company}::${itemKey}`] || EMPTY_METRIC;
}
function categoryMetricFor(company, category, kind) {
  return state.data.categoryConstancy[`${company}::${kind}::${category}`] || EMPTY_METRIC;
}

function moveTip(event) {
  const node = $("#tooltip");
  node.style.left = `${Math.max(8, Math.min(window.innerWidth - 390, event.clientX + 14))}px`;
  node.style.top = `${Math.max(8, Math.min(window.innerHeight - Math.min(520, node.offsetHeight) - 12, event.clientY + 14))}px`;
}
function showTip(event, html) { const node = $("#tooltip"); node.innerHTML = html; node.classList.add("visible"); moveTip(event); }
function hideTip() { $("#tooltip").classList.remove("visible"); }
function attachTip(node, html) {
  node.addEventListener("mouseenter", event => showTip(event, html));
  node.addEventListener("mousemove", moveTip);
  node.addEventListener("mouseleave", hideTip);
  node.addEventListener("focus", event => showTip({ clientX: node.getBoundingClientRect().right, clientY: node.getBoundingClientRect().bottom }, html));
  node.addEventListener("blur", hideTip);
}

function headings(container, label) {
  const columns = state.data.companies.filter(company => activeCompanies().has(company.id));
  container.style.gridTemplateColumns = `var(--label-w) repeat(${columns.length}, var(--col-w))`;
  container.innerHTML = `<div class="co-head spacer">${esc(label)}</div>${columns.map(company => `<div class="co-head"><span class="co-name">${esc(company.label)}</span></div>`).join("")}`;
  return columns;
}

/* ---------------------------------------------------------------- documents */

function compareDocuments(a, b) {
  if (state.documentSort === "name") return a.title.localeCompare(b.title);
  if (state.documentSort === "date-asc") return yearNumber(a.year) - yearNumber(b.year) || a.title.localeCompare(b.title);
  if (state.documentSort === "type") return clean(a.type).localeCompare(clean(b.type)) || a.title.localeCompare(b.title);
  return yearNumber(b.year) - yearNumber(a.year) || a.title.localeCompare(b.title);
}

function documentTooltip(source) {
  return `<strong>${esc(source.title)}</strong>`
    + `<span class="tip-category">${esc(source.group)}</span>`
    + `<div class="metric-grid">`
    + `<span>Year <b>${esc(source.year || "undated")}</b></span>`
    + `<span>Type <b>${esc(source.type || "Document")}</b></span>`
    + `<span>Model <b>${esc(source.model || "—")}</b></span>`
    + `<span>Company <b>${esc(source.company_label)}</b></span>`
    + `</div>`
    + `<span class="tip-extra">${source.categories.length} risk / virtue categor${source.categories.length === 1 ? "y" : "ies"} coded in this document.</span>`;
}

function renderDocuments() {
  const container = $("#document-grid");
  const columns = headings(container, "Document category");
  let shown = 0;
  state.data.documentGroups.forEach(groupName => {
    const label = document.createElement("div");
    label.className = "cat-row-label";
    label.textContent = groupName;
    container.append(label);
    columns.forEach(company => {
      const cell = document.createElement("div");
      cell.className = "cat-cell docs-cell";
      state.data.documents
        .filter(source => source.company === company.id && source.group === groupName)
        .filter(source => !state.categories.size || source.categories.some(category => state.categories.has(category)))
        .sort(compareDocuments)
        .forEach(source => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "document-card";
          button.setAttribute("aria-label", `${source.title}, ${source.year || "undated"}`);
          attachTip(button, documentTooltip(source));
          cell.append(button);
          shown += 1;
        });
      if (!cell.childElementCount) cell.textContent = "—";
      container.append(cell);
    });
  });
  $("#document-count").textContent = `${shown} document${shown === 1 ? "" : "s"} shown.`;
}

/* -------------------------------------------------------- virtues and risks */

function mergeCommitments(rows, kind) {
  const groups = new Map();
  rows.filter(visibleCompany).filter(visibleCategory).forEach(row => {
    const key = `${row.company}::${row.item_key}`;
    if (!groups.has(key)) groups.set(key, { company: row.company, kind, itemKey: row.item_key, item: row.item, occurrences: [] });
    groups.get(key).occurrences.push(row);
  });
  return [...groups.values()].map(group => {
    const counts = new Map();
    group.occurrences.forEach(row => counts.set(row.category, (counts.get(row.category) || 0) + 1));
    group.category = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Other";
    group.metric = metricFor(group.company, group.itemKey);
    group.constancy = group.metric.label;
    const years = group.occurrences.map(row => yearNumber(row.document_year)).filter(Boolean);
    group.latestYear = years.length ? Math.max(...years) : 0;
    group.earliestYear = years.length ? Math.min(...years) : 0;
    group.documents = new Set(group.occurrences.map(row => row.document_id)).size;
    group.occurrences.sort((a, b) => yearNumber(b.document_year) - yearNumber(a.document_year) || clean(a.document_title).localeCompare(clean(b.document_title)));
    return group;
  });
}

function compareCommitments(sort) {
  return (a, b) => {
    if (sort === "name") return a.item.localeCompare(b.item);
    if (sort === "date-desc") return b.latestYear - a.latestYear || a.item.localeCompare(b.item);
    if (sort === "date-asc") return a.earliestYear - b.earliestYear || a.item.localeCompare(b.item);
    return b.metric.score - a.metric.score || a.item.localeCompare(b.item);
  };
}

function commitmentTooltip(group) {
  const metric = group.metric;
  const categoryMetric = categoryMetricFor(group.company, group.category, group.kind);
  const entries = uniqueBy(group.occurrences, row => `${row.document_id}::${clean(row.definition).toLowerCase()}`);
  return `<strong>${esc(group.item)}</strong>`
    + `<span class="tip-category">${esc(group.category)} · ${esc(group.company)} · ${esc(group.constancy)} · constancy ${Math.round(metric.score * 100)}/100</span>`
    + `<div class="metric-grid">`
    + `<span>Definition similarity <b>${Math.round(metric.similarity * 100)}</b></span>`
    + `<span>Document recurrence <b>${Math.round(metric.recurrence * 100)}</b></span>`
    + `<span>Temporal persistence <b>${Math.round(metric.persistence * 100)}</b></span>`
    + `<span>${esc(group.category)} overall <b>${Math.round(categoryMetric.score * 100)}</b></span>`
    + `</div>`
    + `<span class="tip-extra">${group.documents} distinct document${group.documents === 1 ? "" : "s"}${group.latestYear ? ` · ${group.earliestYear === group.latestYear ? group.latestYear : `${group.earliestYear}–${group.latestYear}`}` : ""}. ${esc(group.company)} states ${esc(group.category)} as a whole ${categoryMetric.label === "Constant" ? "consistently" : "variably"}, across ${categoryMetric.documents} document${categoryMetric.documents === 1 ? "" : "s"}.</span>`
    + `<div class="definition-list">${entries.map(row => `<section><b>${esc(row.document_title || "Untitled document")}${row.document_year ? ` (${esc(row.document_year)})` : ""}</b><p>${esc(row.definition || "No definition disclosed in this document.")}</p></section>`).join("")}</div>`;
}

function commitmentCard(group) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "value-card commitment-card";
  card.style.background = color(group.category);
  card.dataset.constancy = group.constancy;
  card.innerHTML = `<span class="card-name">${esc(group.item)}</span>`
    + `<span class="constancy-score">${Math.round(group.metric.score * 100)}</span>`
    + (group.documents > 1 ? `<span class="source-count">${group.documents}</span>` : "")
    + `<span class="definition">${group.occurrences.map(row => `<b>${esc(row.document_title)}${row.document_year ? ` (${esc(row.document_year)})` : ""}</b> — ${esc(row.definition || "No definition disclosed in this document.")}`).join("<br>")}</span>`;
  attachTip(card, commitmentTooltip(group));
  return card;
}

function renderCommitments(target, rows, countTarget, which) {
  const container = $(target);
  const columns = headings(container, "Risk / virtue category");
  const kind = which === "virtues" ? "virtue" : "risk";
  const groups = mergeCommitments(rows, kind);
  const sort = state.sort[which];

  /* A row is a category, so it is ranked by how consistently the visible
     companies state that category — not by the average of its item chips. */
  const categories = [...new Set(groups.map(group => group.category))].map(category => {
    const members = groups.filter(group => group.category === category);
    const present = [...new Set(members.map(group => group.company))].map(company => categoryMetricFor(company, category, kind));
    const mean = present.reduce((sum, metric) => sum + metric.score, 0) / Math.max(1, present.length);
    /* A row is a category across companies, so how widely it is held counts as
       well as how steadily each company states it: a category only one company
       names is not yet a settled position in the field. */
    const coverage = Math.min(1, Math.log(1 + present.length) / Math.log(1 + 3));
    return {
      category,
      score: mean * coverage,
      mean,
      companies: present.length,
      constant: present.filter(metric => metric.label === "Constant").length,
      latestYear: Math.max(0, ...members.map(group => group.latestYear)),
      earliestYear: Math.min(...members.map(group => group.earliestYear || Infinity)),
    };
  }).sort((a, b) => {
    if (sort === "name") return a.category.localeCompare(b.category);
    if (sort === "date-desc") return b.latestYear - a.latestYear || a.category.localeCompare(b.category);
    if (sort === "date-asc") return a.earliestYear - b.earliestYear || a.category.localeCompare(b.category);
    return b.score - a.score || a.category.localeCompare(b.category);
  });

  categories.forEach(meta => {
    const label = document.createElement("div");
    label.className = "cat-row-label";
    const span = Number.isFinite(meta.earliestYear) && meta.latestYear
      ? (meta.earliestYear === meta.latestYear ? `${meta.latestYear}` : `${meta.earliestYear}–${meta.latestYear}`)
      : "";
    label.innerHTML = `${esc(meta.category)}<span class="constancy"><i class="swatch" style="background:${color(meta.category)}"></i>`
      + `constancy ${Math.round(meta.mean * 100)}/100 · constant in ${meta.constant} of ${meta.companies} compan${meta.companies === 1 ? "y" : "ies"}${span ? ` · ${span}` : ""}</span>`;
    container.append(label);
    columns.forEach(company => {
      const cell = document.createElement("div");
      cell.className = "cat-cell";
      groups.filter(group => group.company === company.id && group.category === meta.category)
        .sort(compareCommitments(sort))
        .forEach(group => cell.append(commitmentCard(group)));
      if (!cell.childElementCount) cell.textContent = "—";
      container.append(cell);
    });
  });
  if (countTarget) {
    $(countTarget).textContent = `${groups.length} merged chip${groups.length === 1 ? "" : "s"} across ${categories.length} categor${categories.length === 1 ? "y" : "ies"}.`;
  }
}

/* -------------------------------------------------- training / benchmarking */

function renderAssociation(target, rows, processKey, exampleKey) {
  const svg = d3.select(target);
  svg.selectAll("*").remove();
  const filtered = rows.filter(visibleCompany).filter(visibleCategory).filter(row => !notReported(row[processKey]));

  /* One source record may span several process categories; its weight is
     divided between them so busier documents do not dominate. */
  const pairs = new Map();
  d3.group(filtered, row => row.source_record_id || `${row.company}::${row.item}`).forEach(sourceRows => {
    const unique = uniqueBy(sourceRows, row => `${row.category}::${row[processKey]}`);
    const weight = 1 / Math.max(1, unique.length);
    unique.forEach(row => {
      const key = `${row.category}::${row[processKey]}`;
      if (!pairs.has(key)) pairs.set(key, { category: row.category, process: row[processKey], value: 0, examples: [], items: [] });
      const pair = pairs.get(key);
      pair.value += weight;
      const example = clean(row[exampleKey]) || row.item;
      if (example && pair.examples.length < 5 && !pair.examples.includes(example)) pair.examples.push(example);
      if (pair.items.length < 5 && !pair.items.includes(row.item)) pair.items.push(row.item);
    });
  });

  const all = [...pairs.values()];
  const minimum = 3;
  const categoryTotals = d3.rollup(all, values => d3.sum(values, d => d.value), d => d.category);
  const processTotals = d3.rollup(all, values => d3.sum(values, d => d.value), d => d.process);
  const displayed = all.filter(pair => pair.value >= minimum);
  if (!displayed.length) {
    svg.attr("viewBox", "0 0 900 110").append("text").attr("x", 18).attr("y", 52).attr("class", "association-empty")
      .text("No association reaches three weighted source records under the selected filters.");
    return;
  }

  const meanConstancy = new Map();
  const seenPair = new Set();
  [["virtue", state.data.virtues], ["risk", state.data.risks]].forEach(([kind, source]) => {
    source.filter(visibleCompany).forEach(row => {
      const pair = `${row.company}::${kind}::${row.category}`;
      if (seenPair.has(pair)) return;
      seenPair.add(pair);
      const entry = meanConstancy.get(row.category) || { sum: 0, n: 0 };
      entry.sum += categoryMetricFor(row.company, row.category, kind).score;
      entry.n += 1;
      meanConstancy.set(row.category, entry);
    });
  });
  const constancyOf = category => { const entry = meanConstancy.get(category); return entry ? entry.sum / entry.n : 0; };

  let categories = [...new Set(displayed.map(pair => pair.category))];
  let processes = [...new Set(displayed.map(pair => pair.process))];
  if (state.associationSort === "name") {
    categories.sort((a, b) => a.localeCompare(b));
    processes.sort((a, b) => a.localeCompare(b));
  } else if (state.associationSort === "constancy") {
    categories.sort((a, b) => constancyOf(b) - constancyOf(a) || a.localeCompare(b));
    processes.sort((a, b) => (processTotals.get(b) || 0) - (processTotals.get(a) || 0));
  } else {
    categories.sort((a, b) => (categoryTotals.get(b) || 0) - (categoryTotals.get(a) || 0) || a.localeCompare(b));
    processes.sort((a, b) => (processTotals.get(b) || 0) - (processTotals.get(a) || 0) || a.localeCompare(b));
  }
  categories = categories.slice(0, 20);
  const categorySet = new Set(categories);
  const visible = displayed.filter(pair => categorySet.has(pair.category));
  processes = processes.filter(process => visible.some(pair => pair.process === process));

  const cell = 40;
  const margin = { top: 190, right: 30, bottom: 34, left: 215 };
  const width = Math.max(900, margin.left + margin.right + processes.length * cell);
  const height = margin.top + margin.bottom + categories.length * cell;
  svg.attr("viewBox", `0 0 ${width} ${height}`).style("min-width", `${width}px`).style("height", `${height}px`);

  const x = d3.scaleBand().domain(processes).range([margin.left, width - margin.right]).padding(0.12);
  const y = d3.scaleBand().domain(categories).range([margin.top, height - margin.bottom]).padding(0.12);
  const radius = d3.scaleSqrt().domain([0, d3.max(visible, d => d.value)]).range([3.5, 16]);

  svg.append("g").selectAll("line").data(processes).join("line")
    .attr("x1", d => x(d) + x.bandwidth() / 2).attr("x2", d => x(d) + x.bandwidth() / 2)
    .attr("y1", margin.top - 6).attr("y2", height - margin.bottom).attr("stroke", "#ded7cb");
  svg.append("g").selectAll("line").data(categories).join("line")
    .attr("x1", margin.left).attr("x2", width - margin.right)
    .attr("y1", d => y(d) + y.bandwidth() / 2).attr("y2", d => y(d) + y.bandwidth() / 2).attr("stroke", "#ded7cb");
  svg.append("g").selectAll("text").data(processes).join("text")
    .attr("class", "association-axis association-x")
    .attr("transform", d => `translate(${x(d) + x.bandwidth() / 2},${margin.top - 14}) rotate(-48)`)
    .attr("text-anchor", "start").text(d => d);
  svg.append("g").selectAll("text").data(categories).join("text")
    .attr("class", "association-axis association-y")
    .attr("x", margin.left - 12).attr("y", d => y(d) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").text(d => d);

  svg.append("g").selectAll("circle").data(visible).join("circle")
    .attr("class", "association-dot")
    .attr("cx", d => x(d.process) + x.bandwidth() / 2)
    .attr("cy", d => y(d.category) + y.bandwidth() / 2)
    .attr("r", d => radius(d.value))
    .attr("fill", d => color(d.category))
    .on("mouseenter", (event, d) => showTip(event, `<strong>${esc(d.category)} → ${esc(d.process)}</strong>`
      + `<span class="tip-category">${d.value.toFixed(1)} weighted source records · mean constancy ${Math.round(constancyOf(d.category) * 100)}/100</span>`
      + `<span>${esc(uniqueBy(d.examples, value => value).join(" · "))}</span>`
      + (d.items.length ? `<span class="tip-extra">Items: ${esc(d.items.join(" · "))}</span>` : "")))
    .on("mousemove", moveTip).on("mouseleave", hideTip);
}

/* ------------------------------------------------------------------- rankflow */

function renderAlluvial() {
  const svg = d3.select("#alluvial");
  svg.selectAll("*").remove();
  const width = Math.max(950, $("#alluvial").clientWidth || 950);
  const height = 680;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const flows = state.data.flows.filter(visibleCompany).filter(visibleCategory)
    .filter(flow => !notReported(flow.training_category) && !notReported(flow.benchmark_category));
  const stages = ["company", "thematic", "training_category", "benchmark_category"];
  const labels = { company: "Company", thematic: "Thematic category", training_category: "Training category", benchmark_category: "Benchmark category" };

  const nodes = [];
  const nodeIds = new Map();
  const linkMap = new Map();
  const nodeFor = (stage, name) => {
    const id = `${stage}::${name}`;
    if (!nodeIds.has(id)) { nodeIds.set(id, nodes.length); nodes.push({ stage, name, total: 0 }); }
    return nodeIds.get(id);
  };
  flows.forEach(flow => stages.slice(0, -1).forEach((stage, index) => {
    const source = nodeFor(stage, flow[stage]);
    const target = nodeFor(stages[index + 1], flow[stages[index + 1]]);
    const key = `${source}::${target}`;
    if (!linkMap.has(key)) linkMap.set(key, { source, target, value: 0, stage: labels[stage] + " → " + labels[stages[index + 1]] });
    linkMap.get(key).value += flow.value;
    nodes[source].total += flow.value;
    nodes[target].total += flow.value;
  }));

  const links = [...linkMap.values()].filter(link => link.value >= 1);
  if (!links.length) {
    svg.append("text").attr("x", 20).attr("y", 45).attr("class", "sankey-label").text("No flows match the selected filters.");
    return;
  }

  let layout = d3.sankey().nodeWidth(13).nodePadding(8).extent([[12, 40], [width - 12, height - 10]]);
  if (typeof layout.nodeSort === "function") layout = layout.nodeSort((a, b) => b.value - a.value);
  const graph = layout({ nodes: nodes.map(node => ({ ...node })), links: links.map(link => ({ ...link })) });

  const stagePalettes = {
    company: ["#65B7D2", "#3B7DB8", "#8BC9B3", "#8B77B5", "#E29B72", "#6EA66D", "#D8B94C", "#C66F7A"],
    thematic: ["#F19A7D", "#9CCB89", "#E5D36B", "#72B8C7", "#C49BCB", "#E5B06B", "#8FBF9F", "#D98F8F", "#A9B7DC", "#CFC07A", "#7FC2B4"],
    training_category: ["#F4A582", "#92C5DE", "#B8E186", "#D8B365", "#C2A5CF", "#80CDC1", "#E8A0BF"],
    benchmark_category: ["#F6D55C", "#ED9B40", "#7BC8A4", "#6C91BF", "#D48FB3", "#9FBF6F"],
  };
  const stageColor = new Map();
  stages.forEach(stage => {
    const names = graph.nodes.filter(node => node.stage === stage).sort((a, b) => b.total - a.total).map(node => node.name);
    names.forEach((name, index) => stageColor.set(`${stage}::${name}`, stagePalettes[stage][index % stagePalettes[stage].length]));
  });

  svg.append("g").selectAll("text").data(stages).join("text")
    .attr("class", "sankey-stage")
    .attr("x", (_, index) => index === 0 ? 12 : index === stages.length - 1 ? width - 12 : (width - 24) * index / 3 + 12)
    .attr("text-anchor", (_, index) => index === stages.length - 1 ? "end" : "start")
    .attr("y", 20).text(stage => labels[stage]);

  const link = svg.append("g").attr("fill", "none").selectAll("path").data(graph.links).join("path")
    .attr("class", "rankflow-link").attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", d => stageColor.get(`${d.source.stage}::${d.source.name}`))
    .attr("stroke-opacity", 0.48).attr("stroke-width", d => Math.max(1, d.width));

  const node = svg.append("g").selectAll("g").data(graph.nodes).join("g").attr("class", "rankflow-node");
  node.append("rect").attr("x", d => d.x0).attr("y", d => d.y0)
    .attr("width", d => d.x1 - d.x0).attr("height", d => Math.max(1, d.y1 - d.y0)).attr("fill", "#171717");
  node.filter(d => d.y1 - d.y0 > 13).append("text").attr("class", "sankey-label")
    .attr("x", d => d.x0 < width / 2 ? d.x1 + 4 : d.x0 - 4)
    .attr("y", d => (d.y0 + d.y1) / 2 + 3)
    .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
    .text(d => d.name.length > 26 ? `${d.name.slice(0, 25)}…` : d.name);

  node.on("mouseenter", (event, d) => {
    link.attr("stroke-opacity", candidate => candidate.source === d || candidate.target === d ? 0.9 : 0.05);
    node.attr("opacity", candidate => candidate === d ? 1 : 0.25);
    showTip(event, `<strong>${esc(d.name)}</strong><span class="tip-category">${esc(labels[d.stage])}</span><span>${d.total.toFixed(1)} weighted source records</span>`);
  }).on("mousemove", moveTip).on("mouseleave", () => {
    link.attr("stroke-opacity", 0.48); node.attr("opacity", 1); hideTip();
  });

  link.on("mouseenter", (event, d) => {
    link.attr("stroke-opacity", candidate => candidate === d ? 0.96 : 0.05);
    node.attr("opacity", candidate => candidate === d.source || candidate === d.target ? 1 : 0.16);
    d3.select(event.currentTarget).raise();
    showTip(event, `<strong>${esc(d.source.name)} → ${esc(d.target.name)}</strong>`
      + `<span class="tip-category">${esc(d.stage)}</span>`
      + `<span>${d.value.toFixed(2)} weighted source records</span>`);
  }).on("mousemove", moveTip).on("mouseleave", () => {
    link.attr("stroke-opacity", 0.48); node.attr("opacity", 1); hideTip();
  });
}

/* ------------------------------------------------------------- stack figure */

function renderStackOverview() {
  const svg = d3.select("#stack-overview-svg");
  svg.selectAll("*").remove();

  const layers = [
    { title: "HIGH-LEVEL LEGISLATION AND POLICIES", items: ["Statutes", "Regulation", "International standards"] },
    { title: "DEFINITION", items: ["Company policies", "Charters & constitutions", "Model cards", "Announcements", "Repositories"] },
    { title: "TRAINING", items: ["Data curation", "Supervised training", "Preference learning", "Adversarial training", "Hard constraints", "Runtime safeguards"] },
    { title: "BENCHMARKING", items: ["Task-performance benchmarks", "Adversarial stress tests", "Interactive scenarios or simulations", "Rubric or criterion-based scoring", "Behavioral probes or audits", "Comparative or human-baseline evaluations"] },
  ];

  /* Slabs are drawn square to the page: the depth comes from an extruded black
     side and a cast shadow, not from rotating the text. */
  const width = 900;
  const railX = 52;
  const slabX = 104;
  const slabWidth = width - slabX - 34;
  const lineHeight = 23;
  const columnWidth = 250;
  const titleHeight = 34;

  let cursor = 104;
  const placed = layers.map((layer, index) => {
    const columns = Math.min(2, Math.ceil(layer.items.length / 4));
    const perColumn = Math.ceil(layer.items.length / columns);
    const height = titleHeight + perColumn * lineHeight + 16;
    const entry = { ...layer, index, columns, perColumn, y: cursor, height };
    cursor += height + 42;
    return entry;
  });
  const height = cursor + 10;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  svg.append("text").attr("class", "stack-figure-title").attr("x", width / 2).attr("y", 40).attr("text-anchor", "middle")
    .text("The AI alignment stack");
  svg.append("text").attr("class", "stack-figure-sub").attr("x", width / 2).attr("y", 68).attr("text-anchor", "middle")
    .text("where and how AI is aligned");

  svg.append("line").attr("class", "stack-rail").attr("x1", railX).attr("x2", railX)
    .attr("y1", placed[0].y + placed[0].height / 2)
    .attr("y2", placed[placed.length - 1].y + placed[placed.length - 1].height / 2);

  placed.forEach(layer => {
    const centre = layer.y + layer.height / 2;
    svg.append("circle").attr("class", "stack-number-dot").attr("cx", railX).attr("cy", centre).attr("r", 16);
    svg.append("text").attr("class", "stack-number").attr("x", railX).attr("y", centre + 4).attr("text-anchor", "middle")
      .text(String(layer.index + 1).padStart(2, "0"));

    const plate = svg.append("g");
    plate.append("rect").attr("class", "stack-shadow").attr("x", slabX + 9).attr("y", layer.y + 11)
      .attr("width", slabWidth).attr("height", layer.height).attr("rx", 14);
    plate.append("rect").attr("class", "stack-extrude").attr("x", slabX + 5).attr("y", layer.y + 6)
      .attr("width", slabWidth).attr("height", layer.height).attr("rx", 14);
    plate.append("rect").attr("class", "stack-face").attr("x", slabX).attr("y", layer.y)
      .attr("width", slabWidth).attr("height", layer.height).attr("rx", 14);
    plate.append("text").attr("class", "stack-layer-title").attr("x", slabX + 22).attr("y", layer.y + 25)
      .text(layer.title);
    plate.append("line").attr("class", "stack-divider")
      .attr("x1", slabX + 22).attr("x2", slabX + slabWidth - 22)
      .attr("y1", layer.y + titleHeight - 1).attr("y2", layer.y + titleHeight - 1);
    layer.items.forEach((item, index) => {
      const column = Math.floor(index / layer.perColumn);
      const row = index % layer.perColumn;
      plate.append("text").attr("class", "stack-layer-copy")
        .attr("x", slabX + 22 + column * columnWidth)
        .attr("y", layer.y + titleHeight + 12 + row * lineHeight)
        .text(`— ${item}`);
    });
  });
}

/* --------------------------------------------------------------- controls */

function renderLegend() {
  const categories = [...categoryColor.keys()].sort();
  const query = state.categorySearch.toLocaleLowerCase();
  const legend = $("#legend");
  legend.innerHTML = categories.filter(category => category.toLocaleLowerCase().includes(query))
    .map(category => `<div class="legend-chip ${state.categories.has(category) ? "active" : ""}" data-category="${esc(category)}"><span class="swatch" style="background:${color(category)}"></span><span>${esc(category)}</span></div>`).join("")
    || `<p class="side-hint">No category matches “${esc(state.categorySearch)}”.</p>`;
  legend.querySelectorAll(".legend-chip").forEach(node => node.addEventListener("click", () => {
    const category = node.dataset.category;
    state.categories.has(category) ? state.categories.delete(category) : state.categories.add(category);
    renderAll();
  }));
}

function renderCompanies() {
  const list = $("#company-list");
  list.innerHTML = state.data.companies.map(company => `<li class="${state.companies.has(company.id) ? "active" : ""}" data-id="${esc(company.id)}">${esc(company.label)}</li>`).join("");
  list.querySelectorAll("li").forEach(node => node.addEventListener("click", () => {
    const id = node.dataset.id;
    state.companies.has(id) ? state.companies.delete(id) : state.companies.add(id);
    renderAll();
  }));
}

function renderAll() {
  renderLegend();
  renderCompanies();
  renderDocuments();
  renderCommitments("#virtue-grid", state.data.virtues, "#virtue-count", "virtues");
  renderCommitments("#risk-grid", state.data.risks, "#risk-count", "risks");
  renderAssociation("#training-association", state.data.training, "training_category", "training_item");
  renderAssociation("#benchmark-association", state.data.benchmarking, "benchmark_category", "benchmark");
  renderAlluvial();
}

function start(data) {
  state.data = data;
  buildPalette();
  renderStackOverview();
  renderAll();

  $("#compact-commitments").addEventListener("change", event => document.body.classList.toggle("compact-commitments", event.target.checked));
  $("#show-definitions").addEventListener("change", event => document.body.classList.toggle("show-definitions", event.target.checked));
  $("#virtue-sort").addEventListener("change", event => {
    state.sort.virtues = event.target.value;
    renderCommitments("#virtue-grid", state.data.virtues, "#virtue-count", "virtues");
  });
  $("#risk-sort").addEventListener("change", event => {
    state.sort.risks = event.target.value;
    renderCommitments("#risk-grid", state.data.risks, "#risk-count", "risks");
  });
  $("#document-sort").addEventListener("change", event => { state.documentSort = event.target.value; renderDocuments(); });
  $("#association-sort").addEventListener("change", event => {
    state.associationSort = event.target.value;
    renderAssociation("#training-association", state.data.training, "training_category", "training_item");
    renderAssociation("#benchmark-association", state.data.benchmarking, "benchmark_category", "benchmark");
  });
  $("#category-search").addEventListener("input", event => { state.categorySearch = event.target.value; renderLegend(); });
  $("#reset-categories").addEventListener("click", () => { state.categories.clear(); renderAll(); });
  $("#reset-companies").addEventListener("click", () => { state.companies.clear(); renderAll(); });
  window.addEventListener("resize", () => renderAlluvial());
}

if (window.VALUE_MAP_DATA) start(window.VALUE_MAP_DATA);
else fetch("data.json").then(response => response.json()).then(start)
  .catch(error => $("#documents").insertAdjacentHTML("beforeend", `<p>Could not load the visualisation data: ${esc(error.message)}</p>`));
