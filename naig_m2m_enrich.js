(function(){
'use strict';

if (window.__naigM2MEnrichBooted) { return; }
window.__naigM2MEnrichBooted = true;

var gDayData = {};
var gFbMod = null;
var gRules = { singles: [], ambiguous: [] };
var gSportRows = [];
var gStaffRows = [];

var ALIAS_SEED = ['badminton','basketball','chess','cricket-hardball','cricket-tapeball',
  'dance','flag-football','football-soccer','pickleball','table-tennis','tennis',
  'throwball','track','volleyball-intl'];

var ALIAS_DICT = {
  'cricket-hardball': [/hard\s*ball/i],
  'cricket-tapeball': [/tape\s*ball/i],
  'flag-football': [/flag\s*-?\s*football/i, /\bflag\b/i],
  'football-soccer': [/soccer/i, /\b11v11\b/i, /\b7v7\b/i],
  'table-tennis': [/table\s*-?\s*tennis/i, /\bTT\b/],
  'pickleball': [/pickle\s*ball/i],
  'badminton': [/badminton/i],
  'basketball': [/basketball/i],
  'chess': [/chess/i],
  'dance': [/danc(e|ing)/i],
  'throwball': [/throw\s*ball/i],
  'track': [/\btrack\b/i, /athletics/i],
  'volleyball-intl': [/volley\s*ball/i],
  'tennis': [/\btennis\b/i]
};
var SINGLE_ORDER = ['cricket-hardball','cricket-tapeball','flag-football','football-soccer',
  'table-tennis','pickleball','badminton','basketball','chess','dance','throwball','track',
  'volleyball-intl','tennis'];

function dbref(path){ return _dbRef(path); }

function mkEl(tag, cls, text){
  var el = document.createElement(tag);
  if (cls) { el.className = cls; }
  if (text !== undefined && text !== null) { el.textContent = text; }
  return el;
}

function truncateText(s, n){
  if (!s) { return ''; }
  s = String(s);
  if (s.length <= n) { return s; }
  return s.slice(0, n - 1) + String.fromCharCode(8230);
}

function parseTimeToMin(s){
  if (!s || typeof s !== 'string') { return null; }
  var m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) { return null; }
  var hh = parseInt(m[1], 10);
  var mm = parseInt(m[2], 10);
  if (isNaN(hh) || isNaN(mm)) { return null; }
  return hh * 60 + mm;
}

function adjustedEndMin(startMin, endMin){
  if (endMin < startMin) { return endMin + 1440; }
  return endMin;
}

function combineText(block){
  var parts = [];
  if (block.activity) { parts.push(String(block.activity)); }
  if (block.detail) { parts.push(String(block.detail)); }
  if (block.location) { parts.push(String(block.location)); }
  if (block.venueName) { parts.push(String(block.venueName)); }
  return parts.join(' | ');
}

function buildRules(liveKeys){
  var have = function(k){ return liveKeys.indexOf(k) !== -1; };
  var singles = [];
  for (var i = 0; i < SINGLE_ORDER.length; i++){
    var k = SINGLE_ORDER[i];
    if (have(k) && ALIAS_DICT[k]) { singles.push({ sport: k, res: ALIAS_DICT[k] }); }
  }
  var ambiguous = [];
  var cricketCand = [];
  if (have('cricket-hardball')) { cricketCand.push('cricket-hardball'); }
  if (have('cricket-tapeball')) { cricketCand.push('cricket-tapeball'); }
  if (cricketCand.length > 1) { ambiguous.push({ res: [/\bcricket\b/i], candidates: cricketCand }); }
  var footballCand = [];
  if (have('flag-football')) { footballCand.push('flag-football'); }
  if (have('football-soccer')) { footballCand.push('football-soccer'); }
  if (footballCand.length > 1) { ambiguous.push({ res: [/\bfootball\b/i], candidates: footballCand }); }
  return { singles: singles, ambiguous: ambiguous };
}

function matchSport(text){
  for (var i = 0; i < gRules.singles.length; i++){
    var rule = gRules.singles[i];
    for (var j = 0; j < rule.res.length; j++){
      if (rule.res[j].test(text)) {
        return { confidence: 'high', sportKey: rule.sport, candidates: [rule.sport] };
      }
    }
  }
  for (var k = 0; k < gRules.ambiguous.length; k++){
    var amb = gRules.ambiguous[k];
    for (var m = 0; m < amb.res.length; m++){
      if (amb.res[m].test(text)) {
        return { confidence: 'review', sportKey: null, candidates: amb.candidates };
      }
    }
  }
  return { confidence: 'none', sportKey: null, candidates: [] };
}

function computePeakConcurrent(list, field){
  var events = [];
  for (var i = 0; i < list.length; i++){
    var it = list[i];
    var val = it[field];
    if (val === null || val === undefined) { continue; }
    if (it.startMin === null || it.endMin === null) { continue; }
    events.push({ t: it.startMin, d: val, isStart: true });
    events.push({ t: it.endMin, d: -val, isStart: false });
  }
  if (!events.length) { return null; }
  events.sort(function(a, b){
    if (a.t !== b.t) { return a.t - b.t; }
    if (a.isStart === b.isStart) { return 0; }
    return a.isStart ? 1 : -1;
  });
  var running = 0;
  var peak = 0;
  for (var j = 0; j < events.length; j++){
    running += events[j].d;
    if (running > peak) { peak = running; }
  }
  return peak;
}

function scanAllBlocks(){
  var rows = [];
  var totalBlocks = 0;
  var skippedDays = [];
  var dayKeys = Object.keys(gDayData || {});
  for (var i = 0; i < dayKeys.length; i++){
    var dayKey = dayKeys[i];
    var day = gDayData[dayKey];
    if (!day) { continue; }
    if (!Array.isArray(day.blocks)) { skippedDays.push(dayKey); continue; }
    var dayLabel = day.label || day.day || dayKey;
    for (var idx = 0; idx < day.blocks.length; idx++){
      var block = day.blocks[idx];
      if (!block || typeof block !== 'object') { continue; }
      totalBlocks++;
      rows.push({ dayKey: dayKey, dayLabel: dayLabel, idx: idx, block: block });
    }
  }
  return { rows: rows, totalBlocks: totalBlocks, skippedDays: skippedDays };
}

function injectStyles(){
  if (document.getElementById('naigm2m-enrich-style')) { return; }
  var css = '';
  css += '#naigM2MEnrich{background:#0f1b2e;color:#e7edf5;border:1px solid #26405f;border-radius:8px;padding:12px;margin-bottom:16px;font-family:inherit;font-size:13px;}';
  css += '#naigM2MEnrich .naigm2m-tabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}';
  css += '#naigM2MEnrich .naigm2m-tabbtn{background:#152540;color:#c9d6e8;border:1px solid #26405f;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;}';
  css += '#naigM2MEnrich .naigm2m-tabbtn.active{background:#1E3A8A;color:#fff;border-color:#1E3A8A;}';
  css += '#naigM2MEnrich .naigm2m-status{color:#9db3cc;margin-bottom:8px;font-size:12px;}';
  css += '#naigM2MEnrich .naigm2m-pane{margin-top:6px;}';
  css += '#naigM2MEnrich .naigm2m-toolbar{display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap;}';
  css += '#naigM2MEnrich .naigm2m-btn{background:#BF1B2A;color:#fff;border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:12px;font-weight:600;}';
  css += '#naigM2MEnrich .naigm2m-btn:hover{opacity:0.9;}';
  css += '#naigM2MEnrich .naigm2m-counts{color:#9db3cc;font-size:12px;}';
  css += '#naigM2MEnrich .naigm2m-warning{background:#3a2412;border:1px solid #a5620e;color:#ffcf9e;padding:6px 10px;border-radius:6px;margin-bottom:8px;font-size:12px;}';
  css += '#naigM2MEnrich .naigm2m-result{color:#9fe3a8;font-size:12px;margin-bottom:8px;min-height:14px;}';
  css += '#naigM2MEnrich table.naigm2m-table{width:100%;border-collapse:collapse;font-size:12px;}';
  css += '#naigM2MEnrich table.naigm2m-table th{text-align:left;color:#9db3cc;border-bottom:1px solid #26405f;padding:5px 6px;}';
  css += '#naigM2MEnrich table.naigm2m-table td{border-bottom:1px solid #1c2f47;padding:5px 6px;vertical-align:top;}';
  css += '#naigM2MEnrich .naigm2m-activity{max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}';
  css += '#naigM2MEnrich select{background:#0b1626;color:#e7edf5;border:1px solid #2c4a70;border-radius:4px;padding:3px 5px;font-size:12px;}';
  css += '#naigM2MEnrich input.naigm2m-numinput{background:#0b1626;color:#e7edf5;border:1px solid #2c4a70;border-radius:4px;padding:3px 5px;font-size:12px;width:64px;}';
  css += '#naigM2MEnrich .naigm2m-badge-high{background:#1c5c34;color:#b6f0c4;border-radius:4px;padding:2px 6px;font-size:11px;}';
  css += '#naigM2MEnrich .naigm2m-badge-review{background:#5c3d1c;color:#f0cf9c;border-radius:4px;padding:2px 6px;font-size:11px;}';
  css += '#naigM2MEnrich .naigm2m-rollupgrid{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;}';
  css += '#naigM2MEnrich .naigm2m-rollupbox{background:#132338;border:1px solid #26405f;border-radius:6px;padding:8px 10px;min-width:200px;flex:1;}';
  css += '#naigM2MEnrich .naigm2m-rollupboxtitle{color:#9db3cc;font-size:11px;text-transform:uppercase;margin-bottom:6px;letter-spacing:0.03em;}';
  css += '#naigM2MEnrich .naigm2m-rollupline{font-size:12px;padding:2px 0;}';
  css += '#naigM2MEnrich .naigm2m-sectiontitle{color:#e7edf5;font-weight:600;margin:10px 0 6px;font-size:13px;}';
  css += '#naigM2MEnrich .naigm2m-doublebooked{background:#2a1420;border:1px solid #BF1B2A;border-radius:6px;padding:8px 10px;margin-bottom:10px;}';
  css += '#naigM2MEnrich .naigm2m-flag-clear{color:#9fe3a8;font-size:12px;padding:2px 0;}';
  css += '#naigM2MEnrich .naigm2m-flag-tight{color:#f0cf6c;font-size:12px;padding:2px 0;}';
  css += '#naigM2MEnrich .naigm2m-flag-overlap{color:#ff8f8f;font-size:12px;padding:2px 0;font-weight:600;}';
  css += '#naigM2MEnrich .naigm2m-daybox{margin-bottom:12px;}';
  var styleEl = document.createElement('style');
  styleEl.id = 'naigm2m-enrich-style';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

function panelSkeletonHtml(){
  var s = '';
  s += '<div class="naigm2m-tabs">';
  s += '<button type="button" class="naigm2m-tabbtn active" data-naigtab="sport">Sport Tags</button>';
  s += '<button type="button" class="naigm2m-tabbtn" data-naigtab="staff">Staffing</button>';
  s += '<button type="button" class="naigm2m-tabbtn" data-naigtab="handoff">Hand-offs</button>';
  s += '</div>';
  s += '<div class="naigm2m-status" id="naigm2m-status">Loading...</div>';
  s += '<div class="naigm2m-pane" id="naigm2m-pane-sport"></div>';
  s += '<div class="naigm2m-pane" id="naigm2m-pane-staff" style="display:none;"></div>';
  s += '<div class="naigm2m-pane" id="naigm2m-pane-handoff" style="display:none;"></div>';
  return s;
}

function wireTabs(panel){
  var btns = panel.querySelectorAll('.naigm2m-tabbtn');
  for (var i = 0; i < btns.length; i++){
    btns[i].onclick = function(){
      var target = this.getAttribute('data-naigtab');
      var allBtns = panel.querySelectorAll('.naigm2m-tabbtn');
      for (var j = 0; j < allBtns.length; j++){ allBtns[j].className = 'naigm2m-tabbtn'; }
      this.className = 'naigm2m-tabbtn active';
      var sportPane = panel.querySelector('#naigm2m-pane-sport');
      var staffPane = panel.querySelector('#naigm2m-pane-staff');
      var handoffPane = panel.querySelector('#naigm2m-pane-handoff');
      if (sportPane) { sportPane.style.display = (target === 'sport') ? '' : 'none'; }
      if (staffPane) { staffPane.style.display = (target === 'staff') ? '' : 'none'; }
      if (handoffPane) { handoffPane.style.display = (target === 'handoff') ? '' : 'none'; }
    };
  }
}

async function loadFbData(){
  var fbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  var m2mSnap = await fbMod.get(dbref('naig2027/m2m'));
  var m2mVal = m2mSnap.exists() ? m2mSnap.val() : {};
  var sportsSnap = await fbMod.get(dbref('naig2027/sports'));
  var sportsVal = sportsSnap.exists() ? sportsSnap.val() : {};
  return { fbMod: fbMod, m2m: m2mVal, sports: sportsVal };
}

async function refreshAll(panel){
  var statusEl = panel.querySelector('#naigm2m-status');
  try {
    if (statusEl) { statusEl.textContent = 'Loading M2M data...'; }
    var data = await loadFbData();
    gFbMod = data.fbMod;
    gDayData = data.m2m || {};
    var sportsKeys = Object.keys(data.sports || {});
    gRules = buildRules(sportsKeys.length ? sportsKeys : ALIAS_SEED.slice());
    if (statusEl) {
      statusEl.textContent = 'Loaded ' + Object.keys(gDayData).length + ' day record(s) from naig2027/m2m.';
    }
    renderSportTab(panel);
    renderStaffTab(panel);
    renderHandoffTab(panel);
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'Failed to load M2M data: ' + (e && e.message ? e.message : String(e)); }
  }
}

function renderSportTab(panel){
  var pane = panel.querySelector('#naigm2m-pane-sport');
  if (!pane) { return; }
  pane.innerHTML = '';
  var scan = scanAllBlocks();
  gSportRows = [];

  var toolbar = mkEl('div', 'naigm2m-toolbar');
  var applyBtn = mkEl('button', 'naigm2m-btn', 'Apply selected tags');
  applyBtn.type = 'button';
  toolbar.appendChild(applyBtn);
  var counts = mkEl('span', 'naigm2m-counts', '');
  toolbar.appendChild(counts);
  pane.appendChild(toolbar);

  if (scan.skippedDays.length) {
    pane.appendChild(mkEl('div', 'naigm2m-warning',
      'Warning: day(s) skipped because blocks is not an array: ' + scan.skippedDays.join(', ')));
  }

  var resultEl = mkEl('div', 'naigm2m-result', '');
  pane.appendChild(resultEl);

  var table = document.createElement('table');
  table.className = 'naigm2m-table';
  var thead = document.createElement('thead');
  var htr = document.createElement('tr');
  var headers = ['Use', 'Day', 'Time', 'Lane', 'Activity', 'Proposed Sport', 'Confidence'];
  for (var h = 0; h < headers.length; h++){ htr.appendChild(mkEl('th', null, headers[h])); }
  thead.appendChild(htr);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  table.appendChild(tbody);
  pane.appendChild(table);

  var highCount = 0;
  var reviewCount = 0;
  for (var r = 0; r < scan.rows.length; r++){
    var rowData = scan.rows[r];
    var text = combineText(rowData.block);
    var match = matchSport(text);
    if (match.confidence === 'none') { continue; }
    if (match.confidence === 'high') { highCount++; } else { reviewCount++; }

    var tr = document.createElement('tr');
    var tdCheck = document.createElement('td');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (match.confidence === 'high');
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    tr.appendChild(mkEl('td', null, rowData.dayLabel));
    tr.appendChild(mkEl('td', null, (rowData.block.start || '?') + '-' + (rowData.block.end || '?')));
    tr.appendChild(mkEl('td', null, rowData.block.lane || ''));

    var tdAct = mkEl('td', 'naigm2m-activity', truncateText(rowData.block.activity, 46));
    tdAct.title = String(rowData.block.activity || '');
    tr.appendChild(tdAct);

    var tdSport = document.createElement('td');
    var selectEl = null;
    if (match.confidence === 'high') {
      tdSport.textContent = match.sportKey;
    } else {
      selectEl = document.createElement('select');
      var blankOpt = document.createElement('option');
      blankOpt.value = '';
      blankOpt.textContent = '(choose - ambiguous)';
      selectEl.appendChild(blankOpt);
      for (var c = 0; c < match.candidates.length; c++){
        var opt = document.createElement('option');
        opt.value = match.candidates[c];
        opt.textContent = match.candidates[c];
        selectEl.appendChild(opt);
      }
      tdSport.appendChild(selectEl);
    }
    tr.appendChild(tdSport);

    var tdConf = document.createElement('td');
    var badgeCls = (match.confidence === 'high') ? 'naigm2m-badge-high' : 'naigm2m-badge-review';
    var badgeTxt = (match.confidence === 'high') ? 'High' : 'Review';
    tdConf.appendChild(mkEl('span', badgeCls, badgeTxt));
    tr.appendChild(tdConf);

    tbody.appendChild(tr);
    gSportRows.push({ dayKey: rowData.dayKey, idx: rowData.idx, checkbox: cb, match: match, select: selectEl });
  }

  var matchedCount = highCount + reviewCount;
  var noSportCount = scan.totalBlocks - matchedCount;
  counts.textContent = matchedCount + ' of ' + scan.totalBlocks + ' blocks matched (' + highCount +
    ' high confidence, ' + reviewCount + ' need review). ' + noSportCount +
    ' block(s) have no sport - that is expected, many are logistics-only.';

  applyBtn.onclick = function(){ applySelectedTags(resultEl); };
}

async function applySelectedTags(resultEl){
  try {
    resultEl.textContent = 'Applying...';
    var byDay = {};
    for (var i = 0; i < gSportRows.length; i++){
      var row = gSportRows[i];
      if (!row.checkbox.checked) { continue; }
      var sportKey = null;
      if (row.match.confidence === 'high') { sportKey = row.match.sportKey; }
      else if (row.select) { sportKey = row.select.value; }
      if (!sportKey) { continue; }
      if (!byDay[row.dayKey]) { byDay[row.dayKey] = []; }
      byDay[row.dayKey].push({ idx: row.idx, sportKey: sportKey });
    }
    var dayKeys = Object.keys(byDay);
    if (!dayKeys.length) { resultEl.textContent = 'No rows selected with a resolved sport.'; return; }

    var fbMod = gFbMod || await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    var messages = [];
    for (var d = 0; d < dayKeys.length; d++){
      var dayKey = dayKeys[d];
      try {
        var freshSnap = await fbMod.get(dbref('naig2027/m2m/' + dayKey));
        var freshDay = freshSnap.exists() ? freshSnap.val() : null;
        if (!freshDay || !Array.isArray(freshDay.blocks)) {
          messages.push(dayKey + ': ABORTED - blocks is not an array, nothing written.');
          continue;
        }
        var updateObj = {};
        var items = byDay[dayKey];
        var appliedCount = 0;
        for (var k = 0; k < items.length; k++){
          var it = items[k];
          if (it.idx < 0 || it.idx >= freshDay.blocks.length) { continue; }
          updateObj['blocks/' + it.idx + '/sportKey'] = it.sportKey;
          appliedCount++;
        }
        if (!appliedCount) { messages.push(dayKey + ': nothing to write (indices out of range).'); continue; }
        await fbMod.update(dbref('naig2027/m2m/' + dayKey), updateObj);
        var verifySnap = await fbMod.get(dbref('naig2027/m2m/' + dayKey));
        var verifyDay = verifySnap.exists() ? verifySnap.val() : null;
        if (verifyDay && Array.isArray(verifyDay.blocks)) {
          messages.push(dayKey + ': applied ' + appliedCount + ' tag(s), verified blocks is still an array (' +
            verifyDay.blocks.length + ' blocks).');
        } else {
          messages.push(dayKey + ': WARNING - wrote ' + appliedCount +
            ' tag(s) but post-write check did not find a valid blocks array. Investigate before trusting this day.');
        }
      } catch (dayErr) {
        messages.push(dayKey + ': failed - ' + (dayErr && dayErr.message ? dayErr.message : String(dayErr)));
      }
    }
    resultEl.textContent = messages.join(' | ');
  } catch (e) {
    resultEl.textContent = 'Apply failed: ' + (e && e.message ? e.message : String(e));
  }
}

function renderStaffTab(panel){
  var pane = panel.querySelector('#naigm2m-pane-staff');
  if (!pane) { return; }
  pane.innerHTML = '';
  var scan = scanAllBlocks();
  gStaffRows = [];

  if (scan.skippedDays.length) {
    pane.appendChild(mkEl('div', 'naigm2m-warning',
      'Warning: day(s) skipped because blocks is not an array: ' + scan.skippedDays.join(', ')));
  }

  var filterBar = mkEl('div', 'naigm2m-toolbar');
  var daySelect = document.createElement('select');
  var dayAllOpt = document.createElement('option');
  dayAllOpt.value = ''; dayAllOpt.textContent = 'All days';
  daySelect.appendChild(dayAllOpt);
  var seenDays = {};
  for (var i = 0; i < scan.rows.length; i++){
    var dk1 = scan.rows[i].dayKey;
    if (!seenDays[dk1]) {
      seenDays[dk1] = true;
      var dOpt = document.createElement('option');
      dOpt.value = dk1; dOpt.textContent = scan.rows[i].dayLabel;
      daySelect.appendChild(dOpt);
    }
  }
  filterBar.appendChild(daySelect);

  var laneSelect = document.createElement('select');
  var laneAllOpt = document.createElement('option');
  laneAllOpt.value = ''; laneAllOpt.textContent = 'All lanes';
  laneSelect.appendChild(laneAllOpt);
  var seenLanes = {};
  for (var j = 0; j < scan.rows.length; j++){
    var ln = scan.rows[j].block.lane || '';
    if (ln && !seenLanes[ln]) {
      seenLanes[ln] = true;
      var lOpt = document.createElement('option');
      lOpt.value = ln; lOpt.textContent = ln;
      laneSelect.appendChild(lOpt);
    }
  }
  filterBar.appendChild(laneSelect);

  var saveBtn = mkEl('button', 'naigm2m-btn', 'Save staffing');
  saveBtn.type = 'button';
  filterBar.appendChild(saveBtn);
  pane.appendChild(filterBar);

  var rollupEl = mkEl('div', 'naigm2m-rollup', '');
  pane.appendChild(rollupEl);

  var resultEl = mkEl('div', 'naigm2m-result', '');
  pane.appendChild(resultEl);

  var table = document.createElement('table');
  table.className = 'naigm2m-table';
  var thead = document.createElement('thead');
  var htr = document.createElement('tr');
  var headers = ['Day', 'Time', 'Lane', 'Activity', 'Owner', 'Headcount', 'Vehicles'];
  for (var h = 0; h < headers.length; h++){ htr.appendChild(mkEl('th', null, headers[h])); }
  thead.appendChild(htr);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  table.appendChild(tbody);
  pane.appendChild(table);

  for (var r = 0; r < scan.rows.length; r++){
    var rowData = scan.rows[r];
    var block = rowData.block;
    var tr = document.createElement('tr');
    tr.appendChild(mkEl('td', null, rowData.dayLabel));
    tr.appendChild(mkEl('td', null, (block.start || '?') + '-' + (block.end || '?')));
    tr.appendChild(mkEl('td', null, block.lane || ''));
    var tdAct = mkEl('td', 'naigm2m-activity', truncateText(block.activity, 40));
    tdAct.title = String(block.activity || '');
    tr.appendChild(tdAct);
    tr.appendChild(mkEl('td', null, block.owner || ''));

    var tdH = document.createElement('td');
    var hInput = document.createElement('input');
    hInput.type = 'number'; hInput.min = '0'; hInput.className = 'naigm2m-numinput';
    if (block.headcount !== undefined && block.headcount !== null && block.headcount !== '') {
      hInput.value = block.headcount;
    }
    tdH.appendChild(hInput);
    tr.appendChild(tdH);

    var tdV = document.createElement('td');
    var vInput = document.createElement('input');
    vInput.type = 'number'; vInput.min = '0'; vInput.className = 'naigm2m-numinput';
    if (block.vehicles !== undefined && block.vehicles !== null && block.vehicles !== '') {
      vInput.value = block.vehicles;
    }
    tdV.appendChild(vInput);
    tr.appendChild(tdV);

    tbody.appendChild(tr);

    var startMin = parseTimeToMin(block.start);
    var endMinRaw = parseTimeToMin(block.end);
    var endMin = (startMin !== null && endMinRaw !== null) ? adjustedEndMin(startMin, endMinRaw) : null;
    var rowRec = {
      dayKey: rowData.dayKey, idx: rowData.idx, dayLabel: rowData.dayLabel,
      lane: block.lane || '', startMin: startMin, endMin: endMin,
      headInput: hInput, vehInput: vInput, tr: tr
    };
    gStaffRows.push(rowRec);
    hInput.oninput = function(){ recomputeRollups(rollupEl); };
    vInput.oninput = function(){ recomputeRollups(rollupEl); };
  }

  daySelect.onchange = function(){ applyStaffFilter(pane); recomputeRollups(rollupEl); };
  laneSelect.onchange = function(){ applyStaffFilter(pane); recomputeRollups(rollupEl); };
  saveBtn.onclick = function(){ saveStaffing(resultEl); };

  daySelect.className = 'naigm2m-dayfilter';
  laneSelect.className = 'naigm2m-lanefilter';
  pane.naigDaySelect = daySelect;
  pane.naigLaneSelect = laneSelect;

  recomputeRollups(rollupEl);
}

function applyStaffFilter(pane){
  var dayVal = pane.naigDaySelect ? pane.naigDaySelect.value : '';
  var laneVal = pane.naigLaneSelect ? pane.naigLaneSelect.value : '';
  for (var i = 0; i < gStaffRows.length; i++){
    var rr = gStaffRows[i];
    var show = (!dayVal || rr.dayKey === dayVal) && (!laneVal || rr.lane === laneVal);
    rr.tr.style.display = show ? '' : 'none';
  }
}

function buildRollupBlock(title, totalsMap, peakMap){
  var box = mkEl('div', 'naigm2m-rollupbox');
  box.appendChild(mkEl('div', 'naigm2m-rollupboxtitle', title));
  var keys = Object.keys(totalsMap);
  if (!keys.length) {
    box.appendChild(mkEl('div', 'naigm2m-rollupline', 'N/A - nothing entered yet'));
    return box;
  }
  for (var i = 0; i < keys.length; i++){
    var k = keys[i];
    var line = k + ': ' + totalsMap[k];
    if (peakMap) {
      var pk = peakMap[k];
      line += ' (peak concurrent: ' + ((pk === null || pk === undefined) ? 'N/A' : pk) + ')';
    }
    box.appendChild(mkEl('div', 'naigm2m-rollupline', line));
  }
  return box;
}

function recomputeRollups(rollupEl){
  try {
    var laneHead = {};
    var laneVeh = {};
    var dayHead = {};
    var dayVeh = {};
    var dayBlocksForPeak = {};
    for (var i = 0; i < gStaffRows.length; i++){
      var rr = gStaffRows[i];
      if (rr.tr.style.display === 'none') { continue; }
      var hv = rr.headInput.value;
      var vv = rr.vehInput.value;
      var hNum = (hv !== '' && !isNaN(Number(hv))) ? Number(hv) : null;
      var vNum = (vv !== '' && !isNaN(Number(vv))) ? Number(vv) : null;
      if (hNum !== null) {
        laneHead[rr.lane] = (laneHead[rr.lane] || 0) + hNum;
        dayHead[rr.dayKey] = (dayHead[rr.dayKey] || 0) + hNum;
      }
      if (vNum !== null) {
        laneVeh[rr.lane] = (laneVeh[rr.lane] || 0) + vNum;
        dayVeh[rr.dayKey] = (dayVeh[rr.dayKey] || 0) + vNum;
      }
      if (!dayBlocksForPeak[rr.dayKey]) { dayBlocksForPeak[rr.dayKey] = []; }
      dayBlocksForPeak[rr.dayKey].push({ startMin: rr.startMin, endMin: rr.endMin, head: hNum, veh: vNum });
    }
    var peakHead = {};
    var peakVeh = {};
    var peakDayKeys = Object.keys(dayBlocksForPeak);
    for (var d = 0; d < peakDayKeys.length; d++){
      var dk2 = peakDayKeys[d];
      peakHead[dk2] = computePeakConcurrent(dayBlocksForPeak[dk2], 'head');
      peakVeh[dk2] = computePeakConcurrent(dayBlocksForPeak[dk2], 'veh');
    }
    rollupEl.innerHTML = '';
    var wrap = mkEl('div', 'naigm2m-rollupgrid');
    wrap.appendChild(buildRollupBlock('By Lane - Headcount', laneHead, null));
    wrap.appendChild(buildRollupBlock('By Lane - Vehicles', laneVeh, null));
    wrap.appendChild(buildRollupBlock('By Day - Headcount (total, peak concurrent)', dayHead, peakHead));
    wrap.appendChild(buildRollupBlock('By Day - Vehicles (total, peak concurrent)', dayVeh, peakVeh));
    rollupEl.appendChild(wrap);
  } catch (e) {
    rollupEl.textContent = 'Rollup computation failed: ' + (e && e.message ? e.message : String(e));
  }
}

async function saveStaffing(resultEl){
  try {
    resultEl.textContent = 'Saving...';
    var byDay = {};
    for (var i = 0; i < gStaffRows.length; i++){
      var rr = gStaffRows[i];
      var hv = rr.headInput.value;
      var vv = rr.vehInput.value;
      var upd = null;
      if (hv !== '' && !isNaN(Number(hv))) { upd = upd || {}; upd.headcount = Number(hv); }
      if (vv !== '' && !isNaN(Number(vv))) { upd = upd || {}; upd.vehicles = Number(vv); }
      if (!upd) { continue; }
      if (!byDay[rr.dayKey]) { byDay[rr.dayKey] = []; }
      byDay[rr.dayKey].push({ idx: rr.idx, fields: upd });
    }
    var dayKeys = Object.keys(byDay);
    if (!dayKeys.length) { resultEl.textContent = 'Nothing entered to save.'; return; }

    var fbMod = gFbMod || await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
    var messages = [];
    for (var d = 0; d < dayKeys.length; d++){
      var dayKey = dayKeys[d];
      try {
        var freshSnap = await fbMod.get(dbref('naig2027/m2m/' + dayKey));
        var freshDay = freshSnap.exists() ? freshSnap.val() : null;
        if (!freshDay || !Array.isArray(freshDay.blocks)) {
          messages.push(dayKey + ': ABORTED - blocks is not an array, nothing written.');
          continue;
        }
        var updateObj = {};
        var items = byDay[dayKey];
        var appliedCount = 0;
        for (var k = 0; k < items.length; k++){
          var it = items[k];
          if (it.idx < 0 || it.idx >= freshDay.blocks.length) { continue; }
          if (it.fields.headcount !== undefined) { updateObj['blocks/' + it.idx + '/headcount'] = it.fields.headcount; }
          if (it.fields.vehicles !== undefined) { updateObj['blocks/' + it.idx + '/vehicles'] = it.fields.vehicles; }
          appliedCount++;
        }
        if (!appliedCount) { messages.push(dayKey + ': nothing to write (indices out of range).'); continue; }
        await fbMod.update(dbref('naig2027/m2m/' + dayKey), updateObj);
        var verifySnap = await fbMod.get(dbref('naig2027/m2m/' + dayKey));
        var verifyDay = verifySnap.exists() ? verifySnap.val() : null;
        if (verifyDay && Array.isArray(verifyDay.blocks)) {
          messages.push(dayKey + ': saved staffing for ' + appliedCount + ' block(s), verified blocks is still an array.');
        } else {
          messages.push(dayKey + ': WARNING - wrote data but post-write check did not find a valid blocks array.');
        }
      } catch (dayErr) {
        messages.push(dayKey + ': failed - ' + (dayErr && dayErr.message ? dayErr.message : String(dayErr)));
      }
    }
    resultEl.textContent = messages.join(' | ');
  } catch (e) {
    resultEl.textContent = 'Save failed: ' + (e && e.message ? e.message : String(e));
  }
}

function renderHandoffTab(panel){
  var pane = panel.querySelector('#naigm2m-pane-handoff');
  if (!pane) { return; }
  pane.innerHTML = '';
  try {
    var scan = scanAllBlocks();
    if (scan.skippedDays.length) {
      pane.appendChild(mkEl('div', 'naigm2m-warning',
        'Warning: day(s) skipped because blocks is not an array: ' + scan.skippedDays.join(', ')));
    }

    var byDay = {};
    for (var i = 0; i < scan.rows.length; i++){
      var rd = scan.rows[i];
      if (!byDay[rd.dayKey]) { byDay[rd.dayKey] = { label: rd.dayLabel, list: [] }; }
      var startMin = parseTimeToMin(rd.block.start);
      var endMinRaw = parseTimeToMin(rd.block.end);
      if (startMin === null || endMinRaw === null) { continue; }
      var endMin = adjustedEndMin(startMin, endMinRaw);
      byDay[rd.dayKey].list.push({ block: rd.block, startMin: startMin, endMin: endMin });
    }
    var dayKeys = Object.keys(byDay);

    var doubleBooked = [];
    for (var d = 0; d < dayKeys.length; d++){
      var dk = dayKeys[d];
      var list = byDay[dk].list;
      for (var a = 0; a < list.length; a++){
        for (var b = a + 1; b < list.length; b++){
          var A = list[a];
          var B = list[b];
          var blkOwnerA = A.block.owner;
          var blkOwnerB = B.block.owner;
          if (!blkOwnerA || !blkOwnerB || blkOwnerA !== blkOwnerB) { continue; }
          var aStart = A.startMin, aEnd = A.endMin;
          var bStart = B.startMin, bEnd = B.endMin;
          var bStartAdj = bStart;
          if (aEnd > 1440 && bStart < (aEnd - 1440)) { bStartAdj = bStart + 1440; }
          var aStartAdj = aStart;
          if (bEnd > 1440 && aStart < (bEnd - 1440)) { aStartAdj = aStart + 1440; }
          var overlap = (aStartAdj < bEnd) && (bStartAdj < aEnd);
          if (overlap) {
            doubleBooked.push({ dayLabel: byDay[dk].label, owner: blkOwnerA, a: A, b: B });
          }
        }
      }
    }

    var dbBox = mkEl('div', 'naigm2m-doublebooked');
    dbBox.appendChild(mkEl('div', 'naigm2m-sectiontitle', 'DOUBLE-BOOKED (real risk)'));
    if (!doubleBooked.length) {
      dbBox.appendChild(mkEl('div', 'naigm2m-rollupline', 'None detected.'));
    } else {
      for (var x = 0; x < doubleBooked.length; x++){
        var dbItem = doubleBooked[x];
        var line = dbItem.dayLabel + ' - ' + dbItem.owner + ': "' +
          truncateText(dbItem.a.block.activity, 30) + '" (' + dbItem.a.block.start + '-' + dbItem.a.block.end +
          ') overlaps "' + truncateText(dbItem.b.block.activity, 30) + '" (' + dbItem.b.block.start + '-' +
          dbItem.b.block.end + ')';
        dbBox.appendChild(mkEl('div', 'naigm2m-flag-overlap', line));
      }
    }
    pane.appendChild(dbBox);

    for (var d2 = 0; d2 < dayKeys.length; d2++){
      var dk2 = dayKeys[d2];
      var dayBox = mkEl('div', 'naigm2m-daybox');
      dayBox.appendChild(mkEl('div', 'naigm2m-sectiontitle', byDay[dk2].label + ' - Hand-offs'));
      var sorted = byDay[dk2].list.slice().sort(function(p, q){ return p.startMin - q.startMin; });
      var anyHandoff = false;
      for (var s = 0; s < sorted.length - 1; s++){
        var P = sorted[s];
        var Q = sorted[s + 1];
        var laneChanged = (P.block.lane || '') !== (Q.block.lane || '');
        var ownerChanged = (P.block.owner || '') !== (Q.block.owner || '');
        if (!laneChanged && !ownerChanged) { continue; }
        anyHandoff = true;
        var pEnd = P.endMin;
        var qStart = Q.startMin;
        if (pEnd > 1440 && qStart < (pEnd - 1440)) { qStart = qStart + 1440; }
        var gap = qStart - pEnd;
        var rowStatus = 'CLEAR';
        if (gap < 0) { rowStatus = 'OVERLAP'; } else if (gap < 15) { rowStatus = 'TIGHT'; }
        var lineTxt = (P.block.start || '?') + '-' + (P.block.end || '?') + ' [' + (P.block.owner || '?') + '/' +
          (P.block.lane || '?') + '] "' + truncateText(P.block.activity, 28) + '" -> ' +
          (Q.block.start || '?') + '-' + (Q.block.end || '?') + ' [' + (Q.block.owner || '?') + '/' +
          (Q.block.lane || '?') + '] "' + truncateText(Q.block.activity, 28) + '" | gap ' + gap + 'm | ' + rowStatus;
        var cls = 'naigm2m-flag-clear';
        if (rowStatus === 'TIGHT') { cls = 'naigm2m-flag-tight'; }
        if (rowStatus === 'OVERLAP') { cls = 'naigm2m-flag-overlap'; }
        dayBox.appendChild(mkEl('div', cls, lineTxt));
      }
      if (!anyHandoff) {
        dayBox.appendChild(mkEl('div', 'naigm2m-rollupline', 'No lane/owner hand-offs detected for this day.'));
      }
      pane.appendChild(dayBox);
    }
  } catch (e) {
    pane.textContent = 'Hand-off view failed: ' + (e && e.message ? e.message : String(e));
  }
}

function buildPanel(tabEl){
  try {
    injectStyles();
    var panel = document.createElement('div');
    panel.id = 'naigM2MEnrich';
    panel.innerHTML = panelSkeletonHtml();
    if (tabEl.firstChild) { tabEl.insertBefore(panel, tabEl.firstChild); } else { tabEl.appendChild(panel); }
    wireTabs(panel);
    window.__naigM2MEnrichRefresh = function(){
      try { refreshAll(panel); } catch (e) {
        var st = panel.querySelector('#naigm2m-status');
        if (st) { st.textContent = 'Refresh failed: ' + (e && e.message ? e.message : String(e)); }
      }
    };
    refreshAll(panel);
  } catch (e) {
    try {
      tabEl.insertAdjacentHTML('afterbegin',
        '<div id="naigM2MEnrich" style="color:#ff8f8f;padding:10px;">M2M enrich panel failed to initialize.</div>');
    } catch (e2) { }
  }
}

var pollTries = 0;
var pollHandle = null;
function pollForHost(){
  pollTries++;
  try {
    var tabEl = document.getElementById('sectionM2M');
    if (tabEl && typeof _dbRef === 'function') {
      if (!document.getElementById('naigM2MEnrich')) { buildPanel(tabEl); }
      if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
      return;
    }
  } catch (e) { }
  if (pollTries >= 60) {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }
}
pollHandle = setInterval(pollForHost, 900);
pollForHost();

})();
