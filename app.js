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
const stopwords = new Set("the a an and or of to in for on with by from is are was were be been being this that these those it its as at into their they we our you model models system systems may can should will would could about across when where which who how than then also such using used use".split(" "));
const definitionTokens = text => new Set(clean(text).toLocaleLowerCase().replace(/[^a-z0-9\s-]/g," ").split(/\s+/).filter(token => token.length > 2 && !stopwords.has(token)));
function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  let intersection = 0; left.forEach(token => { if (right.has(token)) intersection += 1; });
  return intersection / Math.max(1, left.size + right.size - intersection);
}
function definitionSimilarity(definitions) {
  const uniqueDefinitions = uniqueBy(definitions.map(clean).filter(Boolean), value => value);
  if (uniqueDefinitions.length < 2) return uniqueDefinitions.length ? 0.45 : 0;
  const sets = uniqueDefinitions.slice(0,20).map(definitionTokens); let sum = 0, pairs = 0;
  for (let i=0;i<sets.length;i+=1) for (let j=i+1;j<sets.length;j+=1) { sum += jaccard(sets[i],sets[j]); pairs += 1; }
  return pairs ? sum/pairs : 0;
}
function uniqueBy(values, keyFn) { const seen = new Set(); return values.filter(value => { const key=keyFn(value); if(seen.has(key)) return false; seen.add(key); return true; }); }
function scoreConstancy(company, occurrences) {
  const documents = uniqueBy(occurrences, row => row.document_id || `${row.document_title}\u0001${row.document_year}`);
  const years = documents.map(row => yearNumber(row.document_year)).filter(Boolean);
  const companyYears = state.companyYears.get(company) || {min:Math.min(...years),max:Math.max(...years)};
  const similarity = definitionSimilarity(documents.map(row => row.definition));
  const recurrence = Math.min(1, Math.log2(documents.length + 1) / Math.log2(6));
  const span = years.length > 1 ? Math.max(...years)-Math.min(...years) : 0;
  const companySpan = Math.max(1, companyYears.max-companyYears.min);
  const persistence = Math.min(1, span/companySpan);
  const firstYear = years.length ? Math.min(...years) : companyYears.max;
  const recentRarePenalty = documents.length <= 2 && firstYear >= companyYears.max-1 ? 0.18 : 0;
  const score = Math.max(0, Math.min(1, .50*similarity + .30*recurrence + .20*persistence - recentRarePenalty));
  return {score, similarity, recurrence, persistence, documents:documents.length, label:documents.length >= 2 && score >= .52 ? "Constant" : "Variable"};
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
    group.metric = scoreConstancy(group.company,relevant);
    group.constancy = group.metric.label;
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
  const metric = group.metric;
  return `<strong>${esc(group.item)}</strong><span class="tip-category">${esc(group.category)} · ${esc(group.constancy)} · constancy ${Math.round(metric.score*100)}/100</span><div class="metric-grid"><span>Definition similarity <b>${Math.round(metric.similarity*100)}</b></span><span>Document recurrence <b>${Math.round(metric.recurrence*100)}</b></span><span>Temporal persistence <b>${Math.round(metric.persistence*100)}</b></span></div><span class="tip-extra">${metric.documents} distinct document${metric.documents===1?"":"s"}. Recent, rarely appearing items receive a penalty.</span><div class="definition-list">${entries.map(row => `<section><b>${esc(row.document_title || "Untitled document")} ${row.document_year ? `(${esc(row.document_year)})` : ""}</b><p>${esc(row.definition || "No definition disclosed in the source document.")}</p></section>`).join("")}</div>`;
}

function commitmentCard(group) {
  const card = document.createElement("button"); card.type = "button"; card.className = "value-card commitment-card"; card.style.background = color(group.category);
  card.dataset.constancy = group.constancy; card.dataset.constancyScore = group.metric.score.toFixed(4);
  const count = new Set(group.occurrences.map(row => `${row.document_title}\u0001${row.document_year}\u0001${row.definition}`)).size;
  card.innerHTML = `<span class="card-name">${esc(group.item)}</span><span class="constancy-score">${Math.round(group.metric.score*100)}</span>${count > 1 ? `<span class="source-count">${count}</span>` : ""}<span class="definition">${group.occurrences.map(row => `<b>${esc(row.document_title)}${row.document_year ? ` (${esc(row.document_year)})` : ""}</b> — ${esc(row.definition || "No definition disclosed in the source document.")}`).join("<br>")}</span>`;
  attachTip(card, commitmentTooltip(group)); return card;
}

function renderCommitments(target, rows) {
  const container = $(target), columns = headings(container, "Risk / virtue category");
  const groups = mergeCommitments(rows);
  const categories = [...new Set(groups.map(group => group.category))].map(category => {
    const members = groups.filter(group => group.category === category);
    const score = members.reduce((sum,group)=>sum+group.metric.score,0)/Math.max(1,members.length);
    return { category, score, constancy:score>=.52?"Constant":"Variable", latestYear: Math.max(...members.map(group => group.latestYear)), earliestYear: Math.min(...members.map(group => group.earliestYear)) };
  }).sort((a,b) => {
    if (state.sort === "name") return a.category.localeCompare(b.category);
    if (state.sort === "date-desc") return b.latestYear - a.latestYear || a.category.localeCompare(b.category);
    if (state.sort === "date-asc") return a.earliestYear - b.earliestYear || a.category.localeCompare(b.category);
    return constancyRank(a.constancy) - constancyRank(b.constancy) || a.category.localeCompare(b.category);
  });
  categories.forEach(meta => {
    const label = document.createElement("div"); label.className = "cat-row-label";
    label.innerHTML = `${esc(meta.category)}<span class="constancy">mean constancy ${Math.round(meta.score*100)}/100 · ${esc(meta.constancy)}${meta.latestYear ? ` · ${meta.earliestYear === meta.latestYear ? meta.latestYear : `${meta.earliestYear}–${meta.latestYear}`}` : ""}</span>`; container.append(label);
    columns.forEach(company => {
      const cell = document.createElement("div"); cell.className = "cat-cell";
      groups.filter(group => group.company === company.id && group.category === meta.category).sort(compareCommitments).forEach(group => cell.append(commitmentCard(group)));
      if (!cell.childElementCount) cell.textContent = "—"; container.append(cell);
    });
  });
}

function renderAssociation(target, rows, processKey, exampleKey) {
  const svg = d3.select(target); svg.selectAll("*").remove();
  const filtered = rows.filter(visibleCompany).filter(visibleCategory).filter(row => clean(row[processKey]) && clean(row[processKey]).toLowerCase() !== "not reported");
  const bySource = d3.group(filtered,row=>row.source_record_id || `${row.company}\u0001${row.item}\u0001${row[processKey]}`);
  const pairs = new Map();
  bySource.forEach(sourceRows => {
    const uniquePairs = uniqueBy(sourceRows,row=>`${row.category}\u0001${row[processKey]}`);
    const weight = 1/Math.max(1,uniquePairs.length);
    uniquePairs.forEach(row => {
      const key = `${row.category}\u0001${row[processKey]}`;
      if(!pairs.has(key)) pairs.set(key,{category:row.category,process:row[processKey],value:0,examples:[]});
      const pair=pairs.get(key); pair.value+=weight;
      if(pair.examples.length<4) pair.examples.push(row[exampleKey] || row.item);
    });
  });
  const allPairs=[...pairs.values()];
  const categoryTotals=d3.rollup(allPairs,values=>d3.sum(values,d=>d.value),d=>d.category);
  const processTotals=d3.rollup(allPairs,values=>d3.sum(values,d=>d.value),d=>d.process);
  const minCount=3;
  const eligibleProcesses=new Set([...processTotals].filter(([,value])=>value>=minCount).map(([name])=>name));
  let eligibleCategories=[...categoryTotals].filter(([,value])=>value>=minCount || state.categories.size).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([name])=>name);
  const categorySet=new Set(eligibleCategories);
  const displayed=allPairs.filter(pair=>eligibleProcesses.has(pair.process)&&categorySet.has(pair.category)&&pair.value>=minCount);
  const processes=[...new Set(displayed.map(pair=>pair.process))].sort((a,b)=>(processTotals.get(b)||0)-(processTotals.get(a)||0));
  eligibleCategories=eligibleCategories.filter(category=>displayed.some(pair=>pair.category===category));
  if(!displayed.length){svg.attr("viewBox","0 0 900 120").append("text").attr("x",20).attr("y",52).attr("class","association-empty").text("No associations meet the minimum count under the selected filters.");return;}
  const cell=38, margin={top:180,right:28,bottom:35,left:205};
  const width=Math.max(900,margin.left+margin.right+processes.length*cell), height=margin.top+margin.bottom+eligibleCategories.length*cell;
  svg.attr("viewBox",`0 0 ${width} ${height}`).style("min-width",`${width}px`).style("height",`${height}px`);
  const x=d3.scaleBand().domain(processes).range([margin.left,width-margin.right]).padding(.12);
  const y=d3.scaleBand().domain(eligibleCategories).range([margin.top,height-margin.bottom]).padding(.12);
  const radius=d3.scaleSqrt().domain([0,d3.max(displayed,d=>d.value)]).range([3,15]);
  svg.append("g").selectAll("line.v").data(processes).join("line").attr("x1",d=>x(d)+x.bandwidth()/2).attr("x2",d=>x(d)+x.bandwidth()/2).attr("y1",margin.top-5).attr("y2",height-margin.bottom).attr("stroke","#ded7cb");
  svg.append("g").selectAll("line.h").data(eligibleCategories).join("line").attr("x1",margin.left).attr("x2",width-margin.right).attr("y1",d=>y(d)+y.bandwidth()/2).attr("y2",d=>y(d)+y.bandwidth()/2).attr("stroke","#ded7cb");
  svg.append("g").selectAll("text").data(processes).join("text").attr("class","association-axis association-x").attr("transform",d=>`translate(${x(d)+x.bandwidth()/2},${margin.top-12}) rotate(-48)`).attr("text-anchor","start").text(d=>d);
  svg.append("g").selectAll("text").data(eligibleCategories).join("text").attr("class","association-axis association-y").attr("x",margin.left-10).attr("y",d=>y(d)+y.bandwidth()/2+4).attr("text-anchor","end").text(d=>d);
  svg.append("g").selectAll("circle").data(displayed).join("circle").attr("class","association-dot").attr("cx",d=>x(d.process)+x.bandwidth()/2).attr("cy",d=>y(d.category)+y.bandwidth()/2).attr("r",d=>radius(d.value)).attr("fill",d=>color(d.category)).on("mouseenter",(event,d)=>showTip(event,`<strong>${esc(d.category)} → ${esc(d.process)}</strong><span class="tip-category">${d.value.toFixed(1)} weighted source records</span><span>${esc(uniqueBy(d.examples,value=>value).join(" · "))}</span>`)).on("mousemove",moveTip).on("mouseleave",hideTip);
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

function renderStackOverview() {
  const svg=d3.select("#stack-overview-svg"); svg.selectAll("*").remove(); svg.attr("viewBox","0 0 920 700");
  const layers=[
    {title:"HIGH-LEVEL LEGISLATION AND POLICIES",lines:["Statutes · regulation · international standards"]},
    {title:"DEFINITION",lines:["Company policies · charters & constitutions","Model cards · announcements · repositories"]},
    {title:"TRAINING",lines:["Data curation · supervised training · preference learning","Adversarial training · hard constraints · runtime safeguards"]},
    {title:"BENCHMARKING",lines:["Task performance · adversarial stress tests · scenarios","Rubric scoring · behavioral probes · human baselines"]},
  ];
  const g=svg.append("g").attr("transform","translate(55,22)");
  layers.forEach((layer,index)=>{
    const y=index*160+42, x=index*22;
    if(index<layers.length-1) g.append("path").attr("d",`M${430+x},${y+105} C${440+x},${y+140} ${455+x+22},${y+145} ${465+x+22},${y+160}`).attr("fill","none").attr("stroke","#b3a999").attr("stroke-width",2).attr("stroke-dasharray","4 5");
    g.append("text").attr("class","stack-layer-title").attr("x",x+18).attr("y",y-10).text(layer.title);
    g.append("polygon").attr("class","stack-shadow").attr("points",`${x+16},${y+91} ${x+700},${y+91} ${x+650},${y+124} ${x+66},${y+124}`);
    g.append("polygon").attr("class","stack-front").attr("points",`${x+16},${y+72} ${x+650},${y+72} ${x+650},${y+102} ${x+66},${y+102}`);
    g.append("polygon").attr("class","stack-side").attr("points",`${x+650},${y} ${x+704},${y+32} ${x+650},${y+102} ${x+650},${y+72}`);
    g.append("polygon").attr("class","stack-top").attr("points",`${x+66},${y} ${x+650},${y} ${x+704},${y+32} ${x+650},${y+72} ${x+16},${y+72}`);
    layer.lines.forEach((line,lineIndex)=>g.append("text").attr("class","stack-layer-copy").attr("x",x+90).attr("y",y+31+lineIndex*20).text(line));
    g.append("text").attr("class","stack-layer-number").attr("x",x+40).attr("y",y+47).text(String(index+1).padStart(2,"0"));
  });
}

function renderAlluvial() {
  const svg = d3.select("#alluvial"); svg.selectAll("*").remove();
  const width = Math.max(950, $("#alluvial").clientWidth || 950), height = 650; svg.attr("viewBox", `0 0 ${width} ${height}`);
  const flows = state.data.flows.filter(visibleCompany).filter(visibleCategory).filter(flow=>clean(flow.training_category).toLowerCase()!=="not reported"&&clean(flow.benchmark_category).toLowerCase()!=="not reported");
  const stages = ["company", "thematic", "training_category", "benchmark_category"];
  const nodes = [], nodeIds = new Map(), linkMap=new Map();
  const nodeFor = (stage,name) => { const id = `${stage}\u0001${name}`; if (!nodeIds.has(id)) { nodeIds.set(id,nodes.length); nodes.push({stage,name}); } return nodeIds.get(id); };
  flows.forEach(flow => stages.slice(0,-1).forEach((stage,index) => {
    const source=nodeFor(stage,flow[stage]),target=nodeFor(stages[index+1],flow[stages[index+1]]),key=`${source}\u0001${target}`;
    if(!linkMap.has(key)) linkMap.set(key,{source,target,value:0,stage,sourceName:flow[stage]});
    linkMap.get(key).value+=flow.value;
  }));
  const links=[...linkMap.values()].filter(link=>link.value>=1);
  if (!links.length) { svg.append("text").attr("x",20).attr("y",45).attr("class","sankey-label").text("No flows match the selected filters."); return; }
  const graph = d3.sankey().nodeWidth(13).nodePadding(8).extent([[12,38],[width-12,height-8]])({nodes:nodes.map(node=>({...node})),links:links.map(link=>({...link}))});
  const labels = {company:"Company",thematic:"Thematic category",training_category:"Training category",benchmark_category:"Benchmark category"};
  svg.append("g").selectAll("text").data(stages).join("text").attr("class","sankey-stage").attr("x",(_,i)=>i===0?12:i===stages.length-1?width-12:(width-24)*i/3+12).attr("text-anchor",(_,i)=>i===stages.length-1?"end":"start").attr("y",18).text(stage=>labels[stage]);
  const stagePalettes={company:["#65B7D2","#3B7DB8","#8BC9B3","#8B77B5","#E29B72","#6EA66D","#D8B94C","#C66F7A"],thematic:["#F19A7D","#9CCB89","#E5D36B","#72B8C7","#C49BCB","#E5B06B"],training_category:["#F4A582","#92C5DE","#B8E186","#D8B365","#C2A5CF","#80CDC1"],benchmark_category:["#F6D55C","#ED9B40","#7BC8A4","#6C91BF","#D48FB3"]};
  const stageColor=new Map(); stages.forEach(stage=>{const names=graph.nodes.filter(node=>node.stage===stage).map(node=>node.name).sort();names.forEach((name,index)=>stageColor.set(`${stage}\u0001${name}`,stagePalettes[stage][index%stagePalettes[stage].length]));});
  const link = svg.append("g").attr("fill","none").selectAll("path").data(graph.links).join("path").attr("class","rankflow-link").attr("d",d3.sankeyLinkHorizontal()).attr("stroke",d=>stageColor.get(`${d.source.stage}\u0001${d.source.name}`)).attr("stroke-opacity",.48).attr("stroke-width",d=>Math.max(1,d.width));
  const node = svg.append("g").selectAll("g").data(graph.nodes).join("g").attr("class","rankflow-node");
  node.append("rect").attr("x",d=>d.x0).attr("y",d=>d.y0).attr("width",d=>d.x1-d.x0).attr("height",d=>Math.max(1,d.y1-d.y0)).attr("fill","#171717");
  node.filter(d=>d.y1-d.y0>14).append("text").attr("class","sankey-label").attr("x",d=>d.x0<width/2?d.x1+4:d.x0-4).attr("y",d=>(d.y0+d.y1)/2+3).attr("text-anchor",d=>d.x0<width/2?"start":"end").text(d=>d.name.length>25?`${d.name.slice(0,24)}…`:d.name);
  link.on("mouseenter",(event,d)=>{link.attr("stroke-opacity",candidate => candidate === d ? .96 : .055);node.attr("opacity",candidate=>candidate===d.source||candidate===d.target?1:.16);d3.select(event.currentTarget).raise();showTip(event,`<strong>${esc(d.source.name)} → ${esc(d.target.name)}</strong><span class="tip-category">Weighted source records</span><span>${d.value.toFixed(2)}</span>`);}).on("mousemove",moveTip).on("mouseleave",()=>{link.attr("stroke-opacity",.48);node.attr("opacity",1);hideTip();});
}

function renderAll() {
  renderLegend(); renderCompanies(); renderDocuments();
  renderCommitments("#virtue-grid", state.data.virtues);
  renderCommitments("#risk-grid", state.data.risks);
  renderAssociation("#training-association", state.data.training, "training_category", "item");
  renderAssociation("#benchmark-association", state.data.benchmarking, "benchmark_category", "benchmark");
  renderAlluvial();
}

function start(data) {
  state.data = data;
  state.companyYears = new Map(data.companies.map(company=>{const years=data.documents.filter(document=>document.company===company.id).map(document=>yearNumber(document.year)).filter(Boolean);return [company.id,{min:Math.min(...years),max:Math.max(...years)}];}));
  renderStackOverview(); renderAll();
  $("#compact-commitments").addEventListener("change", event => document.body.classList.toggle("compact-commitments", event.target.checked));
  $("#show-definitions").addEventListener("change", event => document.body.classList.toggle("show-definitions", event.target.checked));
  $("#commitment-sort").addEventListener("change", event => { state.sort = event.target.value; renderCommitments("#virtue-grid", state.data.virtues); renderCommitments("#risk-grid", state.data.risks); });
  $("#category-search").addEventListener("input", event => { state.categorySearch = event.target.value; renderLegend(); });
  $("#reset-categories").addEventListener("click", () => { state.categories.clear(); renderAll(); });
  $("#reset-companies").addEventListener("click", () => { state.companies.clear(); renderAll(); });
}

if (window.VALUE_MAP_DATA) start(window.VALUE_MAP_DATA);
else fetch("data.json").then(response => response.json()).then(start).catch(error => $("#documents").insertAdjacentHTML("beforeend", `<p>Could not load the visualisation data: ${esc(error.message)}</p>`));
