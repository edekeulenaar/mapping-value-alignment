const state = {
  data: null,
  companies: new Set(),
  kinds: new Set(),
  sort: { virtue: "consistency-desc", risk: "consistency-desc" },
  documentSort: "date-desc",
  showUndisclosed: false,
};

const $ = selector => document.querySelector(selector);
const clean = value => String(value || "").trim();
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char]));
const notReported = value => !clean(value) || clean(value).toLowerCase() === "not reported";
const activeCompanies = () => state.companies.size ? state.companies : new Set(state.data.companies.map(company => company.id));
const activeKinds = () => state.kinds.size ? state.kinds : new Set(["Virtue", "Risk"]);
const pct = value => Math.round(value * 100);

/* The three parts of consistency, in the order they are argued. */
const COMPONENTS = [
  { key: "predominance", label: "Predominance", hint: "present and frequent across the companies’ documents" },
  { key: "generality", label: "Generality", hint: "defined in the same terms from one company to the next" },
  { key: "consistency", label: "Consistency", hint: "recurs steadily inside each company’s own corpus" },
];

/* ------------------------------------------------------------------ tooltip */

function moveTip(event) {
  const node = $("#tooltip");
  node.style.left = `${Math.max(8, Math.min(window.innerWidth - node.offsetWidth - 14, event.clientX + 14))}px`;
  node.style.top = `${Math.max(8, Math.min(window.innerHeight - node.offsetHeight - 12, event.clientY + 14))}px`;
}
function showTip(event, html) { const node = $("#tooltip"); node.innerHTML = html; node.classList.add("visible"); moveTip(event); }
function hideTip() { $("#tooltip").classList.remove("visible"); }

/* --------------------------------------------- how each company words it */

const VERBATIM_LENGTH = 132;
const VERBATIM_IDEAL = 150;   // a definition-shaped sentence, not a fragment or a procedure

function shorten(text, limit) {
  const value = clean(text);
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > limit * 0.6 ? boundary : limit).replace(/[,;:.\s]+$/, "")}…`;
}

/* Generality is the claim that companies do or do not mean the same thing.
   The hover puts their own wording side by side so the claim can be checked. */
function verbatimByCompany(rows) {
  const byCompany = new Map();
  rows.forEach(row => {
    const text = clean(row.definition);
    if (text.length < 25) return;
    const list = byCompany.get(row.company) || [];
    if (list.some(entry => entry.text.toLowerCase() === text.toLowerCase())) return;
    list.push({ text, title: clean(row.document_title), year: clean(row.document_year) });
    byCompany.set(row.company, list);
  });
  const present = state.data.companies.filter(company => byCompany.has(company.id));
  /* Keep the hover to one screen: two quotations while few companies speak,
     one each once the whole field does. */
  const perCompany = present.length > 4 ? 1 : 2;
  return present.map(company => {
    const all = byCompany.get(company.id)
      .sort((a, b) => Math.abs(a.text.length - VERBATIM_IDEAL) - Math.abs(b.text.length - VERBATIM_IDEAL));
    return { company: company.label, entries: all.slice(0, perCompany), more: Math.max(0, all.length - perCompany) };
  });
}

function verbatimHtml(rows) {
  const groups = verbatimByCompany(rows);
  if (!groups.length) return "";
  return `<div class="tip-verbatim"><h5>How each company puts it</h5>`
    + groups.map(group => `<section><b>${esc(group.company)}</b>`
      + group.entries.map(entry => `<p>“${esc(shorten(entry.text, VERBATIM_LENGTH))}”`
        + `<cite>${esc(shorten(entry.title, 46))}${entry.year ? `, ${esc(entry.year)}` : ""}</cite></p>`).join("")
      + (group.more ? `<p class="tip-more">+ ${group.more} more</p>` : "")
      + `</section>`).join("")
    + `</div>`;
}

/* ------------------------------------------------------- 0 · the corpus itself */

function compareDocuments(a, b) {
  const year = value => Number.parseInt(value, 10) || 0;
  if (state.documentSort === "name") return a.title.localeCompare(b.title);
  if (state.documentSort === "date-asc") return year(a.year) - year(b.year) || a.title.localeCompare(b.title);
  if (state.documentSort === "type") return clean(a.type).localeCompare(clean(b.type)) || a.title.localeCompare(b.title);
  return year(b.year) - year(a.year) || a.title.localeCompare(b.title);
}

function renderDocuments() {
  const container = $("#document-grid");
  const columns = state.data.companies;
  container.style.gridTemplateColumns = `var(--label-w) repeat(${columns.length}, var(--col-w))`;
  container.innerHTML = `<div class="co-head spacer">Document type</div>`
    + columns.map(company => `<div class="co-head"><span class="co-name">${esc(company.label)}</span></div>`).join("");

  let shown = 0;
  state.data.documentGroups.forEach(group => {
    const label = document.createElement("div");
    label.className = "cat-row-label";
    const total = state.data.documents.filter(source => source.group === group).length;
    label.innerHTML = `${esc(group)}<span class="constancy">${total} document${total === 1 ? "" : "s"}</span>`;
    container.append(label);
    columns.forEach(company => {
      const cell = document.createElement("div");
      cell.className = "cat-cell docs-cell";
      state.data.documents
        .filter(source => source.company === company.id && source.group === group)
        .sort(compareDocuments)
        .forEach(source => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "document-card";
          button.setAttribute("aria-label", `${source.title}, ${source.year || "undated"}`);
          const html = `<strong>${esc(source.title)}</strong>`
            + `<span class="tip-category">${esc(group)}</span>`
            + `<div class="metric-grid">`
            + `<span>Year <b>${esc(source.year || "undated")}</b></span>`
            + `<span>Type <b>${esc(source.type || "Document")}</b></span>`
            + `<span>Model <b>${esc(source.model || "—")}</b></span>`
            + `<span>Company <b>${esc(source.company_label)}</b></span>`
            + `</div>`
            + `<span class="tip-extra">${source.categories.length} risk / virtue categor${source.categories.length === 1 ? "y" : "ies"} coded here.</span>`;
          button.addEventListener("mouseenter", event => showTip(event, html));
          button.addEventListener("mousemove", moveTip);
          button.addEventListener("mouseleave", hideTip);
          cell.append(button);
          shown += 1;
        });
      if (!cell.childElementCount) cell.textContent = "—";
      container.append(cell);
    });
  });
  $("#document-count").textContent = `${shown} documents across ${columns.length} companies.`;
}

/* ------------------------------------- 1 & 2 · thematic families and their consistency */

function thematicRows(kind) {
  const source = kind === "virtue" ? state.data.virtues : state.data.risks;
  const records = new Map();
  source.forEach(row => {
    const entry = records.get(row.thematic) || { items: new Map(), documents: new Set(), companies: new Set(), rows: [] };
    entry.items.set(row.item, (entry.items.get(row.item) || 0) + 1);
    entry.documents.add(row.document_id);
    entry.companies.add(row.company);
    entry.rows.push(row);
    records.set(row.thematic, entry);
  });
  return [...records].map(([thematic, entry]) => ({
    thematic,
    metric: state.data.thematicConsistency[`${kind}::${thematic}`] || { score: 0, label: "Inconsistent", predominance: 0, generality: 0, consistency: 0, companies: 0, documents: 0 },
    documents: entry.documents.size,
    companies: entry.companies.size,
    records: [...entry.items.values()].reduce((sum, value) => sum + value, 0),
    examples: [...entry.items].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name]) => name),
    rows: entry.rows,
  })).filter(row => row.metric.documents > 1);
}

function sortThematic(rows, sort) {
  const copy = [...rows];
  if (sort === "consistency-asc") return copy.sort((a, b) => a.metric.score - b.metric.score || a.thematic.localeCompare(b.thematic));
  if (sort === "name") return copy.sort((a, b) => a.thematic.localeCompare(b.thematic));
  if (sort === "documents") return copy.sort((a, b) => b.documents - a.documents || a.thematic.localeCompare(b.thematic));
  return copy.sort((a, b) => b.metric.score - a.metric.score || a.thematic.localeCompare(b.thematic));
}

function renderThematic(target, kind) {
  const svg = d3.select(target);
  svg.selectAll("*").remove();
  const rows = sortThematic(thematicRows(kind), state.sort[kind]);

  const margin = { top: 40, right: 190, bottom: 40, left: 232 };
  const rowHeight = 40;
  const width = 900;
  const height = margin.top + margin.bottom + rows.length * rowHeight;
  svg.attr("viewBox", `0 0 ${width} ${height}`).style("height", `${height}px`);

  const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map(row => row.thematic)).range([margin.top, height - margin.bottom]).padding(0.34);

  /* A quiet grid, and a marked threshold: at 45 a family reads as consistent. */
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  svg.append("g").selectAll("line").data(ticks).join("line")
    .attr("x1", d => x(d)).attr("x2", d => x(d))
    .attr("y1", margin.top - 12).attr("y2", height - margin.bottom).attr("class", "bar-grid");
  svg.append("g").selectAll("text").data(ticks).join("text")
    .attr("class", "bar-axis").attr("x", d => x(d)).attr("y", margin.top - 20).attr("text-anchor", "middle")
    .text(d => pct(d));
  svg.append("line").attr("class", "bar-threshold")
    .attr("x1", x(0.45)).attr("x2", x(0.45)).attr("y1", margin.top - 12).attr("y2", height - margin.bottom);
  svg.append("text").attr("class", "bar-threshold-label")
    .attr("x", x(0.45)).attr("y", height - margin.bottom + 24).attr("text-anchor", "middle")
    .text("consistent from 45");

  rows.forEach(row => {
    const top = y(row.thematic);
    const group = svg.append("g").attr("class", "bar-row");

    group.append("text").attr("class", "bar-label")
      .attr("x", margin.left - 12).attr("y", top + y.bandwidth() / 2 + 4).attr("text-anchor", "end")
      .text(row.thematic);

    /* Each segment is one third of one component, so the bar's full length is
       the score and its composition shows what produced it. */
    let cursor = 0;
    COMPONENTS.forEach(component => {
      const value = (row.metric[component.key] || 0) / 3;
      group.append("rect").attr("class", `bar-segment seg-${component.key}`)
        .attr("x", x(cursor)).attr("y", top)
        .attr("width", Math.max(0, x(cursor + value) - x(cursor))).attr("height", y.bandwidth());
      cursor += value;
    });
    group.append("rect").attr("class", "bar-outline")
      .attr("x", x(0)).attr("y", top).attr("width", x(cursor) - x(0)).attr("height", y.bandwidth());

    group.append("text").attr("class", "bar-value")
      .attr("x", x(cursor) + 10).attr("y", top + y.bandwidth() / 2 + 4)
      .text(`${pct(row.metric.score)} · ${row.metric.label.toLowerCase()}`);
    group.append("text").attr("class", "bar-scale")
      .attr("x", width - margin.right + 108).attr("y", top + y.bandwidth() / 2 + 4)
      .text(`${row.companies} co · ${row.documents} docs`);

    const html = `<strong>${esc(row.thematic)}</strong>`
      + `<span class="tip-category">${kind === "virtue" ? "Virtue" : "Risk"} family · ${esc(row.metric.label)} · consistency ${pct(row.metric.score)}/100</span>`
      + `<div class="metric-grid">${COMPONENTS.map(component =>
        `<span>${component.label} <b>${pct(row.metric[component.key] || 0)}</b></span>`).join("")}</div>`
      + `<span class="tip-extra">Named by ${row.companies} of ${state.data.companies.length} companies, in ${row.documents} of ${state.data.documents.length} documents, over ${row.records} coded statements.</span>`
      + `<div class="tip-items">${esc(row.examples.join(" · "))}</div>`
      + verbatimHtml(row.rows);
    group.on("mouseenter", event => showTip(event, html)).on("mousemove", moveTip).on("mouseleave", hideTip);
  });

  $(`#${kind}-count`).textContent = `${rows.length} families · ${rows.filter(row => row.metric.label === "Consistent").length} consistent.`;
}

/* ------------------------------- 1 & 2 · the extremes, named one by one, as chips */

const CHIP_MIN_DOCUMENTS = 3;

function renderChips(target, kind) {
  const source = kind === "virtue" ? state.data.virtues : state.data.risks;
  const seen = new Map();
  source.forEach(row => {
    const entry = seen.get(row.category) || { items: new Map(), companies: new Set(), rows: [] };
    entry.items.set(row.item, (entry.items.get(row.item) || 0) + 1);
    entry.companies.add(row.company);
    entry.rows.push(row);
    seen.set(row.category, entry);
  });

  /* Named in at least three documents, so that "least consistent" reports a
     category the field has actually tried to state, not a single stray mention. */
  const ranked = [...seen].map(([category, entry]) => ({
    category,
    metric: state.data.categoryConsistency[`${kind}::${category}`],
    examples: [...entry.items].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name),
    rows: entry.rows,
  })).filter(row => row.metric && row.metric.documents >= CHIP_MIN_DOCUMENTS)
    .sort((a, b) => b.metric.score - a.metric.score);

  const groups = [
    { title: "Most consistent", rows: ranked.slice(0, 5) },
    { title: "Least consistent", rows: ranked.slice(-5).reverse() },
  ];

  const container = $(target);
  container.innerHTML = "";
  groups.forEach(group => {
    const block = document.createElement("div");
    block.className = "chip-group";
    const heading = document.createElement("h4");
    heading.textContent = group.title;
    block.append(heading);
    const strip = document.createElement("div");
    strip.className = "chip-strip";
    group.rows.forEach(row => {
      const metric = row.metric;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "consistency-chip";
      /* Shaded by score on the same scale as the bars above it. */
      const light = 88 - metric.score * 62;
      chip.style.background = `hsl(203 22% ${light}%)`;
      chip.style.color = light < 55 ? "#fdfbf7" : "var(--ink)";
      chip.innerHTML = `<span class="chip-name">${esc(row.category)}</span><span class="chip-score">${pct(metric.score)}</span>`;
      const html = `<strong>${esc(row.category)}</strong>`
        + `<span class="tip-category">${kind === "virtue" ? "Virtue" : "Risk"} · ${esc(metric.label)} · consistency ${pct(metric.score)}/100</span>`
        + `<div class="metric-grid">${COMPONENTS.map(component =>
          `<span>${component.label} <b>${pct(metric[component.key] || 0)}</b></span>`).join("")}</div>`
        + `<span class="tip-extra">Named by ${metric.companies} of ${state.data.companies.length} companies, in ${metric.documents} document${metric.documents === 1 ? "" : "s"}.</span>`
        + `<div class="tip-items">${esc(row.examples.join(" · "))}</div>`
        + verbatimHtml(row.rows);
      chip.addEventListener("mouseenter", event => showTip(event, html));
      chip.addEventListener("mousemove", moveTip);
      chip.addEventListener("mouseleave", hideTip);
      strip.append(chip);
    });
    block.append(strip);
    container.append(block);
  });
}

/* --------------------------------------------------------- 3 · the rankflow */

const STAGES = ["company", "kind", "thematic", "training_category", "benchmark_category"];
const STAGE_LABELS = {
  company: "Company",
  kind: "Virtue or risk",
  thematic: "Thematic category",
  training_category: "Training",
  benchmark_category: "Benchmark",
};

function renderAlluvial() {
  const svg = d3.select("#alluvial");
  svg.selectAll("*").remove();
  const width = Math.max(1000, $("#alluvial").clientWidth || 1000);
  const height = 720;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const flows = state.data.flows
    .filter(flow => activeCompanies().has(flow.company))
    .filter(flow => activeKinds().has(flow.kind))
    .filter(flow => state.showUndisclosed || (!notReported(flow.training_category) && !notReported(flow.benchmark_category)));

  const nodes = [];
  const nodeIds = new Map();
  const linkMap = new Map();
  const nodeFor = (stage, name) => {
    const id = `${stage}::${name}`;
    if (!nodeIds.has(id)) { nodeIds.set(id, nodes.length); nodes.push({ stage, name, total: 0 }); }
    return nodeIds.get(id);
  };
  flows.forEach(flow => STAGES.slice(0, -1).forEach((stage, index) => {
    const next = STAGES[index + 1];
    const source = nodeFor(stage, flow[stage]);
    const target = nodeFor(next, flow[next]);
    const key = `${source}::${target}`;
    if (!linkMap.has(key)) linkMap.set(key, { source, target, value: 0, stage: `${STAGE_LABELS[stage]} → ${STAGE_LABELS[next]}` });
    linkMap.get(key).value += flow.value;
    nodes[source].total += flow.value;
    nodes[target].total += flow.value;
  }));

  const links = [...linkMap.values()].filter(link => link.value >= 0.75);
  if (!links.length) {
    svg.append("text").attr("x", 20).attr("y", 46).attr("class", "sankey-label").text("No flows match the current selection.");
    return;
  }

  let layout = d3.sankey().nodeWidth(12).nodePadding(9).extent([[10, 44], [width - 10, height - 12]]);
  if (typeof layout.nodeSort === "function") layout = layout.nodeSort((a, b) => b.value - a.value);
  const graph = layout({ nodes: nodes.map(node => ({ ...node })), links: links.map(link => ({ ...link })) });

  const palettes = {
    company: ["#65B7D2", "#3B7DB8", "#8BC9B3", "#8B77B5", "#E29B72", "#6EA66D", "#D8B94C", "#C66F7A"],
    kind: ["#7FA9C9", "#D98F6E"],
    thematic: ["#F19A7D", "#9CCB89", "#E5D36B", "#72B8C7", "#C49BCB", "#E5B06B", "#8FBF9F", "#D98F8F", "#A9B7DC", "#CFC07A", "#7FC2B4"],
    training_category: ["#F4A582", "#92C5DE", "#B8E186", "#D8B365", "#C2A5CF", "#80CDC1", "#E8A0BF"],
    benchmark_category: ["#F6D55C", "#ED9B40", "#7BC8A4", "#6C91BF", "#D48FB3", "#9FBF6F"],
  };
  const stageColor = new Map();
  STAGES.forEach(stage => {
    graph.nodes.filter(node => node.stage === stage).sort((a, b) => b.total - a.total)
      .forEach((node, index) => stageColor.set(`${stage}::${node.name}`, palettes[stage][index % palettes[stage].length]));
  });

  svg.append("g").selectAll("text").data(STAGES).join("text")
    .attr("class", "sankey-stage")
    .attr("x", (_, index) => index === 0 ? 10 : index === STAGES.length - 1 ? width - 10 : (width - 20) * index / (STAGES.length - 1) + 10)
    .attr("text-anchor", (_, index) => index === STAGES.length - 1 ? "end" : "start")
    .attr("y", 22).text(stage => STAGE_LABELS[stage]);

  const link = svg.append("g").attr("fill", "none").selectAll("path").data(graph.links).join("path")
    .attr("class", "rankflow-link").attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", d => stageColor.get(`${d.source.stage}::${d.source.name}`))
    .attr("stroke-opacity", 0.46).attr("stroke-width", d => Math.max(1, d.width));

  const node = svg.append("g").selectAll("g").data(graph.nodes).join("g").attr("class", "rankflow-node");
  node.append("rect").attr("x", d => d.x0).attr("y", d => d.y0)
    .attr("width", d => d.x1 - d.x0).attr("height", d => Math.max(1, d.y1 - d.y0)).attr("fill", "#171717");
  const label = node.filter(d => d.y1 - d.y0 > 11).append("text").attr("class", "sankey-label")
    .attr("x", d => d.x0 < width / 2 ? d.x1 + 5 : d.x0 - 5)
    .attr("y", d => (d.y0 + d.y1) / 2 + 3)
    .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
    .text(d => d.name.length > 30 ? `${d.name.slice(0, 29)}…` : d.name);

  /* Hovering lifts everything the flow touches: its links keep full strength,
     and the nodes at either end have their labels brought forward rather than
     faded back with the rest. */
  function focus(activeLinks, activeNodes) {
    const linkSet = new Set(activeLinks);
    const nodeSet = new Set(activeNodes);
    link.attr("stroke-opacity", d => linkSet.has(d) ? 0.92 : 0.04);
    node.attr("opacity", d => nodeSet.has(d) ? 1 : 0.18);
    label.classed("is-focused", d => nodeSet.has(d));
    label.classed("is-dimmed", d => !nodeSet.has(d));
  }
  function clearFocus() {
    link.attr("stroke-opacity", 0.46);
    node.attr("opacity", 1);
    label.classed("is-focused", false).classed("is-dimmed", false);
    hideTip();
  }

  link.on("mouseenter", (event, d) => {
    focus([d], [d.source, d.target]);
    d3.select(event.currentTarget).raise();
    showTip(event, `<strong>${esc(d.source.name)} → ${esc(d.target.name)}</strong>`
      + `<span class="tip-category">${esc(d.stage)}</span>`
      + `<span>${d.value.toFixed(1)} weighted source records</span>`);
  }).on("mousemove", moveTip).on("mouseleave", clearFocus);

  node.on("mouseenter", (event, d) => {
    const touching = graph.links.filter(candidate => candidate.source === d || candidate.target === d);
    const ends = touching.flatMap(candidate => [candidate.source, candidate.target]);
    focus(touching, [d, ...ends]);
    showTip(event, `<strong>${esc(d.name)}</strong>`
      + `<span class="tip-category">${esc(STAGE_LABELS[d.stage])}</span>`
      + `<span>${d.total.toFixed(1)} weighted source records · ${touching.length} connections</span>`);
  }).on("mousemove", moveTip).on("mouseleave", clearFocus);
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
  svg.attr("viewBox", `0 0 ${width} ${cursor + 10}`);

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

/* ---------------------------------------------------------------- controls */

function renderCompanies() {
  const list = $("#company-list");
  list.innerHTML = state.data.companies.map(company =>
    `<li class="${state.companies.has(company.id) ? "active" : ""}" data-id="${esc(company.id)}">${esc(company.label)}</li>`).join("");
  list.querySelectorAll("li").forEach(node => node.addEventListener("click", () => {
    const id = node.dataset.id;
    state.companies.has(id) ? state.companies.delete(id) : state.companies.add(id);
    renderCompanies();
    renderAlluvial();
  }));
}

function renderKinds() {
  const list = $("#kind-list");
  list.innerHTML = ["Virtue", "Risk"].map(kind =>
    `<li class="${state.kinds.has(kind) ? "active" : ""}" data-kind="${kind}">${kind}s</li>`).join("");
  list.querySelectorAll("li").forEach(node => node.addEventListener("click", () => {
    const kind = node.dataset.kind;
    state.kinds.has(kind) ? state.kinds.delete(kind) : state.kinds.add(kind);
    renderKinds();
    renderAlluvial();
  }));
}

function renderLegend() {
  $("#component-legend").innerHTML = COMPONENTS.map(component =>
    `<div class="legend-chip static"><span class="swatch seg-${component.key}"></span><span><b>${component.label}</b> — ${component.hint}</span></div>`).join("");
}

function start(data) {
  state.data = data;
  renderStackOverview();
  renderLegend();
  renderCompanies();
  renderKinds();
  renderDocuments();
  renderThematic("#virtue-chart", "virtue");
  renderThematic("#risk-chart", "risk");
  renderChips("#virtue-chips", "virtue");
  renderChips("#risk-chips", "risk");
  renderAlluvial();

  $("#virtue-sort").addEventListener("change", event => {
    state.sort.virtue = event.target.value;
    renderThematic("#virtue-chart", "virtue");
  });
  $("#risk-sort").addEventListener("change", event => {
    state.sort.risk = event.target.value;
    renderThematic("#risk-chart", "risk");
  });
  $("#document-sort").addEventListener("change", event => {
    state.documentSort = event.target.value;
    renderDocuments();
  });
  $("#show-undisclosed").addEventListener("change", event => {
    state.showUndisclosed = event.target.checked;
    renderAlluvial();
  });
  $("#reset-companies").addEventListener("click", () => { state.companies.clear(); renderCompanies(); renderAlluvial(); });
  $("#reset-kinds").addEventListener("click", () => { state.kinds.clear(); renderKinds(); renderAlluvial(); });
  window.addEventListener("resize", () => renderAlluvial());
}

if (window.VALUE_MAP_DATA) start(window.VALUE_MAP_DATA);
else fetch("data.json").then(response => response.json()).then(start)
  .catch(error => document.body.insertAdjacentHTML("beforeend", `<p>Could not load the visualisation data: ${esc(error.message)}</p>`));
