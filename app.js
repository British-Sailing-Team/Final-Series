const STORAGE_KEY = "wake-regattas-v1";
const app = document.querySelector("#app");
const toast = document.querySelector("#toast");

let regattas = loadRegattas();
let currentView = "home";
let activeRegattaId = null;
let editingRegattaId = null;
let setupReturnView = "home";
let sourceMode = "website";
let pendingImport = [];
let pendingImportedRaces = [];
let pendingImportType = "fleet";
let recognition = null;
let voiceState = "idle";
let voiceStatusText = "Tap Start to begin voice recording.";
let toastTimer;

function loadRegattas() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch (error) {
    console.error("Could not read saved regattas.", error);
    return [];
  }
}

function saveRegattas() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(regattas));
    return true;
  } catch (error) {
    console.error("Could not save regattas.", error);
    showToast("Couldn't save changes on this device. Check available storage.", true);
    return false;
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function setView(view) {
  stopVoice();
  currentView = view;
  document.querySelector("#breadcrumb-current").textContent = ({
    home: "Overview", past: "Past regattas", create: "New regatta", race: "Race day", results: "Results"
  })[view] || "Overview";
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("active", link.dataset.view === (view === "past" ? "past" : "home"));
  });
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function render() {
  if (currentView === "create") return renderCreate();
  if (currentView === "race") return renderRace();
  if (currentView === "results") return renderResults();
  if (currentView === "past") return renderPast();
  renderHome();
}

function dateParts(value) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  return {
    day: date.toLocaleDateString(undefined, { day: "2-digit" }),
    month: date.toLocaleDateString(undefined, { month: "short" }).toUpperCase(),
    full: date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  };
}

function renderHome() {
  const recent = [...regattas].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  app.innerHTML = `
    <div class="welcome-row">
      <div><div class="eyebrow">WELCOME ABOARD</div><h1>Ready for race day?</h1><p class="page-subtitle">A little less admin. A lot more sailing.</p></div>
      <button class="button button-primary" data-action="create"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> New regatta</button>
    </div>
    <div class="section-heading"><div><h2>Your regattas</h2><p>Pick up where you left off.</p></div>${regattas.length ? `<button class="section-link" data-view="past">See all →</button>` : ""}</div>
    ${recent.length ? `<div class="regatta-list">${recent.map(regattaCard).join("")}</div>` : `
      <div class="empty-state"><div class="empty-symbol">⌁</div><h3>Your next great finish starts here.</h3><p>Create a regatta, add your fleet, and record results as they cross the line.</p><div class="empty-actions"><button class="button button-primary" data-action="create">Create your first regatta</button><button class="button button-secondary" data-action="show-tips">See ways to add results</button></div></div>`}`;
}

function regattaCard(regatta, allowDelete = false) {
  const date = dateParts(regatta.date);
  const status = regatta.completedAt ? "complete" : "";
  const description = [regatta.venue, `${regatta.boats.length} boats`, `${regatta.races.length} ${regatta.races.length === 1 ? "race" : "races"}`].filter(Boolean).join(" · ");
  return `<div class="regatta-card">
    <button class="regatta-open" data-open-regatta="${escapeHtml(regatta.id)}">
      <span class="regatta-date"><strong>${date.day}</strong><span>${date.month}</span></span>
      <span class="regatta-info"><strong class="regatta-name">${escapeHtml(regatta.name)}</strong><span class="regatta-description">${escapeHtml(description || date.full)}</span></span>
      <span class="status-pill ${status}">${regatta.completedAt ? "Completed" : "In progress"}</span><span class="card-arrow" aria-hidden="true">›</span>
    </button>
    ${allowDelete ? `<button class="button button-secondary regatta-delete" data-delete-regatta="${escapeHtml(regatta.id)}" aria-label="Delete ${escapeHtml(regatta.name)}">Delete</button>` : ""}
  </div>`;
}

function renderPast() {
  const sorted = [...regattas].sort((a, b) => b.createdAt - a.createdAt);
  app.innerHTML = `
    <div class="welcome-row"><div><div class="eyebrow">YOUR LOGBOOK</div><h1>Past regattas</h1><p class="page-subtitle">Every finish, ready when you need it.</p></div></div>
    <div style="margin-top:27px">${sorted.length ? `<div class="regatta-list">${sorted.map((regatta) => regattaCard(regatta, true)).join("")}</div>` : `<div class="empty-state"><div class="empty-symbol">⌁</div><h3>No regattas in your logbook yet.</h3><p>Once you create a regatta, it will be saved here on this device.</p><button class="button button-primary" data-action="create">Create a regatta</button></div>`}</div>`;
}

function renderCreate() {
  const editingRegatta = regattas.find((regatta) => regatta.id === editingRegattaId);
  pendingImport = [];
  pendingImportedRaces = [];
  pendingImportType = editingRegatta ? "starting" : "fleet";
  sourceMode = editingRegatta ? "manual" : "website";
  app.innerHTML = `
    ${editingRegatta ? `<button class="back-link" data-action="cancel-setup">← Back to regatta</button>` : `<button class="back-link" data-view="home">← Back to overview</button>`}
    <div class="eyebrow">${editingRegatta ? "REGATTA SETTINGS" : "LET'S GET STARTED"}</div><h1>${editingRegatta ? "Edit regatta setup" : "New regatta"}</h1><p class="page-subtitle">${editingRegatta ? "Update event details, sail numbers, positions, and points." : "Set up your event and bring in your fleet."}</p>
    <form id="create-form" class="form-layout">
      <section class="form-card">
        <h2>${editingRegatta ? "Event details" : "Regatta details"}</h2><p>${editingRegatta ? "Changes are saved without removing recorded race finishes." : "Just the essentials. You can update these later."}</p>
        <div class="field"><label for="regatta-name">Regatta name *</label><input id="regatta-name" name="name" required placeholder="e.g. Wednesday Night Series" maxlength="70" value="${escapeHtml(editingRegatta?.name || "")}" /></div>
        <div class="field-grid">
          <div class="field"><label for="regatta-date">Start date</label><input id="regatta-date" name="date" type="date" value="${escapeHtml(editingRegatta?.date || new Date().toISOString().slice(0, 10))}" /></div>
          <div class="field"><label for="regatta-venue">Venue</label><input id="regatta-venue" name="venue" placeholder="e.g. Harbor Bay" maxlength="70" value="${escapeHtml(editingRegatta?.venue || "")}" /></div>
        </div>
        <div class="field"><label for="race-count">Planned races</label><select id="race-count" name="raceCount">${[2, 3, 5, 6, 8, 10].map((count) => `<option value="${count}" ${(editingRegatta?.plannedRaces || 2) === count ? "selected" : ""}>${count} races</option>`).join("")}${editingRegatta && ![2, 3, 5, 6, 8, 10].includes(editingRegatta.plannedRaces) ? `<option value="${editingRegatta.plannedRaces}" selected>${editingRegatta.plannedRaces} races</option>` : ""}</select></div>
        <div class="field" style="margin-bottom:0"><label>Bring in your fleet <span style="font-weight:400;color:#95a1a5">(optional)</span></label>
          <div class="source-tabs" role="tablist">${editingRegatta ? `<span class="source-tab active">Edit fleet and starting points</span>` : `<button type="button" class="source-tab active" data-source="website">From a website</button><button type="button" class="source-tab" data-source="manual">Add manually</button>`}</div>
          <div id="source-content"></div>
        </div>
        <p id="create-error" class="validation-message"></p>
        <div class="form-footer"><button type="button" class="button button-secondary" data-action="${editingRegatta ? "cancel-setup" : "cancel-create"}">Cancel</button><button type="submit" class="button button-primary">${editingRegatta ? "Save setup changes" : "Create regatta"} <span>→</span></button></div>
      </section>
      <aside class="side-note"><div class="note-kicker">${editingRegatta ? "EDIT YOUR STANDINGS" : "ADD YOUR STARTING STANDINGS"}</div><h3>${editingRegatta ? "Change the fleet or current totals." : "Enter the fleet in a few taps."}</h3><p>${editingRegatta ? "Adjust a boat’s sail number, position, or overall points. Recorded finish orders stay linked to their boats." : "Add up to ten boats with their current position, sail number, and overall points. You can then record the next race by voice or quick tap."}</p><div class="tip-list"><div class="tip"><b>1</b><span><strong>Set the position:</strong> choose a rank from 1 to 10.</span></div><div class="tip"><b>2</b><span><strong>Add sail number and points:</strong> points are the current overall totals.</span></div><div class="tip"><b>3</b><span><strong>Keep racing:</strong> existing points carry into later standings.</span></div></div></aside>
    </form>`;
  renderSource();
}

function renderSource() {
  const target = document.querySelector("#source-content");
  if (!target) return;
  const raceCountLabel = document.querySelector('label[for="race-count"]');
  if (raceCountLabel) raceCountLabel.textContent = pendingImportType === "results" ? "Additional races to sail" : "Planned races";
  if (sourceMode === "website") {
    target.innerHTML = `
      <div class="field"><label for="source-url">Results or entry-list URL</label><input id="source-url" type="url" placeholder="https://yourclub.org/results" /><div class="field-help">Saved with this regatta as a reference. Many race sites prevent automatic imports, so copy the entrant list below.</div></div>
      <div class="field" style="margin-bottom:8px"><label for="website-paste">Paste a copied results table</label><textarea id="website-paste" placeholder="Position&#9;Sail No.&#9;Helm&#9;Net&#9;Total&#9;R1&#9;R2&#10;1&#9;ITA 75&#9;Tobia Torres&#9;43&#9;55&#9;2&#9;3"></textarea><div class="field-help">Copy the whole table from the website and paste it here. Include the header row to import existing race scores, Net, and Total.</div></div>
      <button type="button" class="button button-secondary" data-action="parse-paste">Preview table</button><div id="import-preview"></div><div class="field-help" id="import-status"></div>`;
  } else {
    const editingRegatta = regattas.find((regatta) => regatta.id === editingRegattaId);
    const currentStandings = editingRegatta ? calculateResults(editingRegatta) : [];
    const currentByBoatId = new Map(currentStandings.map((item, index) => [item.boat.id, { ...item, rank: index + 1 }]));
    const rowCount = Math.max(10, editingRegatta?.boats.length || 0);
    const positionCount = Math.max(10, editingRegatta?.boats.length || 0);
    target.innerHTML = `
      <div class="field" style="margin-bottom:8px"><label>${editingRegatta ? "Fleet and current standings" : "Starting standings"}</label><div class="field-help">Enter each boat’s current overall points. Position must be unique and between 1 and ${positionCount}.</div></div>
      <div class="manual-standings-wrap"><table class="manual-standings"><thead><tr><th>Position</th><th>Sail number</th><th>Points</th></tr></thead><tbody>${Array.from({ length: rowCount }, (_, index) => {
        const boat = editingRegatta?.boats[index];
        const standing = boat ? currentByBoatId.get(boat.id) : null;
        const selectedPosition = Number(boat?.importedPosition || boat?.initialPosition || standing?.rank || index + 1);
        const positionOptions = Array.from({ length: positionCount }, (_, position) => position + 1);
        return `<tr data-boat-id="${escapeHtml(boat?.id || "")}"><td><select aria-label="Position row ${index + 1}" data-manual-position>${positionOptions.map((position) => `<option value="${position}" ${position === selectedPosition ? "selected" : ""}>${position}</option>`).join("")}</select></td><td><input aria-label="Sail number row ${index + 1}" data-manual-sail maxlength="20" placeholder="e.g. ITA 75" value="${escapeHtml(boat?.sail || "")}" /></td><td><input aria-label="Points row ${index + 1}" data-manual-points type="number" min="0" step="any" placeholder="0" value="${boat ? escapeHtml(standing?.score ?? boat.startingPoints ?? boat.importedNet ?? "") : ""}" /></td></tr>`;
      }).join("")}</tbody></table></div>
      <button type="button" class="button button-secondary" data-action="preview-manual">${editingRegatta ? "Preview setup changes" : "Preview starting standings"}</button><div id="import-preview"></div><div class="field-help" id="import-status"></div>`;
  }
  if (pendingImport.length) {
    setImportStatus(pendingImportType === "results"
      ? `${pendingImport.length} boats and ${pendingImportedRaces.length} race scores ready to import.`
      : pendingImportType === "starting"
        ? `${pendingImport.length} starting positions ready.`
      : `${pendingImport.length} boat${pendingImport.length === 1 ? "" : "s"} ready to add.`);
    renderImportPreview();
  }
}

function setImportStatus(message, error = false) {
  const status = document.querySelector("#import-status");
  if (status) {
    status.textContent = message;
    status.style.color = error ? "#bd5344" : "#167c79";
  }
}

function parseDelimited(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function rowsToBoats(rows) {
  if (!rows.length) return [];
  const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const first = rows[0].map(normalize);
  const hasHeader = first.some((cell) => /^(sailno|sailnumber|sail|boat|boatname|yacht|helm|skipper|crew|name|entry)$/.test(cell));
  const headers = hasHeader ? first : [];
  const columnIndex = (patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  const sailHeaderIndex = columnIndex([/sail/, /^number$/, /^no$/, /^entry$/]);
  if (hasHeader && sailHeaderIndex < 0) return [];
  const sailIndex = hasHeader ? sailHeaderIndex : 0;
  const boatHeaderIndex = columnIndex([/boat/, /yacht/]);
  const helmHeaderIndex = columnIndex([/helm/, /skipper/, /^name$/]);
  const crewHeaderIndex = columnIndex([/crew/]);
  const boatIndex = hasHeader ? (boatHeaderIndex >= 0 ? boatHeaderIndex : -1) : 1;
  const helmIndex = hasHeader ? (helmHeaderIndex >= 0 ? helmHeaderIndex : -1) : 2;
  const crewIndex = hasHeader ? (crewHeaderIndex >= 0 ? crewHeaderIndex : -1) : 3;
  return rows.slice(hasHeader ? 1 : 0).map((cells) => ({
    sail: (cells[sailIndex] || "").trim(),
    name: boatIndex >= 0 ? (cells[boatIndex] || "").trim() : "",
    helm: helmIndex >= 0 ? (cells[helmIndex] || "").trim() : "",
    crew: crewIndex >= 0 ? (cells[crewIndex] || "").trim() : ""
  })).filter((boat) => boat.sail).filter((boat, index, list) =>
    list.findIndex((item) => item.sail.toLowerCase() === boat.sail.toLowerCase()) === index
  );
}

function normalizeHeader(value) {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function parseResultsTable(rows) {
  if (!rows.length) return null;
  const headers = rows[0].map(normalizeHeader);
  const raceColumns = headers.map((header, index) => {
    const match = header.match(/^(?:r|race)(\d+)$/);
    return match ? { index, number: Number(match[1]) } : null;
  }).filter(Boolean).sort((a, b) => a.number - b.number);
  if (!raceColumns.length) return null;

  const columnIndex = (patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
  const positionIndex = columnIndex([/^position$/, /^pos$/, /^place$/, /^rank$/]);
  const netIndex = columnIndex([/^net$/, /^netpoints?$/]);
  const totalIndex = columnIndex([/^total$/, /^gross$/, /^totalpoints?$/]);
  let sailIndex = columnIndex([/^sail$/, /^sailno$/, /^sailnumber$/, /^sailnum$/, /^boatno$/, /^boatnumber$/, /^natclasssailno$/]);

  if (sailIndex < 0) {
    const excluded = new Set([positionIndex, netIndex, totalIndex, ...raceColumns.map((column) => column.index)]);
    let bestCount = 0;
    rows.slice(1).forEach((row) => row.forEach((value, index) => {
      if (excluded.has(index)) return;
      const candidate = value.trim();
      if (/^(?:[a-z]{2,4}\s*)?\d{1,5}[a-z]?$/i.test(candidate)) {
        const count = rows.slice(1).filter((entry) => /^(?:[a-z]{2,4}\s*)?\d{1,5}[a-z]?$/i.test((entry[index] || "").trim())).length;
        if (count > bestCount) {
          bestCount = count;
          sailIndex = index;
        }
      }
    }));
  }
  if (sailIndex < 0) return { error: "Could not identify sail numbers. Include a Sail No. column in the table." };

  const boatNameIndex = columnIndex([/^(?:boat|yacht)(?:name)?$/]);
  const helmIndex = columnIndex([/helm|skipper|sailor|competitor|^name$/]);
  const crewIndex = columnIndex([/^crew$/]);
  const followingColumns = headers.map((_, index) => index).filter((index) =>
    index > sailIndex && index !== netIndex && index !== totalIndex && !raceColumns.some((race) => race.index === index)
  );
  const inferredNameIndex = followingColumns.find((index) => index !== positionIndex && index !== boatNameIndex && index !== helmIndex && index !== crewIndex);
  const nameIndex = boatNameIndex >= 0 ? boatNameIndex : (helmIndex < 0 ? inferredNameIndex : -1);
  const competitorIndex = helmIndex >= 0 ? helmIndex : (nameIndex < 0 ? inferredNameIndex : -1);
  const sourceRows = rows.slice(1).filter((row) => row[sailIndex]?.trim());
  const boats = sourceRows.map((row) => ({
    sail: (row[sailIndex] || "").trim(),
    name: nameIndex >= 0 ? (row[nameIndex] || "").trim() : "",
    helm: competitorIndex >= 0 ? (row[competitorIndex] || "").trim() : "",
    crew: crewIndex >= 0 ? (row[crewIndex] || "").trim() : "",
    importedPosition: positionIndex >= 0 ? (row[positionIndex] || "").trim() : "",
    importedNet: netIndex >= 0 ? (row[netIndex] || "").trim() : "",
    importedTotal: totalIndex >= 0 ? (row[totalIndex] || "").trim() : "",
    importedScores: raceColumns.map((column) => (row[column.index] || "").trim())
  }));
  const duplicateSail = boats.find((boat, index) =>
    boats.findIndex((item) => item.sail.toLocaleLowerCase() === boat.sail.toLocaleLowerCase()) !== index
  );
  if (duplicateSail) return { error: `Sail number ${duplicateSail.sail} appears more than once. Remove duplicates and try again.` };
  if (!boats.length) return { error: "No boat rows with sail numbers were found in that table." };
  return {
    boats,
    races: raceColumns.map((column) => `Race ${column.number}`),
    hasNet: netIndex >= 0,
    hasTotal: totalIndex >= 0
  };
}

function renderImportPreview() {
  const preview = document.querySelector("#import-preview");
  if (!preview || !pendingImport.length) return;
  const scoreHeaders = pendingImportedRaces.slice(0, 3).map((name) => `<th>${escapeHtml(name.replace(/^race\s*/i, "R"))}</th>`).join("");
  const sample = pendingImport.slice(0, 4);
  const raceCountLabel = document.querySelector('label[for="race-count"]');
  if (raceCountLabel) raceCountLabel.textContent = pendingImportType === "results" ? "Additional races to sail" : "Planned races";
  preview.innerHTML = `<div class="import-preview">
    <div class="import-preview-heading"><strong>${pendingImportType === "results" ? "Results detected" : pendingImportType === "starting" ? "Starting standings" : "Fleet detected"}</strong><span>${pendingImport.length} boats${pendingImportType === "results" ? ` · ${pendingImportedRaces.length} races` : ""}</span></div>
    ${pendingImportType === "results" ? `<div class="table-wrap"><table><thead><tr><th>Sail no.</th><th>Boat / helm</th>${scoreHeaders}<th>Net</th></tr></thead><tbody>${sample.map((boat) => `<tr><td><strong>${escapeHtml(boat.sail)}</strong></td><td>${escapeHtml(boat.name || boat.helm || "—")}</td>${boat.importedScores.slice(0, 3).map((score) => `<td>${escapeHtml(score || "—")}</td>`).join("")}<td>${escapeHtml(boat.importedNet || "—")}</td></tr>`).join("")}</tbody></table></div>` : pendingImportType === "starting" ? `<div class="table-wrap"><table><thead><tr><th>Position</th><th>Sail number</th><th>Points</th></tr></thead><tbody>${sample.map((boat) => `<tr><td>${escapeHtml(boat.initialPosition)}</td><td><strong>${escapeHtml(boat.sail)}</strong></td><td>${escapeHtml(boat.startingPoints)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="import-preview-fleet">${sample.map((boat) => `<span><strong>${escapeHtml(boat.sail)}</strong>${escapeHtml(boat.name || boat.helm ? ` · ${boat.name || boat.helm}` : "")}</span>`).join("")}</div>`}
    ${pendingImport.length > sample.length ? `<div class="import-preview-more">and ${pendingImport.length - sample.length} more boats</div>` : ""}
  </div>`;
}

function previewManualStandings() {
  const rows = [...document.querySelectorAll(".manual-standings tbody tr")];
  const boats = rows.map((row) => ({
    id: row.dataset.boatId || "",
    initialPosition: Number(row.querySelector("[data-manual-position]").value),
    sail: row.querySelector("[data-manual-sail]").value.trim(),
    startingPoints: row.querySelector("[data-manual-points]").value.trim()
  })).filter((boat) => boat.sail);
  const error = (message) => {
    pendingImport = [];
    pendingImportedRaces = [];
    pendingImportType = "fleet";
    setImportStatus(message, true);
    document.querySelector("#import-preview")?.replaceChildren();
  };
  if (!boats.length) return error("Enter at least one sail number.");
  if (boats.some((boat) => !Number.isInteger(boat.initialPosition) || boat.initialPosition < 1 || boat.initialPosition > 10)) {
    return error("Choose a position from 1 to 10 for each boat.");
  }
  if (boats.some((boat) => boat.startingPoints === "" || !Number.isFinite(Number(boat.startingPoints)) || Number(boat.startingPoints) < 0)) {
    return error("Enter valid overall points (0 or higher) for each boat.");
  }
  const positions = boats.map((boat) => boat.initialPosition);
  if (new Set(positions).size !== positions.length) return error("Each boat needs a different position.");
  const sails = boats.map((boat) => boat.sail.toLocaleLowerCase());
  if (new Set(sails).size !== sails.length) return error("Each boat needs a different sail number.");
  const editingRegatta = regattas.find((regatta) => regatta.id === editingRegattaId);
  pendingImport = boats.map((boat) => {
    const existing = editingRegatta?.boats.find((item) => item.id === boat.id);
    return {
      ...existing,
      ...boat,
      id: existing?.id || boat.id || "",
      startingPoints: Number(boat.startingPoints),
      importedPosition: String(boat.initialPosition),
      importedNet: String(boat.startingPoints),
      importedTotal: String(boat.startingPoints)
    };
  });
  pendingImportedRaces = [];
  pendingImportType = "starting";
  setImportStatus(`${pendingImport.length} starting positions ready.`);
  renderImportPreview();
  return true;
}

function addImportedBoats(text) {
  const rows = parseDelimited(text);
  const results = parseResultsTable(rows);
  if (results?.error) {
    pendingImport = [];
    pendingImportedRaces = [];
    pendingImportType = "fleet";
    setImportStatus(results.error, true);
    document.querySelector("#import-preview")?.replaceChildren();
    return;
  }
  if (results) {
    pendingImport = results.boats;
    pendingImportedRaces = results.races;
    pendingImportType = "results";
  } else {
    pendingImport = rowsToBoats(rows);
    pendingImportedRaces = [];
    pendingImportType = "fleet";
  }
  if (!pendingImport.length) {
    pendingImportType = "fleet";
    setImportStatus("No sail numbers found. Add a sail-number column, or enter one per row.", true);
    document.querySelector("#import-preview")?.replaceChildren();
    return;
  }
  setImportStatus(pendingImportType === "results"
    ? `${pendingImport.length} boats and ${pendingImportedRaces.length} race scores ready to import.`
    : `${pendingImport.length} boat${pendingImport.length === 1 ? "" : "s"} ready to add.`);
  renderImportPreview();
}

function createRegatta(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const sourceUrl = document.querySelector("#source-url")?.value.trim() || "";
  if (!name) return;
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    const error = document.querySelector("#create-error");
    error.textContent = "Enter a full website address starting with http:// or https://.";
    error.style.display = "block";
    return;
  }
  const createdAt = Date.now();
  const boats = pendingImport.map((boat) => ({
    ...boat,
    id: `${createdAt}-${Math.random().toString(36).slice(2)}`
  }));
  const races = pendingImportedRaces.map((name, raceIndex) => ({
    name,
    imported: true,
    importedScores: boats.map((boat) => ({ boatId: boat.id, value: boat.importedScores[raceIndex] || "" })),
    finishes: [],
    savedAt: new Date(createdAt).toISOString()
  }));
  const regatta = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    date: String(formData.get("date") || new Date().toISOString().slice(0, 10)),
    venue: String(formData.get("venue") || "").trim(),
    plannedRaces: Number(formData.get("raceCount") || 2) + pendingImportedRaces.length,
    sourceUrl,
    boats,
    races,
    currentRace: races.length,
    createdAt,
    completedAt: null
  };
  regattas.unshift(regatta);
  saveRegattas();
  activeRegattaId = regatta.id;
  showToast(pendingImportType === "results"
    ? `${regatta.boats.length} boats and ${races.length} races imported. Ready for the next race.`
    : pendingImportType === "starting"
      ? `${regatta.boats.length} boats and starting points added. Ready for race day.`
    : regatta.boats.length ? `${regatta.boats.length} boats added. You're ready to race.` : "Regatta created. Add your fleet to get started.");
  setView("race");
}

function updateRegattaSetup(form) {
  const regatta = regattas.find((item) => item.id === editingRegattaId);
  if (!regatta || !pendingImport.length || pendingImportType !== "starting") return;
  const formData = new FormData(form);
  const importedResults = regatta.races.some((race) => race.imported);
  const oldBoatIds = new Set(regatta.boats.map((boat) => boat.id));
  const boats = pendingImport.map((entry) => {
    const existing = regatta.boats.find((boat) => boat.id === entry.id);
    const boat = {
      ...existing,
      ...entry,
      id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sail: entry.sail.trim(),
      initialPosition: entry.initialPosition
    };
    if (importedResults) {
      boat.importedPosition = String(entry.initialPosition);
      boat.importedNet = String(entry.startingPoints);
      boat.importedTotal = String(entry.startingPoints);
    } else {
      const pointsFromSavedRaces = regatta.races.reduce((sum, race) => {
        if (race.imported || !race.savedAt) return sum;
        const finishIndex = race.finishes.findIndex((finish) => finish.boatId === boat.id);
        return sum + (finishIndex >= 0 ? finishIndex + 1 : regatta.boats.length + 1);
      }, 0);
      boat.startingPoints = Number(entry.startingPoints) - pointsFromSavedRaces;
    }
    return boat;
  });
  const retainedBoatIds = new Set(boats.map((boat) => boat.id));
  for (const race of regatta.races) {
    race.finishes = race.finishes.filter((finish) => retainedBoatIds.has(finish.boatId));
    if (race.imported) {
      race.importedScores = race.importedScores.filter((score) => retainedBoatIds.has(score.boatId));
      for (const boat of boats) {
        if (!oldBoatIds.has(boat.id)) race.importedScores.push({ boatId: boat.id, value: "" });
      }
    }
  }
  regatta.name = String(formData.get("name") || "").trim();
  regatta.date = String(formData.get("date") || regatta.date);
  regatta.venue = String(formData.get("venue") || "").trim();
  regatta.plannedRaces = Math.max(Number(formData.get("raceCount") || 2), regatta.races.length);
  regatta.boats = boats;
  regatta.currentRace = Math.min(Number(regatta.currentRace || 0), Math.max(regatta.plannedRaces - 1, 0));
  saveRegattas();
  activeRegattaId = regatta.id;
  editingRegattaId = null;
  const returnView = setupReturnView;
  showToast("Regatta setup updated. Recorded races were kept.");
  setView(returnView === "results" || returnView === "race" ? returnView : (regatta.completedAt ? "results" : "race"));
}

function openRegattaSetup() {
  const regatta = activeRegatta();
  if (!regatta) return;
  editingRegattaId = regatta.id;
  setupReturnView = currentView;
  pendingImport = [];
  pendingImportedRaces = [];
  pendingImportType = "starting";
  setView("create");
}

function cancelRegattaSetup() {
  editingRegattaId = null;
  pendingImport = [];
  pendingImportedRaces = [];
  setView(setupReturnView);
}

function activeRegatta() {
  return regattas.find((regatta) => regatta.id === activeRegattaId);
}

function getRace(regatta, index) {
  return regatta.races[index] || { name: `Race ${index + 1}`, finishes: [], startedAt: null };
}

function renderRace() {
  const regatta = activeRegatta();
  if (!regatta) return setView("home");
  if (regatta.completedAt) return setView("results");
  const raceIndex = Math.max(0, Number(regatta.currentRace || 0));
  const race = getRace(regatta, raceIndex);
  const isAmending = Boolean(race.savedAt && !race.imported);
  const completedBoatIds = new Set(race.finishes.map((finish) => finish.boatId));
  const boats = [...regatta.boats].sort((a, b) => a.sail.localeCompare(b.sail, undefined, { numeric: true }));
  app.innerHTML = `
    <div class="race-topline"><button data-view="home">Overview</button><span>›</span><span>${escapeHtml(regatta.name)}</span></div>
    <div class="race-title-row"><div><div class="eyebrow">ON THE WATER</div><h1>${escapeHtml(regatta.name)}</h1><p class="page-subtitle">${escapeHtml(regatta.venue || dateParts(regatta.date).full)} · ${boats.length} boat${boats.length === 1 ? "" : "s"}</p></div><div class="race-nav"><select id="race-select" aria-label="Select race">${Array.from({ length: Math.max(regatta.plannedRaces || 1, regatta.races.length + 1) }, (_, index) => `<option value="${index}" ${index === raceIndex ? "selected" : ""}>Race ${index + 1}${regatta.races[index] ? " · recorded" : ""}</option>`).join("")}</select><button class="button button-secondary" data-action="edit-setup">Edit setup</button><button class="button button-secondary" data-view="results">Results</button></div></div>
    <div class="race-layout">
      <section class="race-panel">
        <div class="race-panel-header"><h2>${isAmending ? `Amend ${escapeHtml(race.name)}` : `Record ${escapeHtml(race.name)}`}</h2><span>${race.finishes.length} finish${race.finishes.length === 1 ? "" : "es"} recorded${isAmending ? " · editing saved results" : ""}</span></div>
        <div class="voice-card"><div class="voice-row"><div><p class="voice-title">Hands-free voice entry</p><p class="voice-caption">Say the number part of the sail ID. Country codes and names are ignored.</p></div><div class="voice-controls"><button id="voice-start" class="button button-primary" data-action="voice-start" ${voiceState === "listening" ? "disabled" : ""}>Start</button><button id="voice-pause" class="button button-secondary" data-action="voice-pause" ${voiceState !== "listening" ? "disabled" : ""}>Pause</button><button id="voice-stop" class="button button-secondary" data-action="voice-stop" ${voiceState === "idle" ? "disabled" : ""}>Stop</button></div></div><div id="transcript" class="transcript" aria-live="polite">${escapeHtml(voiceStatusText)}</div><div id="voice-warning"></div></div>
        <div class="quick-label"><strong>Quick tap</strong><span>Tap a sail number to record a finish</span></div>
        <div class="boat-grid">${boats.length ? boats.map((boat) => `<button class="boat-button" data-finish="${escapeHtml(boat.id)}" ${completedBoatIds.has(boat.id) ? "disabled" : ""}><strong>${escapeHtml(boat.sail)}${completedBoatIds.has(boat.id) ? '<span class="done-mark">✓</span>' : ""}</strong><span>${escapeHtml(boat.name || boat.helm || "Tap to record")}</span></button>`).join("") : `<div class="finish-empty" style="grid-column:1/-1">No boats yet. Add them below, or enter each sail number manually.</div>`}</div>
        <div class="race-actions"><button class="button button-secondary" data-action="add-boat">＋ Add a boat</button><button class="button button-secondary" data-action="undo-finish" ${race.finishes.length ? "" : "disabled"}>↶ Undo last finish</button><button class="button button-primary" data-action="save-race">${isAmending ? "Save amendments →" : "Save race results →"}</button></div>
      </section>
      <div class="race-side-stack">
        <section class="race-panel"><div class="race-panel-header"><h2>Finish order</h2><span>${race.finishes.length} / ${boats.length}</span></div><div class="finish-list">${race.finishes.length ? race.finishes.map((finish, index) => finishRow(finish, index, regatta)).join("") : `<div class="finish-empty">No finishes yet.<br>Tap a boat or use voice entry.</div>`}</div></section>
        <aside class="race-instructions"><h3>${isAmending ? "Amend this race" : "On-the-water tip"}</h3><p>${isAmending ? "Use the ↑ and ↓ controls to correct finishing places, × to remove a finish, or tap an unrecorded boat to add it. Save amendments when the order is right." : "Tap Start, then say the number only—for example, <b>“seventy-five”</b> for sail ID ITA 75. Country codes and boat names are ignored. Pause to resume later, or Stop when you are done."}</p></aside>
      </div>
    </div>`;
  const warning = document.querySelector("#voice-warning");
  if (!supportsVoiceRecognition()) {
    warning.innerHTML = `<div class="voice-unavailable">Voice recognition isn't available in this browser. Try Chrome, or tap sail numbers to record finishes.</div>`;
  }
  updateVoiceControls();
}

function finishRow(finish, index, regatta) {
  const boat = regatta.boats.find((item) => item.id === finish.boatId);
  return `<div class="finish-row"><span class="position-badge">${index + 1}</span><div class="finish-details"><strong>${escapeHtml(boat?.sail || "Unknown sail")}${boat?.name ? ` · ${escapeHtml(boat.name)}` : ""}</strong><span>${escapeHtml(finish.time || "")}${finish.source === "voice" ? " · Voice" : ""}</span></div><div class="finish-row-actions"><button class="reorder-finish" aria-label="Move ${escapeHtml(boat?.sail || "boat")} up" data-move-finish="${escapeHtml(finish.boatId)}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button><button class="reorder-finish" aria-label="Move ${escapeHtml(boat?.sail || "boat")} down" data-move-finish="${escapeHtml(finish.boatId)}" data-direction="1" ${index === getRace(regatta, Number(regatta.currentRace || 0)).finishes.length - 1 ? "disabled" : ""}>↓</button><button class="remove-finish" aria-label="Remove finish for ${escapeHtml(boat?.sail || "boat")}" data-remove-finish="${escapeHtml(finish.boatId)}">×</button></div></div>`;
}

function recordFinish(boatId, source = "tap") {
  const regatta = activeRegatta();
  if (!regatta) return;
  const raceIndex = Math.max(0, Number(regatta.currentRace || 0));
  if (!regatta.races[raceIndex]) regatta.races[raceIndex] = { name: `Race ${raceIndex + 1}`, finishes: [], startedAt: new Date().toISOString() };
  const race = regatta.races[raceIndex];
  if (race.finishes.some((finish) => finish.boatId === boatId)) {
    showToast("That boat is already in this finish order.", true);
    return;
  }
  race.finishes.push({ boatId, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), source });
  saveRegattas();
  renderRace();
}

function undoLastFinish() {
  const regatta = activeRegatta();
  if (!regatta) return;
  const race = getRace(regatta, Number(regatta.currentRace || 0));
  const finish = race.finishes.pop();
  if (!finish) return;
  saveRegattas();
  renderRace();
  const boat = regatta.boats.find((item) => item.id === finish.boatId);
  showToast(`Undid last finish${boat ? ` for ${boat.sail}` : ""}.`);
}

function stopVoice() {
  const activeRecognition = recognition;
  recognition = null;
  voiceState = "idle";
  voiceStatusText = "Voice recording stopped.";
  if (activeRecognition) {
    activeRecognition.onend = null;
    activeRecognition.stop();
  }
}

function updateVoiceControls() {
  const start = document.querySelector("#voice-start");
  const pause = document.querySelector("#voice-pause");
  const stop = document.querySelector("#voice-stop");
  const transcript = document.querySelector("#transcript");
  start?.toggleAttribute("disabled", voiceState === "listening" || !supportsVoiceRecognition());
  pause?.toggleAttribute("disabled", voiceState !== "listening");
  stop?.toggleAttribute("disabled", voiceState === "idle");
  transcript?.classList.toggle("voice-paused", voiceState === "paused");
  if (transcript) transcript.textContent = voiceStatusText;
}

function supportsVoiceRecognition() {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

function startVoice() {
  if (recognition || voiceState === "listening") return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return showToast("Voice recognition isn't supported in this browser.", true);
  const speech = new SpeechRecognition();
  speech.continuous = true;
  speech.interimResults = true;
  speech.lang = navigator.language || "en-US";
  recognition = speech;
  voiceState = "listening";
  voiceStatusText = "Listening… say a sail number or boat name.";
  updateVoiceControls();
  speech.onresult = (event) => {
    if (recognition !== speech || voiceState !== "listening") return;
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript.trim();
      if (event.results[index].isFinal) {
        voiceStatusText = `Heard: “${text}”`;
        matchSpokenBoat(text);
      } else interim += text;
    }
    if (interim) voiceStatusText = `Listening: “${interim}”`;
    updateVoiceControls();
  };
  speech.onerror = (event) => {
    if (recognition !== speech) return;
    if (event.error !== "no-speech" && event.error !== "aborted") {
      voiceStatusText = `Voice error: ${event.error}. You can still tap boats.`;
      updateVoiceControls();
      showToast(`Voice input: ${event.error}. You can still tap boats.`, true);
    }
  };
  speech.onend = () => {
    if (recognition === speech) {
      recognition = null;
      voiceState = "idle";
      voiceStatusText = "Voice recording ended. Press Start to record again.";
      updateVoiceControls();
    }
  };
  try {
    speech.start();
  } catch (error) {
    console.error("Could not start voice recognition.", error);
    recognition = null;
    voiceState = "idle";
    voiceStatusText = "Could not start voice recognition.";
    updateVoiceControls();
    showToast("Couldn't start voice recognition. Check microphone permissions or tap a boat instead.", true);
  }
}

function pauseVoice() {
  if (voiceState !== "listening") return;
  const activeRecognition = recognition;
  recognition = null;
  voiceState = "paused";
  voiceStatusText = "Paused. Press Start to continue listening.";
  updateVoiceControls();
  activeRecognition?.stop();
}

function updateFinishPosition(boatId, direction) {
  const regatta = activeRegatta();
  if (!regatta) return;
  const race = getRace(regatta, Number(regatta.currentRace || 0));
  const index = race.finishes.findIndex((finish) => finish.boatId === boatId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= race.finishes.length) return;
  [race.finishes[index], race.finishes[destination]] = [race.finishes[destination], race.finishes[index]];
  saveRegattas();
  renderRace();
}

function spokenNumberCandidates(transcript) {
  const numberWords = {
    zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000
  };
  const tokens = transcript.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((token) => token !== "and")
    .filter((token) => Object.hasOwn(numberWords, token) || /^\d+$/.test(token));
  if (!tokens.length) return [];

  const values = tokens.map((token) => /^\d+$/.test(token) ? Number(token) : numberWords[token]);
  const candidates = [];
  const addCandidate = (value) => {
    const candidate = String(value);
    if (/^\d+$/.test(candidate) && !candidates.includes(candidate)) candidates.push(candidate);
  };

  if (tokens.length === 1 && /^\d+$/.test(tokens[0])) addCandidate(tokens[0]);
  if (values.every((value) => value >= 0 && value <= 9)) addCandidate(values.join(""));

  if (values[0] >= 1 && values[0] <= 9 && values[1] >= 20 && values[1] <= 90 && values[1] % 10 === 0) {
    const remainder = values.slice(1).reduce((sum, value) => sum + value, 0);
    addCandidate(`${values[0]}${remainder}`);
  }

  let total = 0;
  let current = 0;
  for (const value of values) {
    if (value === 100) current = Math.max(current, 1) * 100;
    else if (value === 1000) {
      total += Math.max(current, 1) * 1000;
      current = 0;
    } else current += value;
  }
  addCandidate(total + current);
  return candidates;
}

function matchSpokenBoat(transcript) {
  const regatta = activeRegatta();
  if (!regatta) return;
  const race = getRace(regatta, Number(regatta.currentRace || 0));
  const available = regatta.boats.filter((boat) => !race.finishes.some((finish) => finish.boatId === boat.id));
  const candidates = spokenNumberCandidates(transcript);
  if (!candidates.length) {
    showToast(`Didn't hear a sail number in “${transcript}”. Say the number only, or tap a boat.`, true);
    return;
  }
  let matched;
  for (const spokenNumber of candidates) {
    const matches = available.filter((boat) => {
      const sailNumber = boat.sail.replace(/\D/g, "");
      return sailNumber && sailNumber === spokenNumber;
    });
    if (matches.length > 1) {
      showToast(`More than one boat has sail number ${spokenNumber}. Tap the correct boat.`, true);
      return;
    }
    if (matches.length === 1) {
      matched = matches[0];
      break;
    }
  }
  if (matched) {
    recordFinish(matched.id, "voice");
    voiceStatusText = `Recorded ${matched.sail}${matched.name ? ` · ${matched.name}` : ""}.${voiceState === "paused" ? " Press Start to continue." : " Keep listening or press Stop."}`;
    updateVoiceControls();
  } else showToast(`No boat matches the number heard in “${transcript}”. Say it another way or tap a boat.`, true);
}

function saveRace() {
  const regatta = activeRegatta();
  if (!regatta) return;
  const index = Number(regatta.currentRace || 0);
  const race = getRace(regatta, index);
  if (!race.finishes.length) return showToast("Record at least one finish before saving.", true);
  const isAmending = Boolean(race.savedAt);
  regatta.races[index] = { ...race, name: `Race ${index + 1}`, savedAt: new Date().toISOString() };
  if (!isAmending) {
    if (regatta.races.some((item) => item.imported)) regatta.currentRace = index + 1;
    else if (index + 1 < (regatta.plannedRaces || 1)) regatta.currentRace = index + 1;
  }
  saveRegattas();
  showToast(isAmending ? `Race ${index + 1} amendments saved.` : `Race ${index + 1} saved. Results are up to date.`);
  setView("results");
}

function openRaceForAmendment() {
  const regatta = activeRegatta();
  const select = document.querySelector("#amend-race-select");
  if (!regatta || !select) return;
  if (regatta.completedAt) regatta.completedAt = null;
  regatta.currentRace = Number(select.value);
  saveRegattas();
  voiceStatusText = "Tap Start to begin voice recording.";
  setView("race");
}

function calculateResults(regatta) {
  const boats = regatta.boats;
  const hasImportedResults = regatta.races.some((race) => race.imported);
  const hasStartingStandings = !hasImportedResults && boats.some((boat) => Number.isFinite(Number(boat.startingPoints)));
  const hasNewRaceData = regatta.races.some((race) => !race.imported && race.finishes.length);
  const standings = boats.map((boat) => {
    const importedScores = (boat.importedScores || []).map((value) => Number.parseFloat(value)).filter(Number.isFinite);
    const derivedNet = importedScores.reduce((sum, value) => sum + value, 0);
    let score = hasImportedResults
      ? (boat.importedNet !== "" && Number.isFinite(Number(boat.importedNet)) ? Number(boat.importedNet) : derivedNet)
      : hasStartingStandings ? Number(boat.startingPoints || 0) : 0;
    let totalScore = hasImportedResults
      ? (boat.importedTotal !== "" && Number.isFinite(Number(boat.importedTotal)) ? Number(boat.importedTotal) : score)
      : hasStartingStandings ? Number(boat.startingPoints || 0) : 0;
    let racesCounted = 0;
    const places = regatta.races.map((race) => {
      if (race.imported) {
        const imported = race.importedScores.find((item) => item.boatId === boat.id);
        const value = imported?.value || "";
        if (value) racesCounted += 1;
        return value || "—";
      }
      const index = race.finishes.findIndex((finish) => finish.boatId === boat.id);
      if (!race.savedAt && index < 0) return "—";
      racesCounted += 1;
      const place = index >= 0 ? index + 1 : boats.length + 1;
      score += place;
      totalScore += place;
      return index >= 0 ? String(place) : race.savedAt ? "DNF" : "—";
    });
    return { boat, score, totalScore, racesCounted, places };
  });
  return standings.sort((a, b) => {
    if ((hasImportedResults || hasStartingStandings) && !hasNewRaceData) {
      const positionDiff = Number(hasImportedResults ? a.boat.importedPosition : a.boat.initialPosition)
        - Number(hasImportedResults ? b.boat.importedPosition : b.boat.initialPosition);
      if (Number.isFinite(positionDiff) && positionDiff !== 0) return positionDiff;
    }
    return a.score - b.score || a.boat.sail.localeCompare(b.boat.sail, undefined, { numeric: true });
  });
}

function renderResults() {
  const regatta = activeRegatta();
  if (!regatta) return setView("home");
  const standings = calculateResults(regatta);
  const hasImportedResults = regatta.races.some((race) => race.imported);
  const hasStartingStandings = !hasImportedResults && regatta.boats.some((boat) => Number.isFinite(Number(boat.startingPoints)));
  const hasNewRaceData = regatta.races.some((race) => !race.imported && race.finishes.length);
  const currentRaceIndex = Number(regatta.currentRace || 0);
  const activeRace = getRace(regatta, currentRaceIndex);
  const hasUnsavedFinishes = activeRace.finishes.length > 0 && !activeRace.savedAt;
  const raceCount = Math.max(regatta.races.length, 1);
  const raceHeaders = Array.from({ length: raceCount }, (_, index) => `<th>R${index + 1}</th>`).join("");
  const pointsHeader = hasStartingStandings
    ? `<th>Position</th><th>Sail no.</th><th>Boat</th><th>Helm</th><th>Points</th>${raceHeaders}`
    : `<th>Position</th><th>Sail no.</th><th>Boat</th><th>Helm</th><th>Net</th><th>Total</th>${raceHeaders}`;
  const pointsRows = (item, index) => {
    const position = hasStartingStandings && !hasNewRaceData
      ? item.boat.initialPosition
      : hasImportedResults && !hasNewRaceData && item.boat.importedPosition
        ? escapeHtml(item.boat.importedPosition)
        : index + 1;
    const points = item.racesCounted || hasStartingStandings ? item.score : "—";
    const races = Array.from({ length: raceCount }, (_, raceIndex) => `<td>${escapeHtml(item.places[raceIndex] || "—")}</td>`).join("");
    if (hasStartingStandings) {
      return `<tr class="${index === 0 ? "leader-row" : ""}"><td class="rank-cell">${position}</td><td><strong>${escapeHtml(item.boat.sail)}</strong></td><td>${escapeHtml(item.boat.name || "—")}</td><td>${escapeHtml(item.boat.helm || "—")}</td><td class="score-cell">${points}</td>${races}</tr>`;
    }
    return `<tr class="${index === 0 ? "leader-row" : ""}"><td class="rank-cell">${position}</td><td><strong>${escapeHtml(item.boat.sail)}</strong></td><td>${escapeHtml(item.boat.name || "—")}</td><td>${escapeHtml(item.boat.helm || "—")}</td><td class="score-cell">${item.racesCounted ? item.score : "—"}</td><td class="score-cell">${item.racesCounted ? item.totalScore : "—"}</td>${races}</tr>`;
  };
  const editableRaces = regatta.races.map((race, index) => ({ race, index }))
    .filter(({ race }) => race.savedAt && !race.imported && race.finishes.length);
  app.innerHTML = `
    <div class="race-topline"><button data-view="home">Overview</button><span>›</span><span>${escapeHtml(regatta.name)}</span></div>
    <div class="race-title-row"><div><div class="eyebrow">LIVE STANDINGS</div><h1>${escapeHtml(regatta.name)}</h1><p class="page-subtitle">${escapeHtml(regatta.venue || dateParts(regatta.date).full)} · Low-point scoring · ${regatta.boats.length} boats</p></div><div class="results-actions">${regatta.completedAt ? `<span class="race-progress"><i></i> Regatta complete</span>` : `<span class="race-progress"><i></i> ${regatta.races.filter((race) => race.savedAt).length} races saved</span><button class="button button-primary" data-view="race">${hasUnsavedFinishes ? "Continue recording →" : "Record finishes →"}</button>`}</div></div>
    <section class="results-panel">
      <div class="results-toolbar"><div><strong>Overall results</strong><span>${hasStartingStandings ? "Starting points are the current totals; later race scores are added to these values." : hasImportedResults ? "Imported Net and Total are preserved; new races are added to the series." : "Lowest total score leads. Unfinished boats score DNF (fleet size + 1)."}</span></div><div class="results-toolbar-actions"><button class="button button-secondary" data-action="export-results">Export results (CSV)</button><button class="button button-secondary" data-action="edit-setup">Edit setup</button>${editableRaces.length ? `<label class="sr-only" for="amend-race-select">Race to amend</label><select id="amend-race-select" class="race-nav-select">${editableRaces.map(({ race, index }) => `<option value="${index}" ${index === regatta.currentRace ? "selected" : ""}>${escapeHtml(race.name || `Race ${index + 1}`)}</option>`).join("")}</select><button class="button button-secondary" data-action="amend-race">Amend results</button>` : ""}<button class="button button-secondary" data-action="complete-regatta">${regatta.completedAt ? "Reopen regatta" : "Finish regatta"}</button></div></div>
      <div class="table-wrap"><table><thead><tr>${pointsHeader}</tr></thead><tbody>${standings.length ? standings.map(pointsRows).join("") : `<tr><td colspan="${(hasStartingStandings ? 5 : 6) + raceCount}" style="text-align:center;padding:30px;color:#879599">Add boats and record a finish to see standings.</td></tr>`}</tbody></table></div>
      <div class="results-footer"><span><b>Scoring:</b> ${hasStartingStandings ? "Starting points carry forward; new races add low-point scores. DNF scores fleet size + 1." : hasImportedResults ? "Imported values are kept as shown. New races use low-point scoring; DNF scores fleet size + 1." : "Low point · DNF scores fleet size + 1 · Ties share the same total"}</span><span>${regatta.sourceUrl ? `Source: ${escapeHtml(sourceHostname(regatta.sourceUrl))}` : "Saved on this device"}</span></div>
    </section>
    ${!regatta.boats.length ? `<div class="empty-state" style="margin-top:16px"><h3>Add your fleet to calculate standings.</h3><p>Add boats manually or paste an entry list from a race website.</p><button class="button button-primary" data-action="add-boat">＋ Add a boat</button></div>` : ""}`;
}

function exportResults() {
  const regatta = activeRegatta();
  if (!regatta) return showToast("Couldn't find this regatta to export.", true);

  const standings = calculateResults(regatta);
  const hasImportedResults = regatta.races.some((race) => race.imported);
  const hasStartingStandings = !hasImportedResults && regatta.boats.some((boat) => Number.isFinite(Number(boat.startingPoints)));
  const hasNewRaceData = regatta.races.some((race) => !race.imported && race.finishes.length);
  const raceCount = Math.max(regatta.races.length, 1);
  const headers = hasStartingStandings
    ? ["Position", "Sail no.", "Boat", "Helm", "Points"]
    : ["Position", "Sail no.", "Boat", "Helm", "Net", "Total"];
  headers.push(...Array.from({ length: raceCount }, (_, index) => `R${index + 1}`));

  const rows = standings.map((item, index) => {
    const position = hasStartingStandings && !hasNewRaceData
      ? item.boat.initialPosition
      : hasImportedResults && !hasNewRaceData && item.boat.importedPosition
        ? item.boat.importedPosition
        : index + 1;
    const row = [
      position,
      item.boat.sail,
      item.boat.name || "—",
      item.boat.helm || "—"
    ];
    if (hasStartingStandings) {
      row.push(item.racesCounted || hasStartingStandings ? item.score : "—");
    } else {
      row.push(item.racesCounted ? item.score : "—", item.racesCounted ? item.totalScore : "—");
    }
    row.push(...Array.from({ length: raceCount }, (_, raceIndex) => item.places[raceIndex] || "—"));
    return row;
  });
  const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const fileName = `Final-Series-${regatta.name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "regatta"}-results.csv`;
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Results exported as CSV.");
}

function sourceHostname(value) {
  try {
    return new URL(value).hostname;
  } catch (error) {
    console.error("Could not parse saved source URL.", error);
    return value;
  }
}

function showAddBoatModal() {
  const existing = document.querySelector(".modal-backdrop");
  existing?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal-backdrop" id="boat-modal"><form class="modal" id="boat-form"><h2>Add a boat</h2><p>Enter the sail number and any details you have. You can do this now or when they finish.</p>
      <div class="field"><label for="boat-sail">Sail number *</label><input id="boat-sail" name="sail" required maxlength="20" placeholder="e.g. 24" /></div>
      <div class="field"><label for="boat-name">Boat name</label><input id="boat-name" name="name" maxlength="60" placeholder="e.g. Sea Breeze" /></div>
      <div class="field-grid"><div class="field"><label for="boat-helm">Helm</label><input id="boat-helm" name="helm" maxlength="50" /></div><div class="field"><label for="boat-crew">Crew</label><input id="boat-crew" name="crew" maxlength="50" /></div></div>
      <p class="validation-message" id="boat-error"></p><div class="form-footer"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Add boat</button></div></form></div>`);
  document.querySelector("#boat-sail").focus();
}

function addBoat(form) {
  const regatta = activeRegatta();
  if (!regatta) return;
  const data = new FormData(form);
  const sail = String(data.get("sail") || "").trim();
  const error = document.querySelector("#boat-error");
  if (regatta.boats.some((boat) => boat.sail.toLowerCase() === sail.toLowerCase())) {
    error.textContent = "That sail number is already in this regatta.";
    error.style.display = "block";
    return;
  }
  regatta.boats.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sail, name: String(data.get("name") || "").trim(), helm: String(data.get("helm") || "").trim(), crew: String(data.get("crew") || "").trim()
  });
  saveRegattas();
  document.querySelector("#boat-modal")?.remove();
  render();
  showToast(`Boat ${sail} added.`);
}

function completeRegatta() {
  const regatta = activeRegatta();
  if (!regatta) return;
  if (regatta.completedAt) {
    regatta.completedAt = null;
    saveRegattas();
    renderResults();
    showToast("Regatta reopened.");
    return;
  }
  if (!regatta.races.some((race) => race.savedAt)) {
    return showToast("Save at least one race before finishing the regatta.", true);
  }
  const activeRace = getRace(regatta, Number(regatta.currentRace || 0));
  if (activeRace.finishes.length && !activeRace.savedAt) {
    return showToast("Save the current race before finishing the regatta.", true);
  }
  regatta.completedAt = new Date().toISOString();
  saveRegattas();
  renderResults();
  showToast("Regatta finished. Final standings are ready.");
}

function handleClick(event) {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    return setView(viewButton.dataset.view);
  }
  const deleteButton = event.target.closest("[data-delete-regatta]");
  if (deleteButton) {
    const regatta = regattas.find((item) => item.id === deleteButton.dataset.deleteRegatta);
    if (!regatta || !window.confirm(`Delete "${regatta.name}" and all of its race results? This cannot be undone.`)) return;
    const previousRegattas = regattas;
    regattas = regattas.filter((item) => item.id !== regatta.id);
    if (!saveRegattas()) {
      regattas = previousRegattas;
      return;
    }
    if (activeRegattaId === regatta.id) activeRegattaId = null;
    renderPast();
    return showToast(`"${regatta.name}" was deleted.`);
  }
  const openCard = event.target.closest("[data-open-regatta]");
  if (openCard) {
    activeRegattaId = openCard.dataset.openRegatta;
    const regatta = activeRegatta();
    if (regatta) setView(regatta.completedAt ? "results" : "race");
    return;
  }
  const finish = event.target.closest("[data-finish]");
  if (finish) return recordFinish(finish.dataset.finish);
  const removeFinish = event.target.closest("[data-remove-finish]");
  if (removeFinish) {
    const regatta = activeRegatta();
    const race = getRace(regatta, Number(regatta.currentRace || 0));
    race.finishes = race.finishes.filter((item) => item.boatId !== removeFinish.dataset.removeFinish);
    saveRegattas();
    return renderRace();
  }
  const moveFinish = event.target.closest("[data-move-finish]");
  if (moveFinish) return updateFinishPosition(moveFinish.dataset.moveFinish, Number(moveFinish.dataset.direction));
  const source = event.target.closest("[data-source]");
  if (source) {
    sourceMode = source.dataset.source;
    pendingImport = [];
    pendingImportedRaces = [];
    pendingImportType = "fleet";
    document.querySelectorAll(".source-tab").forEach((tab) => tab.classList.toggle("active", tab === source));
    return renderSource();
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "create") {
    editingRegattaId = null;
    return setView("create");
  }
  if (action === "edit-setup") return openRegattaSetup();
  if (action === "cancel-setup") return cancelRegattaSetup();
  if (action === "cancel-create") {
    pendingImport = [];
    pendingImportedRaces = [];
    editingRegattaId = null;
    return setView("home");
  }
  if (action === "preview-manual") return previewManualStandings();
  if (action === "parse-paste") {
    const text = document.querySelector("#website-paste")?.value || "";
    return addImportedBoats(text);
  }
  if (action === "show-tips") return setView("create");
  if (action === "add-boat") return showAddBoatModal();
  if (action === "voice-start") return startVoice();
  if (action === "voice-pause") return pauseVoice();
  if (action === "voice-stop") {
    stopVoice();
    return updateVoiceControls();
  }
  if (action === "amend-race") return openRaceForAmendment();
  if (action === "export-results") return exportResults();
  if (action === "undo-finish") return undoLastFinish();
  if (action === "close-modal") return document.querySelector("#boat-modal")?.remove();
  if (action === "save-race") return saveRace();
  if (action === "complete-regatta") return completeRegatta();
}

document.addEventListener("click", handleClick);
document.addEventListener("submit", (event) => {
  if (event.target.id === "create-form") {
    event.preventDefault();
    if (editingRegattaId) {
      if (previewManualStandings()) updateRegattaSetup(event.target);
      return;
    }
    if (sourceMode === "manual" && document.querySelector("[data-manual-sail]")?.value.trim()) {
      if (!previewManualStandings()) return;
    }
    createRegatta(event.target);
  } else if (event.target.id === "boat-form") {
    event.preventDefault();
    addBoat(event.target);
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "race-select") {
    const regatta = activeRegatta();
    const nextIndex = Number(event.target.value);
    regatta.currentRace = nextIndex;
    saveRegattas();
    return renderRace();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.target.closest?.("[data-delete-regatta]")) return;
  if (event.key === "Escape") document.querySelector("#boat-modal")?.remove();
});
render();
