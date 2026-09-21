(function () {
  'use strict';

  var FIND_TRIES_MAX = 60;
  var FIND_INTERVAL_MS = 900;
  var findTimer = null;
  var findAttempts = 0;

  var nvmRows = [];
  var nvmView = 'grid';
  var nvmSearchText = '';
  var nvmStatusPick = '';
  var nvmSortKey = 'vName';
  var nvmSortDir = 'asc';

  var STATUS_COLORS = {
    'Confirmed':        { bg: 'rgba(34,197,94,0.16)',  fg: '#4ade80', bd: 'rgba(34,197,94,0.45)' },
    'Reserved':         { bg: 'rgba(59,130,246,0.16)', fg: '#60a5fa', bd: 'rgba(59,130,246,0.45)' },
    'Contract Review':  { bg: 'rgba(59,130,246,0.16)', fg: '#60a5fa', bd: 'rgba(59,130,246,0.45)' },
    'In Works':         { bg: 'rgba(245,158,11,0.18)', fg: '#fbbf24', bd: 'rgba(245,158,11,0.45)' },
    'In Conversation':  { bg: 'rgba(245,158,11,0.18)', fg: '#fbbf24', bd: 'rgba(245,158,11,0.45)' },
    'Identified':       { bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1', bd: 'rgba(148,163,184,0.4)' },
    'Not Available':    { bg: 'rgba(239,68,68,0.16)',  fg: '#f87171', bd: 'rgba(239,68,68,0.45)' },
    'Declined':         { bg: 'rgba(239,68,68,0.16)',  fg: '#f87171', bd: 'rgba(239,68,68,0.45)' },
    'Not Selected':     { bg: 'rgba(239,68,68,0.16)',  fg: '#f87171', bd: 'rgba(239,68,68,0.45)' },
    'Fallback':         { bg: 'rgba(168,85,247,0.16)', fg: '#c084fc', bd: 'rgba(168,85,247,0.45)' }
  };
  var STATUS_DEFAULT_COLOR = { bg: 'rgba(148,163,184,0.16)', fg: '#cbd5e1', bd: 'rgba(148,163,184,0.4)' };

  function getStatusColor(rowStatus) {
    if (rowStatus && STATUS_COLORS.hasOwnProperty(rowStatus)) return STATUS_COLORS[rowStatus];
    return STATUS_DEFAULT_COLOR;
  }

  function escHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dash(v) {
    if (v === null || v === undefined) return '—';
    var s = String(v);
    if (s === '' || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return '—';
    return s;
  }

  function csvEscape(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\n]/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toDisplayList(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') {
      var out = [];
      for (var k in v) { if (v.hasOwnProperty(k)) out.push(v[k]); }
      return out.join(', ');
    }
    return String(v);
  }

  function normalizeVenue(vid, raw) {
    raw = raw || {};
    var vName = raw.name ? String(raw.name) : ('(untitled ' + vid + ')');
    var contact = raw.primaryContact || raw.poc || '';
    return {
      id: vid,
      vName: vName,
      location: raw.location || '',
      address: raw.address || '',
      rowStatus: raw.status || '',
      vType: raw.type || '',
      sports: toDisplayList(raw.sports),
      capacity: raw.capacity || '',
      fieldCount: raw.fieldCount || '',
      courtsTennis: raw.courtsTennis || '',
      courtsPickleball: raw.courtsPickleball || '',
      indoorOutdoor: raw.indoorOutdoor || '',
      rentalFee: raw.rentalFee || '',
      contact: contact,
      email: raw.primaryEmail || '',
      contractStatus: raw.contractStatus || ''
    };
  }

  function pickFacts(row) {
    var facts = [];
    if (row.fieldCount) facts.push(row.fieldCount + ' field' + (String(row.fieldCount) === '1' ? '' : 's'));
    if (facts.length < 3 && row.courtsTennis) facts.push(row.courtsTennis + ' tennis court' + (String(row.courtsTennis) === '1' ? '' : 's'));
    if (facts.length < 3 && row.courtsPickleball) facts.push(row.courtsPickleball + ' pickleball court' + (String(row.courtsPickleball) === '1' ? '' : 's'));
    if (facts.length < 3 && row.capacity) facts.push('Capacity ' + row.capacity);
    if (facts.length < 3 && row.indoorOutdoor) facts.push(row.indoorOutdoor);
    if (facts.length < 3 && row.rentalFee) facts.push('Fee: ' + row.rentalFee);
    return facts.slice(0, 3);
  }

  function matchesSearch(row, needle) {
    if (!needle) return true;
    var hay = (row.vName + ' ' + row.location + ' ' + row.sports + ' ' + row.contact).toLowerCase();
    return hay.indexOf(needle) !== -1;
  }

  function getFilteredRows() {
    var needle = (nvmSearchText || '').toLowerCase().trim();
    var out = [];
    for (var i = 0; i < nvmRows.length; i++) {
      var r = nvmRows[i];
      if (nvmStatusPick && r.rowStatus !== nvmStatusPick) continue;
      if (!matchesSearch(r, needle)) continue;
      out.push(r);
    }
    return out;
  }

  function compareRows(a, b, key, dir) {
    var av = a[key], bv = b[key];
    var an = parseFloat(av), bn = parseFloat(bv);
    var bothNumeric = !isNaN(an) && !isNaN(bn) && String(av).trim() !== '' && String(bv).trim() !== '';
    var cmp;
    if (bothNumeric) {
      cmp = an - bn;
    } else {
      cmp = String(av || '').toLowerCase().localeCompare(String(bv || '').toLowerCase());
    }
    return dir === 'desc' ? -cmp : cmp;
  }

  function sortRows(rows) {
    var key = nvmSortKey, dir = nvmSortDir;
    rows.sort(function (a, b) { return compareRows(a, b, key, dir); });
    return rows;
  }

  function renderCountLabel(shownCount) {
    var el = document.getElementById('nvmCount');
    if (!el) return;
    var total = nvmRows.length;
    if (shownCount === total) {
      el.textContent = total + (total === 1 ? ' venue' : ' venues');
    } else {
      el.textContent = shownCount + ' of ' + total + ' venues';
    }
  }

  function renderGrid(rows) {
    var host = document.getElementById('nvmGrid');
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = '<div class="nvm-empty">No venues match.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var col = getStatusColor(r.rowStatus);
      var facts = pickFacts(r);
      var factsHtml = '';
      for (var f = 0; f < facts.length; f++) {
        factsHtml += '<span class="nvm-fact">' + escHtml(facts[f]) + '</span>';
      }
      html += '' +
        '<div class="nvm-card">' +
          '<div class="nvm-card-top">' +
            '<div class="nvm-card-name">' + escHtml(r.vName) + '</div>' +
            '<span class="nvm-pill" style="background:' + col.bg + ';color:' + col.fg + ';border-color:' + col.bd + '">' + escHtml(dash(r.rowStatus)) + '</span>' +
          '</div>' +
          '<div class="nvm-card-loc">' + escHtml(dash(r.location)) + '</div>' +
          '<div class="nvm-card-meta">' +
            '<span class="nvm-meta-item">' + escHtml(dash(r.vType)) + '</span>' +
            (r.sports ? '<span class="nvm-meta-item">' + escHtml(r.sports) + '</span>' : '') +
          '</div>' +
          (factsHtml ? '<div class="nvm-card-facts">' + factsHtml + '</div>' : '') +
        '</div>';
    }
    host.innerHTML = html;
  }

  var TABLE_COLS = [
    { key: 'vName', label: 'Name' },
    { key: 'location', label: 'Location' },
    { key: 'rowStatus', label: 'Status' },
    { key: 'vType', label: 'Type' },
    { key: 'sports', label: 'Sports' },
    { key: 'capacity', label: 'Capacity' },
    { key: 'fieldCount', label: 'Fields' },
    { key: 'contact', label: 'Contact' },
    { key: 'contractStatus', label: 'Contract' }
  ];

  function renderTableHead() {
    var head = document.getElementById('nvmTableHead');
    if (!head) return;
    var html = '';
    for (var i = 0; i < TABLE_COLS.length; i++) {
      var c = TABLE_COLS[i];
      var arrow = '';
      if (nvmSortKey === c.key) arrow = nvmSortDir === 'asc' ? ' ▲' : ' ▼';
      html += '<th class="nvm-th" data-sortkey="' + escHtml(c.key) + '">' + escHtml(c.label) + arrow + '</th>';
    }
    head.innerHTML = html;
  }

  function renderTableBody(rows) {
    var body = document.getElementById('nvmTableBody');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td class="nvm-td nvm-empty" colspan="' + TABLE_COLS.length + '">No venues match.</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var col = getStatusColor(r.rowStatus);
      html += '<tr class="nvm-tr">' +
        '<td class="nvm-td">' + escHtml(dash(r.vName)) + '</td>' +
        '<td class="nvm-td">' + escHtml(dash(r.location)) + '</td>' +
        '<td class="nvm-td"><span class="nvm-pill nvm-pill-sm" style="background:' + col.bg + ';color:' + col.fg + ';border-color:' + col.bd + '">' + escHtml(dash(r.rowStatus)) + '</span></td>' +
        '<td class="nvm-td">' + escHtml(dash(r.vType)) + '</td>' +
        '<td class="nvm-td">' + escHtml(dash(r.sports)) + '</td>' +
        '<td class="nvm-td">' + escHtml(dash(r.capacity)) + '</td>' +
        '<td class="nvm-td">' + escHtml(dash(r.fieldCount)) + '</td>' +
        '<td class="nvm-td">' + escHtml(dash(r.contact)) + '</td>' +
        '<td class="nvm-td">' + escHtml(dash(r.contractStatus)) + '</td>' +
        '</tr>';
    }
    body.innerHTML = html;
  }

  function renderStatusOptions() {
    var sel = document.getElementById('nvmStatusFilter');
    if (!sel) return;
    var seen = {};
    var list = [];
    for (var i = 0; i < nvmRows.length; i++) {
      var s = nvmRows[i].rowStatus;
      if (s && !seen[s]) { seen[s] = true; list.push(s); }
    }
    list.sort();
    var html = '<option value="">All statuses</option>';
    for (var j = 0; j < list.length; j++) {
      var sel2 = (list[j] === nvmStatusPick) ? ' selected' : '';
      html += '<option value="' + escHtml(list[j]) + '"' + sel2 + '>' + escHtml(list[j]) + '</option>';
    }
    sel.innerHTML = html;
  }

  function applyViewVisibility() {
    var gridWrap = document.getElementById('nvmGrid');
    var tableWrap = document.getElementById('nvmTableWrap');
    var toggle = document.getElementById('nvmToggle');
    if (gridWrap) gridWrap.style.display = (nvmView === 'grid') ? '' : 'none';
    if (tableWrap) tableWrap.style.display = (nvmView === 'table') ? '' : 'none';
    if (toggle) {
      var btns = toggle.querySelectorAll('.nvm-toggle-btn');
      for (var i = 0; i < btns.length; i++) {
        var isActive = btns[i].getAttribute('data-view') === nvmView;
        if (isActive) { btns[i].className = 'nvm-toggle-btn nvm-active'; }
        else { btns[i].className = 'nvm-toggle-btn'; }
      }
    }
  }

  function renderAll() {
    try {
      var filtered = getFilteredRows();
      var sorted = sortRows(filtered.slice());
      renderCountLabel(sorted.length);
      renderStatusOptions();
      renderGrid(sorted);
      renderTableHead();
      renderTableBody(sorted);
      applyViewVisibility();
      showError('');
    } catch (e) {
      showError('Render error: ' + (e && e.message ? e.message : String(e)));
    }
  }

  function showError(msg) {
    var el = document.getElementById('nvmError');
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = '';
    el.textContent = msg;
  }

  function exportCsv() {
    try {
      var rows = sortRows(getFilteredRows().slice());
      var lines = [];
      var headerRow = [];
      for (var i = 0; i < TABLE_COLS.length; i++) headerRow.push(TABLE_COLS[i].label);
      lines.push(headerRow.map(csvEscape).join(','));
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var cells = [
          row.vName, row.location, row.rowStatus, row.vType, row.sports,
          row.capacity, row.fieldCount, row.contact, row.contractStatus
        ];
        lines.push(cells.map(csvEscape).join(','));
      }
      var csvText = lines.join('\r\n');
      var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'naig-venues.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    } catch (e) {
      showError('CSV export failed: ' + (e && e.message ? e.message : String(e)));
    }
  }

  function ensureStyles() {
    if (document.getElementById('nvmStyleTag')) return;
    var style = document.createElement('style');
    style.id = 'nvmStyleTag';
    style.type = 'text/css';
    style.appendChild(document.createTextNode([
      '#naigVenueMatrix { background:#0f1a2e; border:1px solid rgba(148,163,184,0.18); border-radius:14px; padding:16px; margin:0 0 18px 0; color:#e2e8f0; font-family:inherit; }',
      '#naigVenueMatrix .nvm-header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; margin-bottom:14px; }',
      '#naigVenueMatrix .nvm-title-row { display:flex; align-items:baseline; gap:10px; }',
      '#naigVenueMatrix .nvm-title { font-size:16px; font-weight:700; color:#f8fafc; }',
      '#naigVenueMatrix .nvm-count { font-size:12px; color:#94a3b8; }',
      '#naigVenueMatrix .nvm-controls { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }',
      '#naigVenueMatrix .nvm-toggle { display:inline-flex; border:1px solid rgba(148,163,184,0.3); border-radius:8px; overflow:hidden; }',
      '#naigVenueMatrix .nvm-toggle-btn { background:#111d33; color:#94a3b8; border:none; padding:6px 12px; font-size:12px; cursor:pointer; }',
      '#naigVenueMatrix .nvm-toggle-btn.nvm-active { background:#1e3a5f; color:#f8fafc; }',
      '#naigVenueMatrix .nvm-search { background:#0b1424; border:1px solid rgba(148,163,184,0.3); border-radius:8px; color:#e2e8f0; padding:6px 10px; font-size:12px; min-width:180px; }',
      '#naigVenueMatrix .nvm-select { background:#0b1424; border:1px solid rgba(148,163,184,0.3); border-radius:8px; color:#e2e8f0; padding:6px 10px; font-size:12px; }',
      '#naigVenueMatrix .nvm-export-btn { background:#1e3a5f; border:1px solid rgba(148,163,184,0.3); border-radius:8px; color:#f8fafc; padding:6px 12px; font-size:12px; cursor:pointer; }',
      '#naigVenueMatrix .nvm-export-btn:hover { background:#254a78; }',
      '#naigVenueMatrix .nvm-body { position:relative; }',
      '#naigVenueMatrix .nvm-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; }',
      '#naigVenueMatrix .nvm-card { background:#131f38; border:1px solid rgba(148,163,184,0.18); border-radius:10px; padding:12px; }',
      '#naigVenueMatrix .nvm-card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:6px; }',
      '#naigVenueMatrix .nvm-card-name { font-size:13px; font-weight:700; color:#f8fafc; }',
      '#naigVenueMatrix .nvm-card-loc { font-size:12px; color:#94a3b8; margin-bottom:8px; }',
      '#naigVenueMatrix .nvm-card-meta { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }',
      '#naigVenueMatrix .nvm-meta-item { font-size:11px; color:#cbd5e1; background:rgba(148,163,184,0.12); border-radius:6px; padding:2px 6px; }',
      '#naigVenueMatrix .nvm-card-facts { display:flex; flex-wrap:wrap; gap:6px; border-top:1px solid rgba(148,163,184,0.14); padding-top:8px; }',
      '#naigVenueMatrix .nvm-fact { font-size:11px; color:#a7c7ff; }',
      '#naigVenueMatrix .nvm-pill { font-size:11px; font-weight:600; border:1px solid; border-radius:999px; padding:2px 9px; white-space:nowrap; }',
      '#naigVenueMatrix .nvm-pill-sm { font-size:10px; padding:1px 7px; }',
      '#naigVenueMatrix .nvm-table-wrap { overflow-x:auto; border:1px solid rgba(148,163,184,0.18); border-radius:10px; }',
      '#naigVenueMatrix .nvm-table { width:100%; border-collapse:collapse; font-size:12px; }',
      '#naigVenueMatrix .nvm-th { text-align:left; padding:8px 10px; background:#111d33; color:#cbd5e1; font-weight:700; cursor:pointer; white-space:nowrap; border-bottom:1px solid rgba(148,163,184,0.2); }',
      '#naigVenueMatrix .nvm-th:hover { color:#f8fafc; }',
      '#naigVenueMatrix .nvm-td { padding:7px 10px; border-bottom:1px solid rgba(148,163,184,0.1); color:#e2e8f0; }',
      '#naigVenueMatrix .nvm-tr:hover { background:rgba(148,163,184,0.06); }',
      '#naigVenueMatrix .nvm-empty { text-align:center; color:#94a3b8; padding:24px; font-size:12px; }',
      '#naigVenueMatrix .nvm-error { margin-top:10px; font-size:12px; color:#f87171; }'
    ].join('\n')));
    document.head.appendChild(style);
  }

  function buildSkeleton(tabEl) {
    var existing = document.getElementById('naigVenueMatrix');
    if (existing) return existing;
    var panel = document.createElement('div');
    panel.id = 'naigVenueMatrix';
    panel.innerHTML = [
      '<div class="nvm-header">',
        '<div class="nvm-title-row">',
          '<span class="nvm-title">Venue Matrix</span>',
          '<span class="nvm-count" id="nvmCount">0 venues</span>',
        '</div>',
        '<div class="nvm-controls">',
          '<div class="nvm-toggle" id="nvmToggle">',
            '<button type="button" class="nvm-toggle-btn nvm-active" data-view="grid">Grid</button>',
            '<button type="button" class="nvm-toggle-btn" data-view="table">Table</button>',
          '</div>',
          '<input type="text" id="nvmSearch" class="nvm-search" placeholder="Search name, location, sports, contact" />',
          '<select id="nvmStatusFilter" class="nvm-select"><option value="">All statuses</option></select>',
          '<button type="button" id="nvmExportBtn" class="nvm-export-btn">↓ CSV</button>',
        '</div>',
      '</div>',
      '<div class="nvm-body">',
        '<div class="nvm-grid" id="nvmGrid"></div>',
        '<div class="nvm-table-wrap" id="nvmTableWrap" style="display:none;">',
          '<table class="nvm-table" id="nvmTable">',
            '<thead><tr id="nvmTableHead"></tr></thead>',
            '<tbody id="nvmTableBody"></tbody>',
          '</table>',
        '</div>',
      '</div>',
      '<div class="nvm-error" id="nvmError" style="display:none;"></div>'
    ].join('');

    if (tabEl.firstChild) {
      tabEl.insertBefore(panel, tabEl.firstChild);
    } else {
      tabEl.appendChild(panel);
    }
    return panel;
  }

  function wireEvents(panel) {
    if (panel.getAttribute('data-nvm-wired') === '1') return;
    panel.setAttribute('data-nvm-wired', '1');

    var searchBox = document.getElementById('nvmSearch');
    if (searchBox) {
      searchBox.addEventListener('input', function () {
        nvmSearchText = searchBox.value || '';
        renderAll();
      });
    }

    var statusSel = document.getElementById('nvmStatusFilter');
    if (statusSel) {
      statusSel.addEventListener('change', function () {
        nvmStatusPick = statusSel.value || '';
        renderAll();
      });
    }

    var toggle = document.getElementById('nvmToggle');
    if (toggle) {
      toggle.addEventListener('click', function (evt) {
        var target = evt.target;
        if (!target || !target.getAttribute) return;
        var view = target.getAttribute('data-view');
        if (!view) return;
        nvmView = view;
        applyViewVisibility();
      });
    }

    var exportBtn = document.getElementById('nvmExportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () { exportCsv(); });
    }

    var tableHead = document.getElementById('nvmTableHead');
    if (tableHead) {
      tableHead.addEventListener('click', function (evt) {
        var target = evt.target;
        if (!target || !target.getAttribute) return;
        var key = target.getAttribute('data-sortkey');
        if (!key) return;
        if (nvmSortKey === key) {
          nvmSortDir = (nvmSortDir === 'asc') ? 'desc' : 'asc';
        } else {
          nvmSortKey = key;
          nvmSortDir = 'asc';
        }
        renderAll();
      });
    }
  }

  function loadAndRender() {
    Promise.resolve()
      .then(function () {
        return import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      })
      .then(function (m) {
        return m.get(_dbRef('naig2027/venues'));
      })
      .then(function (snap) {
        var data = (snap && typeof snap.val === 'function') ? (snap.val() || {}) : {};
        var rows = [];
        for (var vid in data) {
          if (!data.hasOwnProperty(vid)) continue;
          rows.push(normalizeVenue(vid, data[vid]));
        }
        nvmRows = rows;
        renderAll();
      })
      .catch(function (e) {
        showError('Could not load venues: ' + (e && e.message ? e.message : String(e)));
      });
  }

  function setup(tabEl) {
    try {
      ensureStyles();
      var panel = buildSkeleton(tabEl);
      wireEvents(panel);
      loadAndRender();
    } catch (e) {
      try { showError('Setup error: ' + (e && e.message ? e.message : String(e))); } catch (e2) { }
    }
  }

  function startFinder() {
    findTimer = setInterval(function () {
      findAttempts += 1;
      var tabEl = document.getElementById('tabvenues');
      if (tabEl) {
        clearInterval(findTimer);
        findTimer = null;
        setup(tabEl);
        return;
      }
      if (findAttempts >= FIND_TRIES_MAX) {
        clearInterval(findTimer);
        findTimer = null;
      }
    }, FIND_INTERVAL_MS);
  }

  try {
    startFinder();
  } catch (e) { }

  window.__naigVenueMatrixRefresh = function () {
    try {
      loadAndRender();
    } catch (e) {
      try { showError('Refresh error: ' + (e && e.message ? e.message : String(e))); } catch (e2) { }
    }
  };
})();
