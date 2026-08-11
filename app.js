const state = {
  data: null,
  companies: new Set(),
  categories: new Set(),
  categorySearch: "",
  sort: "constancy",
};

const palette = ["#d9c8ef", "#b9dfd2", "#f4d68c", "#a9d3e6", "#e9b6c2", "#c6d9a4", "#f0c5a8", "#bec6eb", "#d9d2bf", "#bdd9d7", "#e6c6dd", "#cbd4a8"];
const $ = selector => document.querySelector(selector);
const clean = value => String(value || "").trim();
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[char]));
const yearNumber = value => Number.parseInt(value, 10) || 0;
const constancyRank = value => clean(value).toLowerCase() === "constant" ? 0 : 1;
const activeCompanies = () => state.companies.size ? state.companies : new Set(state.data.companies.map(company => company.id));
const visibleCompany = row => activeCompanies().has(row.company);
const visibleCategory = row => !state.categories.size || state.categories.has(row.category);
const color = category => palette[Math.abs([...String(category)].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % palette.length];

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
}

function headings(container, label) {
  const columns = state.data.companies.filter(company => activeCompanies().has(company.id));
  container.style.gridTemplateColumns = `var(--label-w) repeat(${columns.length}, var(--col-w))`;
  container.innerHTML = `<div class="co-head spacer">${esc(label)}</div>${columns.map(company => `<div class="co-head"><span class="co-name">${esc(company.label)}</span></div>`).join("")}`;
  return columns;
}

function documentGroup(document) {
  const type = clean(document.type).toLowerCase();
  if (/policy|terms|privacy|acceptable use|data processor|commercial/.test(type)) return "Policies";
  if (/announcement|grant|initiative/.test(type)) return "Announcements / grants / initiatives";
  if (/principle|framework|charter/.test(type)) return "Principles";
  return "Model cards";
}

function renderDocuments() {
  const container = $("#document-grid");
  const columns = headings(container, "Document category");
  const groups = ["Principles", "Model cards", "Announcements / grants / initiatives", "Policies"];
  groups.forEach(groupName => {
    const label = document.createElement("div"); label.className = "cat-row-label"; label.textContent = groupName; container.append(label);
    columns.forEach(company => {
      const cell = document.createElement("div"); cell.className = "cat-cell docs-cell";
      state.data.documents
        .filter(source => visibleCompany(source) && source.company === company.id && documentGroup(source) === groupName)
        .filter(source => !state.categories.size || (source.categories || []).some(category => state.categories.has(category)))
        .sort((a,b) => yearNumber(b.year) - yearNumber(a.year) || a.title.localeCompare(b.title))
        .forEach(source => {
          const button = document.createElement("button"); button.type = "button"; button.className = "document-card";
          attachTip(button, `<strong>${esc(source.title)}</strong><span class="tip-category">${esc(groupName)} · ${esc(source.type || "Document")}</span><span>${esc(source.year || "Undated")}${source.model ? ` · ${esc(source.model)}` : ""}</span>`);
          cell.append(button);
        });
      if (!cell.childElementCount) cell.textContent = "—";
      container.append(cell);
    });
  });
}

function mergeCommitments(rows) {
  const groups = new Map();
  rows.filter(visibleCompany).filter(visibleCategory).forEach(row => {
    const key = `${row.company}\u0001${clean(row.item).toLocaleLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { company: row.company, item: row.item, occurrences: [] });
    groups.get(key).occurrences.push(row);
  });
  return [...groups.values()].map(group => {
    const relevant = state.categories.size ? group.occurrences.filter(row => state.categories.has(row.category)) : group.occurrences;
    const categoryCounts = new Map();
    relevant.forEach(row => categoryCounts.set(row.category, (categoryCounts.get(row.category) || 0) + 1));
    group.category = [...categoryCounts].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Uncategorised";
    group.constancy = relevant.some(row => clean(row.constancy).toLowerCase() === "constant") ? "Constant" : "Variable";
    group.latestYear = Math.max(0, ...relevant.map(row => yearNumber(row.document_year)));
    group.earliestYear = Math.min(...relevant.map(row => yearNumber(row.document_year)).filter(Boolean));
    group.occurrences = relevant.sort((a,b) => yearNumber(b.document_year) - yearNumber(a.document_year) || clean(a.document_title).localeCompare(clean(b.document_title)));
    return group;
  });
}

function compareCommitments(a, b) {
  if (state.sort === "name") return a.item.localeCompare(b.item);
  if (state.sort === "date-desc") return b.latestYear - a.latestYear || a.item.localeCompare(b.item);
  if (state.sort === "date-asc") return a.earliestYear - b.earliestYear || a.item.localeCompare(b.item);
  return constancyRank(a.constancy) - constancyRank(b.constancy) || a.item.localeCompare(b.item);
}

function commitmentTooltip(group) {
  const seen = new Set();
  const entries = group.occurrences.filter(row => {
    const key = `${row.document_title}\u0001${row.document_year}\u0001${row.definition}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
  return `<strong>${esc(group.item)}</strong><span class="tip-category">${esc(group.category)} · ${esc(group.constancy)} · ${entries.length} source${entries.length === 1 ? "" : "s"}</span><div class="definition-list">${entries.map(row => `<section><b>${esc(row.document_title || "Untitled document")} ${row.document_year ? `(${esc(row.document_year)})` : ""}</b><p>${esc(row.definition || "No definition disclosed in the source document.")}</p></section>`).join("")}</div>`;
}

function commitmentCard(group) {
  const card = document.createElement("button"); card.type = "button"; card.className = "value-card commitment-card"; card.style.background = color(group.category);
  const count = new Set(group.occurrences.map(row => `${row.document_title}\u0001${row.document_year}\u0001${row.definition}`)).size;
  card.innerHTML = `<span class="card-name">${esc(group.item)}</span>${count > 1 ? `<span class="source-count">${count}</span>` : ""}<span class="definition">${group.occurrences.map(row => `<b>${esc(row.document_title)}${row.document_year ? ` (${esc(row.document_year)})` : ""}</b> — ${esc(row.definition || "No definition disclosed in the source document.")}`).join("<br>")}</span>`;
  attachTip(card, commitmentTooltip(group)); return card;
}

function renderCommitments(target, rows) {
  const container = $(target), columns = headings(container, "Risk / virtue category");
  const groups = mergeCommitments(rows);
  const categories = [...new Set(groups.map(group => group.category))].map(category => {
    const members = groups.filter(group => group.category === category);
    return { category, constancy: members.some(group => group.constancy === "Constant") ? "Constant" : "Variable", latestYear: Math.max(...members.map(group => group.latestYear)), earliestYear: Math.min(...members.map(group => group.earliestYear)) };
  }).sort((a,b) => {
    if (state.sort === "name") return a.category.localeCompare(b.category);
    if (state.sort === "date-desc") return b.latestYear - a.latestYear || a.category.localeCompare(b.category);
    if (state.sort === "date-asc") return a.earliestYear - b.earliestYear || a.category.localeCompare(b.category);
    return constancyRank(a.constancy) - constancyRank(b.constancy) || a.category.localeCompare(b.category);
  });
  categories.forEach(meta => {
    const label = document.createElement("div"); label.className = "cat-row-label";
    label.innerHTML = `${esc(meta.category)}<span class="constancy">${esc(meta.constancy)}${meta.latestYear ? ` · ${meta.earliestYear === meta.latestYear ? meta.latestYear : `${meta.earliestYear}–${meta.latestYear}`}` : ""}</span>`; container.append(label);
    columns.forEach(company => {
      const cell = document.createElement("div"); cell.className = "cat-cell";
      groups.filter(group => group.company === company.id && group.category === meta.category).sort(compareCommitments).forEach(group => cell.append(commitmentCard(group)));
      if (!cell.childElementCount) cell.textContent = "—"; container.append(cell);
    });
  });
}

function processCard(row, label, extra) {
  const card = document.createElement("button"); card.type = "button"; card.className = "value-card"; card.style.background = color(row.category);
  card.innerHTML = `<span class="card-name">${esc(label)}</span>${extra ? `<span class="tiny">${esc(extra)}</span>` : ""}<span class="definition">${esc(row.definition || "No definition disclosed in the source document.")}</span>`;
  attachTip(card, `<strong>${esc(label)}</strong><span class="tip-category">${esc(row.category)}${extra ? ` · ${esc(extra)}` : ""}</span><b>${esc(row.document_title || "Untitled document")} ${row.document_year ? `(${esc(row.document_year)})` : ""}</b><p>${esc(row.definition || "No definition disclosed in the source document.")}</p>`);
  return card;
}

function renderProcess(target, rows, axis, text, extra) {
  const container = $(target), columns = headings(container, axis === "training_category" ? "Training category" : "Benchmark category");
  const filtered = rows.filter(visibleCompany).filter(visibleCategory);
  const axes = [...new Set(filtered.map(row => clean(row[axis]) || "Not reported"))].sort((a,b) => a.localeCompare(b));
  axes.forEach(axisValue => {
    const label = document.createElement("div"); label.className = "cat-row-label"; label.textContent = axisValue; container.append(label);
    columns.forEach(company => {
      const cell = document.createElement("div"); cell.className = "cat-cell"; const seen = new Set();
      filtered.filter(row => row.company === company.id && (clean(row[axis]) || "Not reported") === axisValue).forEach(row => {
        const key = `${row.source_record_id}\u0001${row[text]}`; if (seen.has(key)) return; seen.add(key); cell.append(processCard(row, row[text], row[extra]));
      });
      if (!cell.childElementCount) cell.textContent = "—"; container.append(cell);
    });
  });
}

function renderLegend() {
  const categories = [...new Set([...state.data.virtues, ...state.data.risks, ...state.data.training, ...state.data.benchmarking].map(row => row.category))].filter(Boolean).sort();
  const query = state.categorySearch.toLocaleLowerCase();
  $("#legend").innerHTML = categories.filter(category => category.toLocaleLowerCase().includes(query)).map(category => `<div class="legend-chip ${state.categories.has(category) ? "active" : ""}" data-category="${esc(category)}"><span class="swatch" style="background:${color(category)}"></span><span>${esc(category)}</span></div>`).join("");
  $("#legend").querySelectorAll(".legend-chip").forEach(node => node.addEventListener("click", () => { const category = node.dataset.category; state.categories.has(category) ? state.categories.delete(category) : state.categories.add(category); renderAll(); }));
}

function renderCompanies() {
  $("#company-list").innerHTML = state.data.companies.map(company => `<li class="${state.companies.has(company.id) ? "active" : ""}" data-id="${esc(company.id)}">${esc(company.label)}</li>`).join("");
  $("#company-list").querySelectorAll("li").forEach(node => node.addEventListener("click", () => { const id = node.dataset.id; state.companies.has(id) ? state.companies.delete(id) : state.companies.add(id); renderAll(); }));
}

function renderAlluvial() {
  const svg = d3.select("#alluvial"); svg.selectAll("*").remove();
  const width = Math.max(950, $("#alluvial").clientWidth || 950), height = 650; svg.attr("viewBox", `0 0 ${width} ${height}`);
  const flows = state.data.flows.filter(visibleCompany).filter(visibleCategory);
  const stages = ["company", "thematic", "training_category", "benchmark_category"];
  const nodes = [], links = [], nodeIds = new Map();
  const nodeFor = (stage,name) => { const id = `${stage}\u0001${name}`; if (!nodeIds.has(id)) { nodeIds.set(id,nodes.length); nodes.push({stage,name}); } return nodeIds.get(id); };
  flows.forEach(flow => stages.slice(0,-1).forEach((stage,index) => links.push({source:nodeFor(stage,flow[stage] || "Not reported"),target:nodeFor(stages[index+1],flow[stages[index+1]] || "Not reported"),value:flow.value})));
  if (!links.length) { svg.append("text").attr("x",20).attr("y",45).attr("class","sankey-label").text("No flows match the selected filters."); return; }
  const graph = d3.sankey().nodeWidth(13).nodePadding(8).extent([[12,38],[width-12,height-8]])({nodes:nodes.map(node=>({...node})),links:links.map(link=>({...link}))});
  const labels = {company:"Company",thematic:"Thematic category",training_category:"Training category",benchmark_category:"Benchmark category"};
  svg.append("g").selectAll("text").data(stages).join("text").attr("class","sankey-stage").attr("x",(_,i)=>i===0?12:i===stages.length-1?width-12:(width-24)*i/3+12).attr("text-anchor",(_,i)=>i===stages.length-1?"end":"start").attr("y",18).text(stage=>labels[stage]);
  svg.append("g").attr("fill","none").selectAll("path").data(graph.links).join("path").attr("d",d3.sankeyLinkHorizontal()).attr("stroke","#8d948e").attr("stroke-opacity",.35).attr("stroke-width",d=>Math.max(1,d.width)).on("mouseenter",(event,d)=>showTip(event,`<strong>${esc(d.source.name)} → ${esc(d.target.name)}</strong><span class="tip-category">Weighted source records</span><span>${d.value.toFixed(2)}</span>`)).on("mousemove",moveTip).on("mouseleave",hideTip);
  const node = svg.append("g").selectAll("g").data(graph.nodes).join("g");
  node.append("rect").attr("x",d=>d.x0).attr("y",d=>d.y0).attr("width",d=>d.x1-d.x0).attr("height",d=>Math.max(1,d.y1-d.y0)).attr("fill",d=>color(d.name)).attr("stroke","#1c1a18");
  node.filter(d=>d.y1-d.y0>14).append("text").attr("class","sankey-label").attr("x",d=>d.x0<width/2?d.x1+4:d.x0-4).attr("y",d=>(d.y0+d.y1)/2+3).attr("text-anchor",d=>d.x0<width/2?"start":"end").text(d=>d.name.length>25?`${d.name.slice(0,24)}…`:d.name);
}

function renderAll() {
  renderLegend(); renderCompanies(); renderDocuments();
  renderCommitments("#virtue-grid", state.data.virtues);
  renderCommitments("#risk-grid", state.data.risks);
  renderProcess("#training-grid", state.data.training, "training_category", "item", "training_item");
  renderProcess("#benchmark-grid", state.data.benchmarking, "benchmark_category", "benchmark", "item");
  renderAlluvial();
}

function start(data) {
  state.data = data; renderAll();
  $("#compact-commitments").addEventListener("change", event => document.body.classList.toggle("compact-commitments", event.target.checked));
  $("#show-definitions").addEventListener("change", event => document.body.classList.toggle("show-definitions", event.target.checked));
  $("#commitment-sort").addEventListener("change", event => { state.sort = event.target.value; renderCommitments("#virtue-grid", state.data.virtues); renderCommitments("#risk-grid", state.data.risks); });
  $("#category-search").addEventListener("input", event => { state.categorySearch = event.target.value; renderLegend(); });
  $("#reset-categories").addEventListener("click", () => { state.categories.clear(); renderAll(); });
  $("#reset-companies").addEventListener("click", () => { state.companies.clear(); renderAll(); });
}

if (window.VALUE_MAP_DATA) start(window.VALUE_MAP_DATA);
else fetch("data.json").then(response => response.json()).then(start).catch(error => $("#documents").insertAdjacentHTML("beforeend", `<p>Could not load the visualisation data: ${esc(error.message)}</p>`));
