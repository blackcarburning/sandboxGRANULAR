(function () {
  "use strict";

  const ref = window.FS7300_REFERENCE;
    const state = {
    metadata: {},
    captures: {},
    lastReport: ""
  };
  const STORAGE_KEY = "fs7300_documenter_ui_state_v1";
  const DOCX_MAX_TABLE_ROWS = 80;
  const DOCX_MAX_TABLE_COLUMNS = 8;
  const DOCX_MAX_FIELD_ROWS = 45;

  const aliases = {
    lsvolume: "lsvdisk",
    lsvolumes: "lsvdisk",
    lspool: "lsmdiskgrp",
    lsstoragepool: "lsmdiskgrp",
    lssystemips: "lssystemip",
    lspartnerships: "lspartnership"
  };
  const CRC_TABLE = buildCrcTable();

  const commandNames = new Set(ref.commands.flatMap((group) => group.commands.map((cmd) => cmd.split(/\s+/)[0])));
  (ref.fetchGroups || []).forEach((group) => group.commands.forEach((cmd) => commandNames.add(cmd.split(/\s+/)[0])));
  ref.limits.forEach((limit) => commandNames.add(limit.command));
  ["lssystemcapacity", "lsnode", "lssystem", "lseventlog"].forEach((cmd) => commandNames.add(cmd));

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  function init() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => showTab(tab.dataset.tab));
    });

    $("#parseCli").addEventListener("click", parseCapture);
    $("#selectAllGroups").addEventListener("click", () => setFetchGroups(true));
    $("#clearAllGroups").addEventListener("click", () => setFetchGroups(false));
    $("#loadSample").addEventListener("click", () => {
      $("#cliInput").value = ref.sampleCapture;
      parseCapture();
      persistUiState();
    });
    $("#clearCapture").addEventListener("click", () => {
      $("#cliInput").value = "";
      state.captures = {};
      renderAll();
      persistUiState();
    });

    $("#systemForm").addEventListener("input", () => {
      readMetadata();
      renderAll();
    });
    $("#inventorySearch").addEventListener("input", renderInventory);
    $("#inventoryFilter").addEventListener("change", renderInventory);

    $("#exportMarkdown").addEventListener("click", () => download("flashsystem-7300-documentation.md", buildMarkdownReport(), "text/markdown"));
    $("#openRestTest").addEventListener("click", () => window.open("rest-test.html", "_blank", "noopener,noreferrer"));
    $("#exportHtml").addEventListener("click", () => download("flashsystem-7300-documentation.html", buildHtmlReport(), "text/html"));
    $("#exportJson").addEventListener("click", () => download("flashsystem-7300-capture.json", JSON.stringify({ metadata: state.metadata, captures: state.captures }, null, 2), "application/json"));
    $("#generatePlinkBatch").addEventListener("click", generatePlinkBatch);
    $("#savePlinkBatch").addEventListener("click", savePlinkBatch);
    $("#importPlinkOutput").addEventListener("change", importPlinkOutput);
    $("#exportDocx").addEventListener("click", exportDocx);
    $("#copyRunbook").addEventListener("click", copyRunbook);
    $("#downloadRunbook").addEventListener("click", () => download("fs7300-collection-runbook.txt", buildRunbook(), "text/plain"));

    restoreUiState();
    initialiseMetadataDefaults();
    readMetadata();
    renderFetchGroups();
    applySavedFetchGroups();
    renderCommandMap();
    renderRunbook();
    renderInventoryFilter();
    renderAll();
    ensurePlinkBatchPreview();
    wirePersistence();
  }

  function showTab(id) {
    $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === id));
    $$(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
  }

  function readMetadata() {
    state.metadata = Object.fromEntries(new FormData($("#systemForm")).entries());
  }

  function initialiseMetadataDefaults() {
    const dateInput = $("#systemForm input[name='collectionDate']");
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
  }

  function parseCapture() {
    readMetadata();
    state.captures = parseCliText($("#cliInput").value);
    const commandCount = Object.keys(state.captures).length;
    const rowCount = Object.values(state.captures).reduce((sum, capture) => sum + capture.rows.length, 0);
    $("#parseStatus").textContent = commandCount ? `Parsed ${rowCount} rows from ${commandCount} command blocks.` : "No recognised command blocks found. Check that each output block is preceded by a line like svcinfo lssystem -delim :.";
    renderAll();
    if (rowCount > 0) showTab("overview");
    persistUiState();
  }

  function renderFetchGroups() {
    const groups = ref.fetchGroups || [];
    $("#fetchGroups").innerHTML = groups.map((group) => `
      <label class="fetch-group">
        <input type="checkbox" value="${escapeHtml(group.id)}" ${group.selected ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(group.label)}</strong>
          <span>${escapeHtml(group.description)}</span>
          <span>${group.commands.length} commands</span>
        </span>
      </label>
    `).join("");
  }

  function applySavedFetchGroups() {
    const stateData = readSavedUiState();
    if (!stateData || !Array.isArray(stateData.fetchGroups)) return;
    const selected = new Set(stateData.fetchGroups);
    $$("#fetchGroups input[type='checkbox']").forEach((input) => {
      input.checked = selected.has(input.value);
    });
  }

  function setFetchGroups(checked) {
    $$("#fetchGroups input[type='checkbox']").forEach((input) => {
      input.checked = checked;
    });
    persistUiState();
  }

  function selectedFetchGroups() {
    return $$("#fetchGroups input[type='checkbox']:checked").map((input) => input.value);
  }

  function selectedPlinkCommands() {
    const selected = new Set(selectedFetchGroups());
    const commands = [];
    const seen = new Set();
    (ref.fetchGroups || []).forEach((group) => {
      if (!selected.has(group.id)) return;
      group.commands.forEach((command) => {
        if (seen.has(command)) return;
        seen.add(command);
        commands.push(command);
      });
    });
    return commands;
  }

  function generatePlinkBatch() {
    const connection = readPlinkConnection();
    const commands = selectedPlinkCommands();
    if (!connection.address || !connection.username || !connection.password) {
      $("#plinkStatus").textContent = "Enter management IP, username and password before generating the Plink batch.";
      return;
    }
    if (!commands.length) {
      $("#plinkStatus").textContent = "Select at least one configuration area before generating the batch.";
      return;
    }
    const batch = buildPlinkBatch(connection, commands);
    $("#plinkBatchOutput").value = batch;
    persistUiState();
    const name = ($("#plinkBatchName").value || "collect_flashsystem.cmd").trim();
    $("#plinkStatus").textContent = `Generated ${commands.length}-command Plink collector in the text box. Use Save Batch if you want a Downloads copy.`;
    $("#plinkBatchOutput").focus();
    $("#plinkBatchOutput").setSelectionRange(0, 0);
  }

  function savePlinkBatch() {
    const batch = $("#plinkBatchOutput").value.trim();
    if (!batch) {
      $("#plinkStatus").textContent = "Generate the batch first, then save it to Downloads.";
      return;
    }
    const name = ($("#plinkBatchName").value || "collect_flashsystem.cmd").trim();
    download(name.endsWith(".cmd") || name.endsWith(".bat") ? name : `${name}.cmd`, batch, "application/x-msdos-program");
    $("#plinkStatus").textContent = "Batch saved to your browser's Downloads location.";
  }

  function ensurePlinkBatchPreview() {
    const batchOutput = $("#plinkBatchOutput");
    if (!batchOutput || batchOutput.value.trim()) return;
    const stateData = readSavedUiState();
    if (stateData && typeof stateData.plinkBatchOutput === "string") {
      batchOutput.value = stateData.plinkBatchOutput;
    }
  }

  function readPlinkConnection() {
    const form = $("#connectionForm");
    if (form && form.tagName === "FORM") {
      return Object.fromEntries(new FormData(form).entries());
    }
    const connection = {};
    $$(".plink-form input[name]").forEach((input) => {
      connection[input.name] = input.value;
    });
    return connection;
  }

  function wirePersistence() {
    document.addEventListener("input", onPersistableChange, true);
    document.addEventListener("change", onPersistableChange, true);
    window.addEventListener("beforeunload", persistUiState);
  }

  function onPersistableChange(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (shouldPersistTarget(target)) {
      persistUiState();
    }
  }

  function shouldPersistTarget(target) {
    if (target.tagName === "INPUT" && target.type === "file") return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
  }

  function persistUiState() {
    try {
    const payload = {
      system: formState($("#systemForm")),
      connection: formState($("#connectionForm")),
      plink: {
        plinkPath: $("#plinkPath").value,
          plinkOutput: $("#plinkOutput").value,
          plinkLog: $("#plinkLog").value,
          plinkBatchName: $("#plinkBatchName").value,
        plinkHostKey: $("#plinkHostKey").value,
        plinkBatchOutput: $("#plinkBatchOutput").value
      },
      cliInput: $("#cliInput").value,
      captures: state.captures,
      fetchGroups: selectedFetchGroups(),
      inventorySearch: $("#inventorySearch").value,
      inventoryFilter: $("#inventoryFilter").value,
      activeTab: $(".tab.active") && $(".tab.active").dataset.tab
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage failures and keep the page functional.
    }
  }

  function restoreUiState() {
    const payload = readSavedUiState();
    if (!payload) return;
    applyFormState($("#systemForm"), payload.system);
    applyFormState($("#connectionForm"), payload.connection);
    if (payload.captures && typeof payload.captures === "object") {
      state.captures = payload.captures;
    }
    if (payload.plink) {
      $("#plinkPath").value = payload.plink.plinkPath ?? $("#plinkPath").value;
      $("#plinkOutput").value = payload.plink.plinkOutput ?? $("#plinkOutput").value;
      $("#plinkLog").value = payload.plink.plinkLog ?? $("#plinkLog").value;
      $("#plinkBatchName").value = payload.plink.plinkBatchName ?? $("#plinkBatchName").value;
      $("#plinkHostKey").value = payload.plink.plinkHostKey ?? $("#plinkHostKey").value;
      $("#plinkBatchOutput").value = payload.plink.plinkBatchOutput ?? $("#plinkBatchOutput").value;
    }
    if (typeof payload.cliInput === "string") $("#cliInput").value = payload.cliInput;
    if (typeof payload.inventorySearch === "string") $("#inventorySearch").value = payload.inventorySearch;
    if (typeof payload.inventoryFilter === "string") $("#inventoryFilter").value = payload.inventoryFilter;
    if (typeof payload.activeTab === "string") showTab(payload.activeTab);
  }

  function readSavedUiState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function formState(form) {
    if (!form || form.tagName !== "FORM") return null;
    return Object.fromEntries(new FormData(form).entries());
  }

  function applyFormState(form, values) {
    if (!form || !values || typeof values !== "object") return;
    Array.from(form.elements).forEach((element) => {
      if (!element.name || !(element.name in values)) return;
      if (element.type === "file") return;
      element.value = values[element.name];
    });
  }

  function buildPlinkBatch(connection, commands) {
    const plink = batchValue($("#plinkPath").value || "plink.exe");
    const output = batchValue($("#plinkOutput").value || "flashsystem_capture.txt");
    const log = batchValue($("#plinkLog").value || "flashsystem_capture.log");
    const host = batchValue(connection.address);
    const port = batchValue(connection.port || "22");
    const user = batchValue(connection.username);
    const password = batchValue(connection.password);
    const hostKey = batchValue($("#plinkHostKey").value || "");
    const lines = [
      "@echo off",
      "setlocal EnableExtensions",
      "title FlashSystem 7300 Plink Collector",
      "rem Generated by Storwize Documentation.",
      `set "PLINK=${plink}"`,
      `set "HOST=${host}"`,
      `set "PORT=${port}"`,
      `set "USER=${user}"`,
      `set "PASSWORD=${password}"`,
      `set "HOSTKEY=${hostKey}"`,
      `set "OUTPUT=${output}"`,
      `set "LOG=${log}"`,
      "",
      "echo FlashSystem Plink collection started: %DATE% %TIME%",
      "echo Target: %HOST%:%PORT%",
      "echo Output: %CD%\\%OUTPUT%",
      "echo Log: %CD%\\%LOG%",
      "echo.",
      "> \"%OUTPUT%\" echo # FlashSystem Plink capture",
      ">> \"%OUTPUT%\" echo # Started %DATE% %TIME%",
      ">> \"%LOG%\" echo FlashSystem Plink collection log - %DATE% %TIME%",
      ""
    ];
    commands.forEach((command) => {
      lines.push(`call :run "${batchValue(command)}"`);
    });
    lines.push(
      "",
      ">> \"%OUTPUT%\" echo.",
      ">> \"%OUTPUT%\" echo # Completed %DATE% %TIME%",
      "echo.",
      "echo Collection complete.",
      "echo Import %CD%\\%OUTPUT% back into the web page.",
      "echo If commands failed, check %CD%\\%LOG%.",
      "pause",
      "exit /b 0",
      "",
      ":run",
      "set \"CMD=%~1\"",
      "echo Running svcinfo %CMD%",
      ">> \"%OUTPUT%\" echo.",
      ">> \"%OUTPUT%\" echo svcinfo %CMD%",
      ">> \"%LOG%\" echo.",
      ">> \"%LOG%\" echo ===== svcinfo %CMD% =====",
      "if \"%HOSTKEY%\"==\"\" (",
      "  \"%PLINK%\" -ssh -batch -P \"%PORT%\" -l \"%USER%\" -pw \"%PASSWORD%\" \"%HOST%\" \"svcinfo %CMD%\" >> \"%OUTPUT%\" 2>> \"%LOG%\"",
      ") else (",
      "  \"%PLINK%\" -ssh -batch -P \"%PORT%\" -hostkey \"%HOSTKEY%\" -l \"%USER%\" -pw \"%PASSWORD%\" \"%HOST%\" \"svcinfo %CMD%\" >> \"%OUTPUT%\" 2>> \"%LOG%\"",
      ")",
      "set \"RC=%ERRORLEVEL%\"",
      "if not \"%RC%\"==\"0\" (",
      "  >> \"%OUTPUT%\" echo # PLINK_EXIT %RC% svcinfo %CMD%",
      "  >> \"%LOG%\" echo Command failed with exit code %RC%",
      ")",
      "exit /b 0",
      ""
    );
    return `${lines.join("\r\n")}\r\n`;
  }

  function batchValue(value) {
    return String(value ?? "").replace(/%/g, "%%").replace(/"/g, "'");
  }

  async function importPlinkOutput(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const text = await file.text();
    $("#cliInput").value = text;
    readMetadata();
    state.captures = parseCliText(text);
    const commandCount = Object.keys(state.captures).length;
    const rowCount = Object.values(state.captures).reduce((sum, capture) => sum + capture.rows.length, 0);
    $("#parseStatus").textContent = `Imported ${rowCount} rows from ${commandCount} command blocks in ${file.name}.`;
    $("#plinkStatus").textContent = rowCount ? `Imported ${file.name}. You can now review Inventory/Report or export DOCX.` : `Imported ${file.name}, but no rows were parsed. Check that the Plink output file contains svcinfo command markers and command output.`;
    renderAll();
    if (rowCount > 0) showTab("overview");
    persistUiState();
  }

  function parseCliText(text) {
    const blocks = [];
    let current = null;

    text.split(/\r?\n/).forEach((rawLine) => {
      const line = rawLine.trimEnd();
      const detected = detectCommand(line);
      if (detected) {
        if (current && current.lines.length) blocks.push(current);
        current = { command: detected, lines: [] };
        return;
      }
      if (!current) current = { command: "unlabelled", lines: [] };
      if (line.trim()) current.lines.push(line);
    });
    if (current && current.lines.length) blocks.push(current);

    const captures = {};
    blocks.forEach((block) => {
      const command = normaliseCommand(block.command);
      if (command === "unlabelled") return;
      const parsed = parseTable(block.lines);
      if (!parsed.rows.length && !parsed.raw.length) return;
      captures[command] = captures[command] || { command, headers: parsed.headers, rows: [], raw: [] };
      captures[command].headers = parsed.headers.length ? parsed.headers : captures[command].headers;
      captures[command].rows.push(...parsed.rows);
      captures[command].raw.push(...parsed.raw);
    });
    return captures;
  }

  function detectCommand(line) {
    const trimmed = line.trim();
    if (!trimmed) return "";
    const withoutPrompt = trimmed
      .replace(/^[^>#%$]{0,48}[>#%$]\s+/, "")
      .replace(/^(svcinfo|svctask)\s+/, "");
    const first = withoutPrompt.split(/\s+/)[0].toLowerCase();
    if (commandNames.has(first) || aliases[first]) return withoutPrompt;
    return "";
  }

  function normaliseCommand(command) {
    const base = command.trim().replace(/^(svcinfo|svctask)\s+/, "").split(/\s+/)[0].toLowerCase();
    return aliases[base] || base;
  }

  function parseTable(lines) {
    const useful = lines.filter((line) => line.trim() && !/^[-=]+$/.test(line.trim()));
    if (!useful.length) return { headers: [], rows: [], raw: [] };

    const delimiter = useful.some((line) => line.includes(":")) ? ":" : null;
    if (delimiter && looksLikeKeyValueBlock(useful)) {
      return parseKeyValueBlock(useful, delimiter);
    }
    const headers = splitLine(useful[0], delimiter);
    const rows = [];

    useful.slice(1).forEach((line) => {
      if (/^(id|name|total_|status|error_code|mdisk_|vdisk_)/i.test(line.trim()) && rows.length) return;
      let parts = splitLine(line, delimiter);
      if (!parts.length) return;
      if (delimiter && parts.length > headers.length && headers.length) {
        parts = parts.slice(0, headers.length - 1).concat(parts.slice(headers.length - 1).join(delimiter));
      }
      const row = {};
      headers.forEach((header, index) => {
        row[cleanHeader(header)] = parts[index] !== undefined ? parts[index] : "";
      });
      rows.push(row);
    });

    return { headers: headers.map(cleanHeader), rows, raw: useful };
  }

  function looksLikeKeyValueBlock(lines) {
    if (lines.length < 3) return false;
    const useful = lines.filter((line) => !line.trim().startsWith("#"));
    if (useful.length < 3) return false;
    const keyLike = useful.filter((line) => /^[A-Za-z_][A-Za-z0-9_.-]*\s*:/.test(line)).length;
    const firstColonCount = (useful[0].match(/:/g) || []).length;
    const secondColonCount = (useful[1].match(/:/g) || []).length;
    const tableLike = firstColonCount > 1 && secondColonCount > 1 && Math.abs(firstColonCount - secondColonCount) <= 1;
    return keyLike >= Math.min(5, useful.length) && !tableLike;
  }

  function parseKeyValueBlock(lines, delimiter) {
    const row = {};
    lines.forEach((line) => {
      if (!line.includes(delimiter) || line.trim().startsWith("#")) return;
      const index = line.indexOf(delimiter);
      const key = cleanHeader(line.slice(0, index));
      const value = line.slice(index + delimiter.length).trim();
      if (!key) return;
      let finalKey = key;
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(row, finalKey)) {
        finalKey = `${key}_${suffix}`;
        suffix += 1;
      }
      row[finalKey] = value;
    });
    const headers = Object.keys(row);
    return { headers, rows: headers.length ? [row] : [], raw: lines };
  }

  function splitLine(line, delimiter) {
    if (delimiter) return line.split(delimiter).map((part) => part.trim());
    return line.trim().split(/\s{2,}|\t+/).map((part) => part.trim()).filter(Boolean);
  }

  function cleanHeader(header) {
    return String(header || "").trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "value";
  }

  function renderAll() {
    renderOverview();
    renderInventoryFilter();
    renderInventory();
    renderAudit();
    renderReport();
  }

  function renderOverview() {
    const system = firstRow("lssystem");
    const metadata = state.metadata;
    const title = metadata.systemName || system.name || ref.product.family;
    $("#overviewTitle").textContent = title;

    const summary = [
      ["Customer", metadata.customer],
      ["Location", metadata.location || system.location],
      ["MTM", metadata.mtm || ref.product.mtm],
      ["Serial", metadata.serial || system.id],
      ["Code level", metadata.codeLevel || system.code_level],
      ["Management IPs", metadata.managementIps || system.console_IP],
      ["Topology", system.topology],
      ["Compression", system.compression_active]
    ].filter((item) => item[1]);

    $("#systemSummary").innerHTML = summary.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("") || emptyHtml();

    const metrics = [
      ["Nodes", rowCount("lsnode"), "Configured node canisters"],
      ["Pools", rowCount("lsmdiskgrp"), "Storage pools"],
      ["Volumes", rowCount("lsvdisk"), "Documented volumes"],
      ["Hosts", rowCount("lshost"), "Host objects"],
      ["Mappings", rowCount("lshostvdiskmap"), "Host volume mappings"],
      ["Alerts", rowCount("lseventlog"), "Open alert events"]
    ];
    $("#healthCards").innerHTML = metrics.map(([label, value, sub]) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(label)} - ${escapeHtml(sub)}</span></div>`).join("");

    renderCapacity(system);
    renderTopology();
  }

  function renderCapacity(system) {
    const capacity = firstRow("lssystemcapacity");
    const source = Object.keys(capacity).length ? capacity : system;
    const total = capacityValue(source.total_mdisk_capacity || source.space_in_mdisk_grps || source.real_capacity);
    const used = capacityValue(source.total_used_capacity || source.used_capacity || source.written_capacity);
    const free = capacityValue(source.total_free_space || source.free_capacity);
    const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;

    $("#capacityView").innerHTML = total ? `
      <div class="bar" title="${pct}% used"><span style="width:${pct}%"></span></div>
      <dl class="summary-list">
        <dt>Total managed</dt><dd>${escapeHtml(source.total_mdisk_capacity || source.space_in_mdisk_grps || source.real_capacity)}</dd>
        <dt>Used</dt><dd>${escapeHtml(source.total_used_capacity || source.used_capacity || source.written_capacity || "n/a")}</dd>
        <dt>Free</dt><dd>${escapeHtml(source.total_free_space || source.free_capacity || "n/a")}</dd>
        <dt>Used percent</dt><dd>${pct}%</dd>
      </dl>
    ` : emptyHtml();
  }

  function renderTopology() {
    const nodes = rows("lsnode").map((row) => row.name || row.id || "node");
    const pools = rows("lsmdiskgrp").map((row) => row.name || row.id || "pool");
    const hosts = rows("lshost").slice(0, 12).map((row) => row.name || row.id || "host");
    const partnerships = rows("lspartnership").map((row) => row.name || row.cluster_ip || "partnership");
    const groups = [
      ["Nodes", nodes],
      ["Pools", pools],
      ["Hosts", hosts],
      ["Partnerships", partnerships]
    ].filter(([, items]) => items.length);

    $("#topologyView").innerHTML = groups.length ? groups.map(([label, items]) => `
      <div class="topo-row"><strong>${escapeHtml(label)}</strong>${items.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>
    `).join("") : emptyHtml();
  }

  function renderInventoryFilter() {
    const select = $("#inventoryFilter");
    const commands = Object.keys(state.captures).sort();
    const current = select.value;
    select.innerHTML = `<option value="">All categories</option>${commands.map((cmd) => `<option value="${cmd}">${cmd}</option>`).join("")}`;
    select.value = commands.includes(current) ? current : "";
  }

  function renderInventory() {
    const container = $("#inventoryTables");
    const search = $("#inventorySearch").value.trim().toLowerCase();
    const filter = $("#inventoryFilter").value;
    const commands = Object.keys(state.captures).sort().filter((cmd) => !filter || cmd === filter);

    if (!commands.length) {
      container.innerHTML = emptyHtml();
      return;
    }

    container.innerHTML = commands.map((cmd) => {
      const capture = state.captures[cmd];
      const filteredRows = capture.rows.filter((row) => !search || JSON.stringify(row).toLowerCase().includes(search));
      if (!filteredRows.length) return "";
      const headers = capture.headers.filter((header) => filteredRows.some((row) => row[header]));
      return `
        <section>
          <div class="section-title"><h3>${escapeHtml(cmd)}</h3><span>${filteredRows.length} rows</span></div>
          <div class="table-wrap">
            <table>
              <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
              <tbody>${filteredRows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] || "")}</td>`).join("")}</tr>`).join("")}</tbody>
            </table>
          </div>
        </section>
      `;
    }).join("") || emptyHtml();
  }

  function renderAudit() {
    const findings = buildFindings();
    $("#auditFindings").innerHTML = findings.map((finding) => `
      <div class="finding ${finding.level}">
        <strong>${escapeHtml(finding.title)}</strong>
        <p>${escapeHtml(finding.detail)}</p>
      </div>
    `).join("");

    $("#limitsView").innerHTML = ref.limits.map((limit) => `
      <div class="limit">
        <strong>${escapeHtml(limit.area)} - ${escapeHtml(limit.metric)}</strong>
        <p>FS7300 limit: ${escapeHtml(limit.value)} ${escapeHtml(limit.unit)}. Checked with ${escapeHtml(limit.command)} where capture exists.</p>
      </div>
    `).join("");
  }

  function buildFindings() {
    const findings = [];
    const nodes = rows("lsnode");
    const offlineNodes = nodes.filter((row) => row.status && row.status.toLowerCase() !== "online");
    findings.push(offlineNodes.length ? {
      level: "bad",
      title: "Node health needs attention",
      detail: `${offlineNodes.length} node rows are not online.`
    } : {
      level: nodes.length ? "ok" : "warn",
      title: "Node inventory",
      detail: nodes.length ? `${nodes.length} nodes documented.` : "No lsnode capture found."
    });

    const alerts = rows("lseventlog");
    findings.push(alerts.length ? {
      level: "warn",
      title: "Open event alerts",
      detail: `${alerts.length} alert rows captured from lseventlog.`
    } : {
      level: "ok",
      title: "Event alerts",
      detail: "No alert rows were captured."
    });

    ref.limits.forEach((limit) => {
      const actual = actualForLimit(limit);
      if (actual === null) return;
      const pct = limit.value ? actual / limit.value : 0;
      findings.push({
        level: pct >= 1 ? "bad" : pct >= 0.8 ? "warn" : "ok",
        title: `${limit.metric}: ${actual} of ${limit.value}`,
        detail: `${limit.command} is at ${Math.round(pct * 100)}% of the documented FS7300 9.1.0.x limit.`
      });
    });

    if (!Object.keys(state.captures).length) {
      findings.push({ level: "warn", title: "No capture parsed", detail: "Paste CLI output to generate a real audit." });
    }
    return findings;
  }

  function actualForLimit(limit) {
    const captureRows = rows(limit.command);
    if (!captureRows.length) return null;
    if (limit.field === "rows") return captureRows.length;
    if (limit.field === "dataReductionRows") return captureRows.filter((row) => String(row.data_reduction || "").toLowerCase() === "yes").length;
    if (limit.field === "fcRows") return captureRows.filter((row) => /fc|wwpn|fibre/i.test(JSON.stringify(row))).length;
    if (limit.field === "hosts") return uniqueCount(captureRows, ["host_name", "host_id", "name", "id"]);
    if (limit.field === "rowsByHost") return maxGroupCount(captureRows, ["host_name", "host_id"]);
    if (limit.field === "rowsByPool") return maxGroupCount(captureRows, ["mdisk_grp_name", "mdisk_grp_id", "pool_name"]);
    if (limit.field === "rowsByVolumeGroup") return maxGroupCount(captureRows, ["volume_group_name", "volume_group_id"]);
    if (limit.field === "sessionsByPort") return maxGroupCount(captureRows, ["port_id", "port_name", "fc_port_id"]);
    return null;
  }

  function renderCommandMap() {
    $("#commandMap").innerHTML = ref.commands.map((group) => `
      <div class="command-category">
        <strong>${escapeHtml(group.category)}</strong>
        <p>${escapeHtml(group.purpose)}</p>
        <p><code>${group.commands.map(escapeHtml).join("</code> <code>")}</code></p>
      </div>
    `).join("");
  }

  function renderRunbook() {
    $("#runbook").textContent = buildRunbook();
  }

  function buildRunbook() {
    const lines = [
      "# FlashSystem 7300 documentation capture",
      "# Target: IBM Storage Virtualize 9.1.0.x / 9.1.1 CLI syntax family",
      "# Tip: use -delim : for parser-friendly output.",
      ""
    ];
    (ref.fetchGroups || ref.commands).forEach((group) => {
      lines.push(`## ${group.label || group.category}`);
      group.commands.forEach((cmd) => {
        const withDelim = cmd.includes("-delim") || cmd.includes("showtimezone") || cmd.includes("ping") ? cmd : `${cmd} -delim :`;
        lines.push(`svcinfo ${withDelim}`);
      });
      lines.push("");
    });
    return lines.join("\n");
  }

  async function copyRunbook() {
    const text = buildRunbook();
    await navigator.clipboard.writeText(text);
    $("#copyRunbook").textContent = "Copied";
    setTimeout(() => { $("#copyRunbook").textContent = "Copy Commands"; }, 1200);
  }

  function renderReport() {
    const report = buildMarkdownReport();
    state.lastReport = report;
    $("#reportOutput").value = report;
  }

  function buildMarkdownReport() {
    readMetadata();
    const system = firstRow("lssystem");
    const title = state.metadata.systemName || system.name || ref.product.family;
    const findings = buildFindings();
    const sections = [
      `# ${title} Documentation`,
      "",
      `Generated: ${new Date().toLocaleString()}`,
      "",
      "## System Details",
      mdList([
        ["Customer", state.metadata.customer],
        ["Location", state.metadata.location || system.location],
        ["Product", ref.product.family],
        ["MTM", state.metadata.mtm || ref.product.mtm],
        ["Serial / system ID", state.metadata.serial || system.id],
        ["Code level", state.metadata.codeLevel || system.code_level],
        ["Management IPs", state.metadata.managementIps || system.console_IP],
        ["Prepared by", state.metadata.preparedBy],
        ["Collection date", formatDate(state.metadata.collectionDate)],
        ["Document reference", state.metadata.documentRef]
      ]),
      state.metadata.notes ? `\n## Notes\n${state.metadata.notes}` : "",
      "## Executive Summary",
      mdList([
        ["Nodes", rowCount("lsnode")],
        ["Pools", rowCount("lsmdiskgrp")],
        ["Volumes", rowCount("lsvdisk")],
        ["Hosts", rowCount("lshost")],
        ["Mappings", rowCount("lshostvdiskmap")],
        ["Open alerts captured", rowCount("lseventlog")]
      ]),
      "## Audit Findings",
      findings.map((finding) => `- **${finding.title}** (${finding.level.toUpperCase()}): ${finding.detail}`).join("\n"),
      "## Inventory",
      ...Object.keys(state.captures).sort().map((cmd) => markdownTable(cmd, state.captures[cmd])),
      "## Collection Reference",
      ref.commands.map((group) => `### ${group.category}\n${group.commands.map((cmd) => `- \`${cmd}\``).join("\n")}`).join("\n\n"),
      "## Source References",
      ref.product.sources.map((source) => `- ${source.title}: ${source.url}`).join("\n")
    ];
    return sections.filter(Boolean).join("\n\n");
  }

  function buildHtmlReport() {
    const markdown = buildMarkdownReport();
    const body = markdown
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .split(/\n{2,}/)
      .map((block) => /^<h\d|^<table|^<ul/.test(block) ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`)
      .join("\n");
    return `<!doctype html><html><head><meta charset="utf-8"><title>FlashSystem 7300 Documentation</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#17212f}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d8dee6;padding:6px;text-align:left;font-size:12px}th{background:#eef3f8}code{background:#eef3f8;padding:1px 4px}</style></head><body>${body}</body></html>`;
  }

  function exportDocx() {
    readMetadata();
    const docx = buildDocx();
    const system = firstRow("lssystem");
    const title = state.metadata.systemName || system.name || ref.product.family;
    downloadBlob(`${safeFilename(title)}-documentation.docx`, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    $("#plinkStatus").textContent = "DOCX exported from the current parsed capture.";
  }

  function buildDocx() {
    const meta = docMeta();
    const files = {
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
      "word/styles.xml": buildStylesXml(),
      "docProps/core.xml": buildCorePropsXml(meta),
      "docProps/app.xml": buildAppPropsXml(),
      "word/document.xml": buildDocumentXml(meta)
    };
    return makeZip(files);
  }

  function docMeta() {
    const system = firstRow("lssystem");
    const title = state.metadata.systemName || system.name || ref.product.family;
    return {
      system,
      title,
      customer: state.metadata.customer || "",
      location: state.metadata.location || system.location || "",
      product: ref.product.family,
      mtm: state.metadata.mtm || ref.product.mtm,
      serial: state.metadata.serial || system.id || "",
      codeLevel: state.metadata.codeLevel || system.code_level || "",
      managementIps: state.metadata.managementIps || system.console_IP || "",
      preparedBy: state.metadata.preparedBy || "",
      collectionDate: state.metadata.collectionDate || new Date().toISOString().slice(0, 10),
      documentRef: state.metadata.documentRef || "",
      notes: state.metadata.notes || "",
      generated: new Date().toLocaleString(),
      generatedIso: new Date().toISOString()
    };
  }

  function buildDocumentXml(meta) {
    const sections = reportSections();
    const findings = buildFindings();
    const parts = [
      docCover(meta),
      pageBreak(),
      docParagraph("Index", "Heading1"),
      docParagraph("The following sections are included in this generated work document. Tables later in the document contain the complete parsed collection data.", "IntroText"),
      docTable([
        ["Section", "Contents"],
        ["Executive Summary", "System identity, inventory counts, capacity and key health indicators"],
        ["Audit Findings", "Parsed health observations and configuration limit checks"],
        ...sections.map((section) => [section.title, section.commands.map((command) => command.label).join(", ")]),
        ["Source References", "IBM Storage Virtualize reference links used by the tool"]
      ], { header: true, style: "Index" }),
      pageBreak(),
      docParagraph("Executive Summary", "Heading1"),
      docTable([
        ["Metric", "Value"],
        ["System name", meta.title],
        ["Customer", meta.customer],
        ["Collection date", formatDate(meta.collectionDate)],
        ["Code level", meta.codeLevel],
        ["Nodes", rowCount("lsnode")],
        ["Pools", rowCount("lsmdiskgrp")],
        ["Volumes", rowCount("lsvdisk")],
        ["Hosts", rowCount("lshost")],
        ["Mappings", rowCount("lshostvdiskmap")],
        ["Open alerts captured", rowCount("lseventlog")]
      ], { header: true, style: "Summary" }),
      docParagraph("Audit Findings", "Heading1"),
      docTable([
        ["Severity", "Finding", "Detail"],
        ...findings.map((finding) => [finding.level.toUpperCase(), finding.title, finding.detail])
      ], { header: true, style: "Findings" }),
      pageBreak(),
      docParagraph("Collected Configuration Data", "Heading1"),
      docParagraph("The following sections contain every parsed row, every parsed field, and raw output for commands that do not fit a clean table shape.", "IntroText")
    ];

    sections.forEach((section) => {
      parts.push(docParagraph(section.title, "Heading1"));
      if (section.description) parts.push(docParagraph(section.description, "IntroText"));
      section.commands.forEach((command) => {
        const capture = state.captures[command.key];
        parts.push(...docCapture(command, capture));
      });
    });

    parts.push(docParagraph("Source References", "Heading1"));
    ref.product.sources.forEach((source) => {
      parts.push(docParagraph(`${source.title}: ${source.url}`));
    });

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${parts.join("\n")}
    <w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="540" w:bottom="720" w:left="540" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
  }

  function docCover(meta) {
    const rows = [
      ["Customer", meta.customer],
      ["System", meta.title],
      ["Product", `${meta.product} (${meta.mtm})`],
      ["Serial / system ID", meta.serial],
      ["Code level", meta.codeLevel],
      ["Management IPs", meta.managementIps],
      ["Location", meta.location],
      ["Collection date", formatDate(meta.collectionDate)],
      ["Prepared by", meta.preparedBy],
      ["Document reference", meta.documentRef],
      ["Generated", meta.generated]
    ];
    return [
      docParagraph("IBM FlashSystem 7300", "Kicker"),
      docParagraph(meta.title, "CoverTitle"),
      docParagraph("Storage Virtualize Configuration Work Document", "Subtitle"),
      docTable([["Field", "Value"], ...rows.filter(([, value]) => value)], { header: true, style: "Cover" }),
      meta.notes ? docParagraph("Notes / Scope", "Heading1") + docParagraph(meta.notes, "IntroText") : ""
    ].join("\n");
  }

  function docParagraph(text, style = "Normal", options = {}) {
    const styleXml = style ? `<w:pStyle w:val="${style}"/>` : "";
    const pageBreakXml = options.pageBreakBefore ? `<w:pageBreakBefore/>` : "";
    const pPr = styleXml || pageBreakXml ? `<w:pPr>${styleXml}${pageBreakXml}</w:pPr>` : "";
    const rPr = options.bold ? `<w:rPr><w:b/></w:rPr>` : "";
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }

  function docCapture(command, capture) {
    const headers = allHeaders(capture);
    const parts = [docParagraph(`${command.label} (${capture.rows.length} rows)`, "Heading2")];

    if (!headers.length || !capture.rows.length) {
      parts.push(docParagraph(capture.raw && capture.raw.length ? "Raw command output" : "No parsed rows.", "Caption"));
      if (capture.raw && capture.raw.length) parts.push(...docRawBlock(capture.raw));
      return parts;
    }

    if (isDetailCapture(capture, headers)) {
      capture.rows.forEach((row, index) => {
        if (capture.rows.length > 1) parts.push(docParagraph(`Record ${index + 1}`, "Caption"));
        parts.push(...docFieldValueTables(headers, row));
      });
      return parts;
    }

    parts.push(...docDataTables(headers, capture.rows));
    return parts;
  }

  function isDetailCapture(capture, headers) {
    return capture.rows.length <= 3 && headers.length > DOCX_MAX_TABLE_COLUMNS + 4;
  }

  function docFieldValueTables(headers, row) {
    const entries = headers.map((header) => [header, row[header] || ""]);
    const chunks = chunkArray(entries, DOCX_MAX_FIELD_ROWS);
    return chunks.flatMap((chunk, index) => [
      chunks.length > 1 ? docParagraph(`Fields ${index * DOCX_MAX_FIELD_ROWS + 1}-${index * DOCX_MAX_FIELD_ROWS + chunk.length} of ${entries.length}`, "Caption") : "",
      docTable([["Field", "Value"], ...chunk], { header: true, style: "Detail" })
    ]).filter(Boolean);
  }

  function docDataTables(headers, rows) {
    const rowChunks = chunkArray(rows, DOCX_MAX_TABLE_ROWS);
    const columnChunks = chunkArray(headers, DOCX_MAX_TABLE_COLUMNS);
    const parts = [];
    rowChunks.forEach((rowChunk, rowIndex) => {
      columnChunks.forEach((headerChunk, columnIndex) => {
        const rowStart = rowIndex * DOCX_MAX_TABLE_ROWS + 1;
        const rowEnd = rowStart + rowChunk.length - 1;
        const columnStart = columnIndex * DOCX_MAX_TABLE_COLUMNS + 1;
        const columnEnd = columnStart + headerChunk.length - 1;
        if (rowChunks.length > 1 || columnChunks.length > 1) {
          parts.push(docParagraph(`Rows ${rowStart}-${rowEnd} of ${rows.length}; fields ${columnStart}-${columnEnd} of ${headers.length}`, "Caption"));
        }
        parts.push(docTable([headerChunk, ...rowChunk.map((row) => headerChunk.map((header) => row[header] || ""))], { header: true, style: "Data" }));
      });
    });
    return parts;
  }

  function docRawBlock(lines) {
    return chunkArray(lines, 40).flatMap((chunk) => chunk.map((line) => docParagraph(line, "MonoText")));
  }

  function pageBreak() {
    return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }

  function docTable(rowsForTable, options = {}) {
    const columnCount = Math.max(1, rowsForTable.reduce((max, row) => Math.max(max, row.length), 0));
    const width = Math.max(650, Math.floor(15000 / columnCount));
    return `<w:tbl>
      <w:tblPr><w:tblW w:w="15000" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B8C2CC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="D8DEE6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D8DEE6"/></w:tblBorders></w:tblPr>
      ${rowsForTable.map((row, rowIndex) => `<w:tr>${normaliseRow(row, columnCount).map((cell) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${options.header && rowIndex === 0 ? `<w:shd w:val="clear" w:color="auto" w:fill="101820"/>` : ""}</w:tcPr>${docParagraph(String(cell ?? ""), options.header && rowIndex === 0 ? "TableHeader" : "TableText")}</w:tc>`).join("")}</w:tr>`).join("")}
    </w:tbl>`;
  }

  function normaliseRow(row, count) {
    const out = row.slice(0, count);
    while (out.length < count) out.push("");
    return out;
  }

  function chunkArray(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks.length ? chunks : [[]];
  }

  function allHeaders(capture) {
    const seen = new Set();
    const headers = [];
    (capture.headers || []).forEach((header) => {
      if (!seen.has(header)) {
        seen.add(header);
        headers.push(header);
      }
    });
    capture.rows.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (!seen.has(key)) {
          seen.add(key);
          headers.push(key);
        }
      });
    });
    return headers;
  }

  function reportSections() {
    const capturedKeys = new Set(Object.keys(state.captures));
    const used = new Set();
    const sections = [];
    (ref.fetchGroups || []).forEach((group) => {
      const commands = [];
      const seenInGroup = new Set();
      group.commands.forEach((command) => {
        const key = normaliseCommand(command);
        if (!capturedKeys.has(key) || used.has(key) || seenInGroup.has(key)) return;
        seenInGroup.add(key);
        used.add(key);
        commands.push({ key, label: key });
      });
      if (commands.length) {
        sections.push({
          title: group.label,
          description: group.description,
          commands
        });
      }
    });
    const otherCommands = [...capturedKeys].sort().filter((key) => !used.has(key)).map((key) => ({ key, label: key }));
    if (otherCommands.length) {
      sections.push({
        title: "Other Captured Data",
        description: "Additional command output found in the imported collection.",
        commands: otherCommands
      });
    }
    return sections;
  }

  function buildStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="20"/><w:color w:val="17212F"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="20"/><w:color w:val="17212F"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Kicker"><w:name w:val="Kicker"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:caps/><w:color w:val="0F62FE"/><w:sz w:val="22"/></w:rPr><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="CoverTitle"><w:name w:val="Cover Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:color w:val="101820"/><w:sz w:val="54"/></w:rPr><w:pPr><w:spacing w:before="200" w:after="160"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="5D6A78"/><w:sz w:val="28"/></w:rPr><w:pPr><w:spacing w:after="360"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:color w:val="101820"/><w:sz w:val="30"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="140"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="0F62FE"/></w:pBdr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:color w:val="263646"/><w:sz w:val="24"/></w:rPr><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="100"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="IntroText"><w:name w:val="Intro Text"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="5D6A78"/><w:sz w:val="20"/></w:rPr><w:pPr><w:spacing w:after="180"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="5D6A78"/><w:sz w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="MonoText"><w:name w:val="Mono Text"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Cascadia Mono" w:hAnsi="Cascadia Mono"/><w:sz w:val="14"/><w:color w:val="263646"/></w:rPr><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="14"/><w:color w:val="17212F"/></w:rPr><w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:basedOn w:val="TableText"/><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="14"/></w:rPr><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr></w:style>
</w:styles>`;
  }

  function buildCorePropsXml(meta) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(meta.title)} Documentation</dc:title>
  <dc:subject>IBM FlashSystem 7300 Storage Virtualize configuration documentation</dc:subject>
  <dc:creator>${xmlEscape(meta.preparedBy || "Storwize Documentation")}</dc:creator>
  <cp:lastModifiedBy>Storwize Documentation</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${meta.generatedIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${meta.generatedIso}</dcterms:modified>
</cp:coreProperties>`;
  }

  function buildAppPropsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Storwize Documentation</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
</Properties>`;
  }

  function makeZip(files) {
    const encoder = new TextEncoder();
    const entries = Object.entries(files).map(([name, content]) => ({
      name,
      nameBytes: encoder.encode(name),
      data: encoder.encode(content),
      crc: 0,
      offset: 0
    }));
    entries.forEach((entry) => {
      entry.crc = crc32(entry.data);
    });

    const localParts = [];
    let offset = 0;
    entries.forEach((entry) => {
      entry.offset = offset;
      const header = zipLocalHeader(entry);
      localParts.push(header, entry.data);
      offset += header.length + entry.data.length;
    });

    const centralParts = entries.map(zipCentralHeader);
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const centralOffset = offset;
    const end = zipEndRecord(entries.length, centralSize, centralOffset);
    return concatUint8([...localParts, ...centralParts, end]);
  }

  function zipLocalHeader(entry) {
    return concatUint8([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(zipTime()), u16(zipDate()),
      u32(entry.crc), u32(entry.data.length), u32(entry.data.length),
      u16(entry.nameBytes.length), u16(0), entry.nameBytes
    ]);
  }

  function zipCentralHeader(entry) {
    return concatUint8([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(zipTime()), u16(zipDate()),
      u32(entry.crc), u32(entry.data.length), u32(entry.data.length),
      u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entry.offset), entry.nameBytes
    ]);
  }

  function zipEndRecord(count, centralSize, centralOffset) {
    return concatUint8([
      u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(centralSize), u32(centralOffset), u16(0)
    ]);
  }

  function zipTime() {
    const now = new Date();
    return (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  }

  function zipDate() {
    const now = new Date();
    return ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  }

  function u16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function u32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function concatUint8(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i += 1) {
      crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function mdList(items) {
    return items.filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `- **${key}:** ${value}`).join("\n") || "- Not captured";
  }

  function markdownTable(title, capture) {
    const headers = capture.headers.filter((header) => capture.rows.some((row) => row[header])).slice(0, 12);
    if (!capture.rows.length || !headers.length) return `### ${title}\nNo parsed rows.`;
    const headerRow = `| ${headers.join(" | ")} |`;
    const divider = `| ${headers.map(() => "---").join(" | ")} |`;
    const rowsMd = capture.rows.slice(0, 100).map((row) => `| ${headers.map((header) => String(row[header] || "").replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
    const suffix = capture.rows.length > 100 ? `\n\n_${capture.rows.length - 100} additional rows omitted from markdown preview._` : "";
    return `### ${title}\n${headerRow}\n${divider}\n${rowsMd}${suffix}`;
  }

  function rows(command) {
    return state.captures[command]?.rows || [];
  }

  function firstRow(command) {
    return rows(command)[0] || {};
  }

  function rowCount(command) {
    return rows(command).length;
  }

  function uniqueCount(rowsToCount, keys) {
    const values = new Set();
    rowsToCount.forEach((row) => {
      const key = keys.map((candidate) => row[candidate]).find(Boolean);
      if (key) values.add(key);
    });
    return values.size || rowsToCount.length;
  }

  function maxGroupCount(rowsToGroup, keys) {
    const groups = {};
    rowsToGroup.forEach((row) => {
      const key = keys.map((candidate) => row[candidate]).find(Boolean);
      if (!key) return;
      groups[key] = (groups[key] || 0) + 1;
    });
    return Math.max(0, ...Object.values(groups));
  }

  function capacityValue(value) {
    if (!value) return 0;
    const match = String(value).trim().match(/^([0-9.]+)\s*([kmgtp]?i?b|[kmgtp]b)?$/i);
    if (!match) return Number(value) || 0;
    const number = Number(match[1]);
    const unit = (match[2] || "b").toLowerCase();
    const factors = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, pb: 1e15, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4, pib: 1024 ** 5 };
    return number * (factors[unit] || 1);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  function safeFilename(value) {
    return String(value || "flashsystem-7300")
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "flashsystem-7300";
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    downloadBlob(filename, blob, type);
  }

  function downloadBlob(filename, blob, type = "application/octet-stream") {
    if (!(blob instanceof Blob)) {
      blob = new Blob([blob], { type });
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function emptyHtml() {
    return $("#emptyStateTemplate").innerHTML;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function xmlEscape(value) {
    return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&apos;"
    }[char]));
  }

  function buildCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
