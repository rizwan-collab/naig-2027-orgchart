/**
 * NAIG 2027 DRIVE MONITOR
 * ----------------------------------------------------------------------------
 * Watches the master NAIG shared drive every day, logs every new/changed file
 * to a Change Log sheet (the running memory), emails Rizwan a digest, and
 * pushes anything tagged "logistics" into the Logistics Team Tasks board in the
 * NAIG Logistics Hub (Firebase path naig2027/tasks).
 *
 * WHY APPS SCRIPT AND NOT A CLAUDE SCHEDULED TASK:
 * The NAIG shared drive is not shared with the Google account behind Claude's
 * Drive connector, so a Claude-side job returns an empty folder every time.
 *
 * *** WHICH ACCOUNT MUST OWN THIS SCRIPT ***
 * The NAIG shared drive belongs to Jubilee Monuments Corp. and is reachable
 * from aliriz6683@gmail.com. It is NOT reachable from rizwan@swagprint.com --
 * that account gets Access Denied on the drive root. A copy of this script
 * owned by rizwan@swagprint.com will find nothing, every single day.
 * Run checkAccess() first; it says plainly whether this account can see it.
 *
 * SETUP (one time):
 *   1. Services (+) -> Drive API -> v2 -> Add      <-- REQUIRED, fails without it
 *   2. Run createTrackingSheet()   (creates the Change Log + saves its ID)
 *   3. Run installTrigger()        (daily 8:00 AM America/Chicago)
 *   4. Run testScan()              (last 7 days, sends a real digest to verify)
 */

var CONFIG = {
  // BOTH addresses. The drive lives on aliriz6683@gmail.com; rizwan@swagprint.com
  // gets Access Denied on it. Sending only to the work address meant every file
  // link in the digest hit a permission wall.
  NOTIFY_EMAILS: ['rizwan@swagprint.com', 'aliriz6683@gmail.com'],

  // On top of the fixed addresses above, the digest also goes to everyone in the
  // hub Directory whose Vertical is one of these AND who has an email on file.
  // That is how Shan, Azmina, Sohail and Kiran get added -- put their address on
  // their Directory card and the next run picks them up. No code change, and no
  // second list to keep in sync with the org chart.
  NOTIFY_VERTICALS: ['Core Team'],
  DIRECTORY_URL: 'https://naig-2027-default-rtdb.firebaseio.com/naig2027/prospects.json',

  // Attachment budget. Gmail rejects the whole message over ~25 MB, so this is
  // a hard ceiling, not a preference -- blow it and NOBODY gets the digest.
  // Anything skipped is listed in the email by name and reason, so a missing
  // attachment is never silent.
  ATTACH: true,
  ATTACH_MAX_FILE_BYTES: 5 * 1024 * 1024,    // per file
  ATTACH_MAX_TOTAL_BYTES: 18 * 1024 * 1024,  // all files, leaves headroom under 25 MB
  ATTACH_MAX_COUNT: 20,
  TRACKING_SHEET_ID: '',            // filled automatically by createTrackingSheet()
  END_OF_DAY_HOUR: 8,
  TIMEZONE: 'America/Chicago',

  // The master NAIG drive. Because this ID starts with 0A it is a SHARED DRIVE
  // root, not an ordinary folder, so every Drive query below must pass
  // corpora:'drive' + driveId + supportsAllDrives. A plain folder-parent query
  // silently returns nothing on a shared drive.
  DRIVE_ID: '0ACTTi8u8oyiQUk9PVA',
  DRIVE_LABEL: 'NAIG 2027 Master Drive',

  // Anything whose file name OR folder path contains one of these words gets
  // turned into a task on the Logistics Team Tasks board.
  //
  // 'logistics' alone was far too narrow. The first real scan returned 46
  // changes and tagged zero, yet it included Site Layouts, Sports Flooring &
  // Surface Requirements, the Onsite Meeting Agenda and Cricket scheduling --
  // all squarely this team's work, none of them filed under a folder or name
  // containing the word "logistics". The filter now follows the work, not the
  // filing. Add or remove words here; matching is case-insensitive and matches
  // on whole words only, so "site" does not fire on "website".
  LOGISTICS_TAGS: [
    'logistics', 'venue', 'venues', 'site', 'sites', 'site layout', 'onsite',
    'transport', 'transportation', 'shuttle', 'bus', 'fleet',
    'hotel', 'hotels', 'lodging', 'accommodation', 'accommodations', 'rooming',
    'f&b', 'food', 'catering', 'beverage',
    'equipment', 'signage', 'wayfinding',
    'flooring', 'surface requirement', 'scheduling', 'schedule'
  ],

  FIREBASE_TASKS_URL: 'https://naig-2027-default-rtdb.firebaseio.com/naig2027/tasks.json',
  HUB_URL: 'https://rizwan-collab.github.io/naig-2027-orgchart/'
};

var PROP_LAST_RUN = 'LAST_RUN_TIMESTAMP';
var PROP_SHEET_ID = 'TRACKING_SHEET_ID_OVERRIDE';
var FOLDER_CACHE_ = {};

/* ========================================================================== */
/* ENTRY POINTS                                                               */
/* ========================================================================== */

/** Production entry point. Installed on the daily trigger. */
function runDailyScan() {
  var props = PropertiesService.getScriptProperties();
  var last = props.getProperty(PROP_LAST_RUN);
  var now = new Date();

  if (!last) {
    // First ever run: set the baseline and send nothing. Otherwise the first
    // digest would list every file in the drive's entire history.
    props.setProperty(PROP_LAST_RUN, now.toISOString());
    Logger.log('Baseline set to ' + now.toISOString() + '. No email sent.');
    return;
  }

  var res = findChanges_(last);
  if (res.error) {
    // Baseline deliberately NOT advanced -- otherwise a failed run would skip
    // that window forever and those changes would never be reported.
    sendFailure_(res.error, last);
    Logger.log('Scan FAILED, baseline held at ' + last);
    return;
  }
  var changes = res.list;
  logToSheet_(changes);
  var pushed = pushLogisticsTasks_(changes);
  sendDigest_(changes, last, pushed);
  props.setProperty(PROP_LAST_RUN, now.toISOString());
  Logger.log('Scan complete. ' + changes.length + ' change(s), ' + pushed.length + ' task(s) pushed.');
}

/** Test run: looks back 7 days, sends a real digest, does NOT move the baseline. */
function testScan() {
  var since = new Date(Date.now() - 7 * 86400000).toISOString();
  var res = findChanges_(since);
  if (res.error) { sendFailure_(res.error, since); Logger.log('TEST FAILED: ' + res.error); return; }
  var changes = res.list;
  logToSheet_(changes);
  var pushed = pushLogisticsTasks_(changes);
  sendDigest_(changes, since, pushed);
  Logger.log('TEST: ' + changes.length + ' change(s), ' + pushed.length + ' task(s) pushed.');
}

/** Sends the no-changes email so the formatting can be reviewed. */
function testNoChanges() {
  sendDigest_([], new Date(Date.now() - 86400000).toISOString(), []);
}

/**
 * Run this FIRST on any new copy of the script. It answers one question in
 * plain language: can the account running this script actually see the NAIG
 * drive? Getting this wrong is invisible otherwise -- the scan just reports
 * "no changes" forever.
 */
function checkAccess() {
  var who = 'unknown';
  try { who = Session.getActiveUser().getEmail() || 'unknown'; } catch (e) {}
  var out = ['Running as: ' + who];

  try {
    var d = Drive.Drives.get(CONFIG.DRIVE_ID, { fields: 'id,name' });
    out.push('OK - shared drive visible: "' + d.name + '"');
  } catch (e) {
    out.push('FAIL - cannot see shared drive ' + CONFIG.DRIVE_ID);
    out.push('       ' + e);
    out.push('This account does not have access. Create this script under the');
    out.push('account that can open the drive in a browser, then re-run.');
    Logger.log(out.join('\n'));
    return out.join('\n');
  }

  try {
    var r = Drive.Files.list({
      q: 'trashed = false', corpora: 'drive', driveId: CONFIG.DRIVE_ID,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
      maxResults: 5, fields: 'items(id,title)'
    });
    out.push('OK - query returned ' + ((r.items || []).length) + ' sample item(s).');
  } catch (e) {
    out.push('FAIL - drive is visible but the file query errored: ' + e);
  }
  Logger.log(out.join('\n'));
  return out.join('\n');
}

function resetBaseline() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_LAST_RUN);
  Logger.log('Baseline cleared. Next run sets a fresh one and sends no email.');
}

/* ========================================================================== */
/* DRIVE SCAN                                                                 */
/* ========================================================================== */

function findChanges_(sinceIso) {
  var sheetId = trackingSheetId_();
  var q = "modifiedDate > '" + sinceIso + "' and trashed = false";
  var changes = [];
  var pageToken = null;
  var guard = 0;

  do {
    var res;
    try {
      res = Drive.Files.list({
        q: q,
        corpora: 'drive',
        driveId: CONFIG.DRIVE_ID,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        maxResults: 200,
        pageToken: pageToken,
        fields: 'nextPageToken,items(id,title,mimeType,modifiedDate,createdDate,fileSize,' +
                'alternateLink,lastModifyingUserName,parents(id),explicitlyTrashed)'
      });
    } catch (e) {
      // Do NOT swallow this. The first version logged and broke out of the
      // loop, which produced an empty change list -- indistinguishable from a
      // genuinely quiet drive. The result was a cheerful "All clear" email for
      // a drive the script could not even see. A failure now surfaces.
      Logger.log('Drive query failed: ' + e);
      return { list: [], error: String(e && e.message ? e.message : e) };
    }

    var items = res.items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.mimeType === 'application/vnd.google-apps.folder') continue;
      if (sheetId && it.id === sheetId) continue;   // never report our own log

      var created = it.createdDate ? new Date(it.createdDate).getTime() : 0;
      var isNew = created >= new Date(sinceIso).getTime();
      var path = folderPath_(it.parents && it.parents.length ? it.parents[0].id : null);

      changes.push({
        fileId: it.id,
        fileName: it.title || '(untitled)',
        fileUrl: it.alternateLink || ('https://drive.google.com/file/d/' + it.id),
        mimeType: it.mimeType || '',
        fileType: prettyType_(it.mimeType),
        modified: it.modifiedDate,
        modifiedBy: it.lastModifyingUserName || 'Unknown',
        sizeText: sizeText_(it.fileSize),
        sizeBytes: it.fileSize || 0,   // raw bytes; absent for Google-native files
        action: isNew ? 'New File' : 'Updated',
        path: path,
        isLogistics: isLogistics_(it.title, path)
      });
    }
    pageToken = res.nextPageToken;
  } while (pageToken && ++guard < 25);

  changes.sort(function (a, b) {
    return (a.path || '').localeCompare(b.path || '') ||
           (a.fileName || '').localeCompare(b.fileName || '');
  });
  return { list: changes, error: null };
}

/**
 * Walks a file's parent chain up to the shared drive root so the digest can
 * group by folder. Cached because a single scan hits the same folders over and
 * over and each hop is an API call.
 */
function folderPath_(parentId) {
  var parts = [];
  var guard = 0;
  var id = parentId;
  while (id && guard++ < 10) {
    if (id === CONFIG.DRIVE_ID) break;
    var cached = FOLDER_CACHE_[id];
    if (!cached) {
      try {
        var f = Drive.Files.get(id, { supportsAllDrives: true, fields: 'id,title,parents(id)' });
        cached = { title: f.title, parent: (f.parents && f.parents.length) ? f.parents[0].id : null };
      } catch (e) {
        cached = { title: null, parent: null };
      }
      FOLDER_CACHE_[id] = cached;
    }
    if (cached.title) parts.unshift(cached.title);
    id = cached.parent;
  }
  return parts.length ? parts.join(' / ') : CONFIG.DRIVE_LABEL;
}

/**
 * Whole-word match, not substring. A plain indexOf made 'site' fire on
 * "website" and 'bus' fire on "business", which would have quietly filled the
 * task board with other teams' files. Word boundaries keep it honest while
 * still allowing multi-word entries like "site layout".
 */
function isLogistics_(name, path) {
  var hay = ((name || '') + ' ' + (path || '')).toLowerCase();
  for (var i = 0; i < CONFIG.LOGISTICS_TAGS.length; i++) {
    var term = String(CONFIG.LOGISTICS_TAGS[i] || '').toLowerCase().trim();
    if (!term) continue;
    // Escape regex metacharacters -- 'f&b' is fine but future terms may not be.
    var esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])', 'i').test(hay)) return true;
  }
  return false;
}

/**
 * Which term matched, so the task notes can say why it was created. Without
 * this, a surprising task looks arbitrary and the first instinct is to
 * distrust the whole board.
 */
function logisticsMatch_(name, path) {
  var hay = ((name || '') + ' ' + (path || '')).toLowerCase();
  for (var i = 0; i < CONFIG.LOGISTICS_TAGS.length; i++) {
    var term = String(CONFIG.LOGISTICS_TAGS[i] || '').toLowerCase().trim();
    if (!term) continue;
    var esc = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp('(^|[^a-z0-9])' + esc + '($|[^a-z0-9])', 'i').test(hay)) return term;
  }
  return '';
}

/* ========================================================================== */
/* LOGISTICS TASK PUSH  ->  naig2027/tasks                                    */
/* ========================================================================== */

/**
 * Creates one task per logistics-tagged file. Reads the existing board first
 * and skips any file already represented, so a file that gets edited every day
 * does not create a task every day.
 */
function pushLogisticsTasks_(changes) {
  var candidates = changes.filter(function (c) { return c.isLogistics; });
  if (!candidates.length) return [];

  var existing = {};
  try {
    var resp = UrlFetchApp.fetch(CONFIG.FIREBASE_TASKS_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText() || 'null') || {};
      Object.keys(data).forEach(function (k) {
        var t = data[k];
        if (t && t.driveFileId) existing[t.driveFileId] = true;
      });
    }
  } catch (e) {
    Logger.log('Could not read existing tasks: ' + e);
    // Bail out rather than risk creating duplicates on a board we cannot read.
    return [];
  }

  var payload = {};
  var pushed = [];
  candidates.forEach(function (c) {
    if (existing[c.fileId]) return;
    var key = 'k' + Date.now() + Math.random().toString(36).slice(2, 6);
    payload[key] = {
      title: 'Review: ' + c.fileName,
      status: 'todo',
      priority: 'Medium',
      owner: '',
      scopeArea: 'Site Management',
      due: '',
      notes: 'Auto-created from the NAIG master drive on ' + fmtDate_(new Date()) +
             '. Folder: ' + c.path + '. ' + c.action + ' by ' + c.modifiedBy +
             '. Matched keyword: "' + logisticsMatch_(c.fileName, c.path) + '". ' + c.fileUrl,
      driveFileId: c.fileId,
      driveFileUrl: c.fileUrl,
      src: 'drive-monitor'
    };
    pushed.push(c);
  });

  if (!pushed.length) return [];

  try {
    var res = UrlFetchApp.fetch(CONFIG.FIREBASE_TASKS_URL, {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) {
      Logger.log('Firebase push failed ' + res.getResponseCode() + ': ' + res.getContentText());
      return [];
    }
  } catch (e) {
    Logger.log('Firebase push threw: ' + e);
    return [];
  }
  return pushed;
}

/* ========================================================================== */
/* SHEET LOGGING (the running memory)                                         */
/* ========================================================================== */

function trackingSheetId_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_SHEET_ID) ||
         CONFIG.TRACKING_SHEET_ID || '';
}

function createTrackingSheet_() { return createTrackingSheet(); }

function createTrackingSheet() {
  var ss = SpreadsheetApp.create('NAIG 2027 Drive Monitor - Change Log');
  var sh = ss.getSheets()[0];
  sh.setName('Change Log');
  sh.getRange(1, 1, 1, 9).setValues([[
    'Timestamp', 'File Name', 'Action', 'Folder', 'File Type',
    'What Changed', 'Modified By', 'Logistics Tagged', 'File Link'
  ]]);
  sh.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.setColumnWidth(2, 320);
  sh.setColumnWidth(4, 260);
  sh.setColumnWidth(9, 260);
  PropertiesService.getScriptProperties().setProperty(PROP_SHEET_ID, ss.getId());
  Logger.log('Change Log created: ' + ss.getUrl());
  return ss.getId();
}

function logToSheet_(changes) {
  if (!changes.length) return;
  var id = trackingSheetId_();
  if (!id) { Logger.log('No tracking sheet - run createTrackingSheet() first.'); return; }
  var sh;
  try {
    sh = SpreadsheetApp.openById(id).getSheetByName('Change Log');
  } catch (e) {
    Logger.log('Could not open Change Log: ' + e);
    return;
  }
  if (!sh) return;

  var stamp = fmtDateTime_(new Date());
  var rows = changes.map(function (c) {
    return [
      stamp, c.fileName, c.action, c.path, c.fileType,
      c.action === 'New File' ? 'New File' : ('Updated' + (c.sizeText ? ' (' + c.sizeText + ')' : '')),
      c.modifiedBy, c.isLogistics ? 'Yes' : '', c.fileUrl
    ];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
}

/* ========================================================================== */
/* EMAIL DIGEST                                                               */
/* ========================================================================== */

function sendDigest_(changes, sinceIso, pushed) {
  var today = fmtLongDate_(new Date());
  var subject = changes.length
    ? 'NAIG 2027 Drive - ' + changes.length + ' Change(s) - ' + today
    : 'NAIG 2027 Drive - No Changes - ' + today;

  var att = { blobs: [], skipped: [], totalBytes: 0 };
  if (CONFIG.ATTACH && changes.length) {
    try {
      att = buildAttachments_(changes);
    } catch (e) {
      // Attachments are a convenience. Losing them must never cost the digest.
      Logger.log('Attachment build failed, sending links only: ' + e);
      att = { blobs: [], skipped: [{ name: 'all files', why: 'attachment step errored', url: '' }], totalBytes: 0 };
    }
  }

  var html = buildDigestHtml_(changes, sinceIso, pushed, today, att);
  var to = digestRecipients_().join(',');

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var msg = { to: to, subject: subject, htmlBody: html };
      if (att.blobs.length) msg.attachments = att.blobs;
      MailApp.sendEmail(msg);
      Logger.log('Email sent to ' + to + ' with ' + att.blobs.length + ' attachment(s)');
      return;
    } catch (e) {
      Logger.log('Send attempt ' + attempt + ' failed: ' + e);
      // A rejection is usually total size. Drop the attachments and get the
      // digest out -- the information matters more than the convenience.
      if (att.blobs.length) {
        Logger.log('Retrying without attachments.');
        att = { blobs: [], skipped: att.skipped.concat([{ name: 'all files',
                 why: 'email was rejected with attachments, links only', url: '' }]),
                totalBytes: 0 };
        html = buildDigestHtml_(changes, sinceIso, pushed, today, att);
        continue;
      }
      if (attempt >= 3) throw e;
      Utilities.sleep(45000);
    }
  }
}

/**
 * The full recipient list: the fixed addresses plus every confirmed person in
 * the Directory sitting in a NOTIFY_VERTICALS vertical who has an email.
 *
 * Reading the Directory rather than hardcoding names means the digest list and
 * the org chart cannot drift apart. It also fails safe: if the Directory is
 * unreachable, or nobody has an email yet, the fixed addresses still get the
 * email rather than the whole send collapsing.
 */
function digestRecipients_() {
  var out = [];
  var seen = {};
  function add(e) {
    var v = String(e || '').trim().toLowerCase();
    if (!v || v.indexOf('@') === -1 || seen[v]) return;
    seen[v] = true; out.push(v);
  }
  (CONFIG.NOTIFY_EMAILS || []).forEach(add);

  try {
    var resp = UrlFetchApp.fetch(CONFIG.DIRECTORY_URL, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var raw = JSON.parse(resp.getContentText() || 'null');
      var list = [];
      if (raw && raw.length !== undefined) list = raw;
      else if (raw) { for (var k in raw) if (raw[k]) list.push(raw[k]); }

      var want = {};
      (CONFIG.NOTIFY_VERTICALS || []).forEach(function (v) { want[String(v).toLowerCase()] = true; });

      var added = 0;
      list.forEach(function (p) {
        if (!p || !p.email) return;
        var st = p.status || '';
        if (st !== 'ready' && st !== 'confirmed') return;           // not confirmed yet
        var nm = String(p.name || '').trim();
        if (!nm || nm.toLowerCase() === 'tbd') return;
        if (!want[String(p.vertical || '').toLowerCase()]) return;
        if (!seen[String(p.email).trim().toLowerCase()]) added++;
        add(p.email);
      });
      Logger.log('Directory added ' + added + ' recipient(s).');
    } else {
      Logger.log('Directory unreachable (' + resp.getResponseCode() + '); using fixed list only.');
    }
  } catch (e) {
    Logger.log('Directory lookup failed, using fixed list only: ' + e);
  }
  return out;
}

/**
 * Turns changed files into real email attachments, newest first, within the
 * budget in CONFIG. Returns { blobs, skipped } where skipped explains WHY each
 * omission happened -- a digest that quietly drops files is worse than one that
 * says "too big", because you cannot tell the difference from nothing changing.
 *
 * Google-native files (Docs/Sheets/Slides) have no bytes to download, so they
 * are exported to PDF/XLSX. Their fileSize is absent from the API, which is why
 * the size check happens AFTER the blob exists, not before.
 */
function buildAttachments_(changes) {
  var blobs = [], skipped = [], total = 0;

  var EXPORT = {
    'application/vnd.google-apps.document':     { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.drawing':      { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.spreadsheet':  {
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' }
  };

  // Newest first: if the budget runs out, it should run out on the stale stuff.
  var ordered = changes.slice().sort(function (a, b) {
    return new Date(b.modified).getTime() - new Date(a.modified).getTime();
  });

  for (var i = 0; i < ordered.length; i++) {
    var c = ordered[i];

    if (blobs.length >= CONFIG.ATTACH_MAX_COUNT) {
      skipped.push({ name: c.fileName, why: 'attachment limit reached', url: c.fileUrl });
      continue;
    }
    // Folder-like entries and shortcuts have nothing to attach.
    if (c.mimeType === 'application/vnd.google-apps.shortcut') {
      skipped.push({ name: c.fileName, why: 'shortcut, not a file', url: c.fileUrl });
      continue;
    }
    // Cheap pre-filter for binaries where the API told us the size up front.
    var declared = parseInt(c.sizeBytes, 10);
    if (declared && declared > CONFIG.ATTACH_MAX_FILE_BYTES) {
      skipped.push({ name: c.fileName, why: 'too large (' + sizeText_(declared) + ')', url: c.fileUrl });
      continue;
    }

    var blob = null;
    try {
      var exp = EXPORT[c.mimeType];
      if (exp) {
        var url = 'https://www.googleapis.com/drive/v3/files/' + c.fileId +
                  '/export?mimeType=' + encodeURIComponent(exp.mime) + '&supportsAllDrives=true';
        var resp = UrlFetchApp.fetch(url, {
          headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
          muteHttpExceptions: true
        });
        if (resp.getResponseCode() !== 200) {
          skipped.push({ name: c.fileName, why: 'export failed (' + resp.getResponseCode() + ')', url: c.fileUrl });
          continue;
        }
        blob = resp.getBlob().setName(c.fileName + exp.ext);
      } else {
        blob = DriveApp.getFileById(c.fileId).getBlob().setName(c.fileName);
      }
    } catch (e) {
      skipped.push({ name: c.fileName, why: 'could not download', url: c.fileUrl });
      continue;
    }

    var bytes = blob.getBytes().length;
    if (bytes > CONFIG.ATTACH_MAX_FILE_BYTES) {
      skipped.push({ name: c.fileName, why: 'too large (' + sizeText_(bytes) + ')', url: c.fileUrl });
      continue;
    }
    if (total + bytes > CONFIG.ATTACH_MAX_TOTAL_BYTES) {
      skipped.push({ name: c.fileName, why: 'email size budget full', url: c.fileUrl });
      continue;
    }
    blobs.push(blob);
    total += bytes;
  }

  Logger.log('Attachments: ' + blobs.length + ' (' + sizeText_(total) + '), skipped ' + skipped.length);
  return { blobs: blobs, skipped: skipped, totalBytes: total };
}

/**
 * Sent when the Drive query itself fails. Kept deliberately blunt: the whole
 * point is that a broken monitor must not look like a quiet one.
 */
function sendFailure_(errText, sinceIso) {
  var who = 'unknown';
  try { who = Session.getActiveUser().getEmail() || 'unknown'; } catch (e) {}
  var today = fmtLongDate_(new Date());

  var h = '';
  h += '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>';
  h += '<body style="margin:0;padding:0;background:#f3f4f6;">';
  h += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:24px 0;">';
  h += '<tr><td align="center">';
  h += '<table cellpadding="0" cellspacing="0" border="0" width="620" style="width:620px;max-width:620px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">';
  h += '<tr><td style="background:#991b1b;padding:20px 24px;color:#ffffff;font-size:17px;font-weight:bold;">';
  h += 'NAIG Drive Monitor could not read the drive</td></tr>';
  h += '<tr><td style="padding:20px 24px;color:#374151;font-size:13px;line-height:1.6;">';
  h += '<div style="padding-bottom:12px;">The daily scan did not run. This is <strong>not</strong> a quiet day &mdash; '
     + 'the scan failed before it could look, so treat the drive as unchecked.</div>';
  h += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:12px;">';
  h += '<tr><td style="padding:4px 0;color:#6b7280;width:130px;">Running as</td><td style="padding:4px 0;">' + escapeHtml_(who) + '</td></tr>';
  h += '<tr><td style="padding:4px 0;color:#6b7280;">Shared drive</td><td style="padding:4px 0;">' + escapeHtml_(CONFIG.DRIVE_ID) + '</td></tr>';
  h += '<tr><td style="padding:4px 0;color:#6b7280;">Window start</td><td style="padding:4px 0;">' + escapeHtml_(fmtDateTime_(new Date(sinceIso))) + '</td></tr>';
  h += '</table>';
  h += '<div style="margin-top:14px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;'
     + 'font-family:monospace;font-size:11px;color:#7f1d1d;word-break:break-word;">' + escapeHtml_(errText) + '</div>';
  h += '<div style="margin-top:14px;">Most likely cause: the account above does not have access to that shared drive. '
     + 'Run <strong>checkAccess()</strong> in the script editor &mdash; it says so directly.</div>';
  h += '<div style="margin-top:10px;color:#6b7280;font-size:11px;">The baseline was not advanced, so nothing in this '
     + 'window will be skipped once the scan works again.</div>';
  h += '</td></tr></table></td></tr></table></body></html>';

  try {
    MailApp.sendEmail({
      to: digestRecipients_().join(','),
      subject: 'NAIG 2027 Drive - SCAN FAILED - ' + today,
      htmlBody: h
    });
    Logger.log('Failure email sent to ' + CONFIG.NOTIFY_EMAILS.join(','));
  } catch (e) {
    Logger.log('Could not even send the failure email: ' + e);
  }
}

function buildDigestHtml_(changes, sinceIso, pushed, today, att) {
  att = att || { blobs: [], skipped: [], totalBytes: 0 };
  var newCount = changes.filter(function (c) { return c.action === 'New File'; }).length;
  var updCount = changes.length - newCount;
  var logCount = changes.filter(function (c) { return c.isLogistics; }).length;

  var h = '';
  h += '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>';
  h += '<body style="margin:0;padding:0;background:#f3f4f6;">';
  h += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f4f6;padding:24px 0;">';
  h += '<tr><td align="center">';
  h += '<table cellpadding="0" cellspacing="0" border="0" width="680" style="width:680px;max-width:680px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">';

  // Header
  h += '<tr><td style="background:#1e3a8a;padding:22px 26px;">';
  h += '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
  h += '<td style="color:#ffffff;font-size:19px;font-weight:bold;">NAIG 2027 Master Drive</td>';
  h += '<td align="right"><span style="display:inline-block;background:#ffffff;color:#1e3a8a;font-size:12px;font-weight:bold;padding:5px 11px;border-radius:11px;">'
     + changes.length + ' change' + (changes.length === 1 ? '' : 's') + '</span></td>';
  h += '</tr><tr><td colspan="2" style="color:#c7d2fe;font-size:12px;padding-top:5px;">' + escapeHtml_(today) + '</td></tr>';
  h += '</table></td></tr>';

  // Stats bar
  h += '<tr><td style="padding:0;">';
  h += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;border-bottom:1px solid #e5e7eb;">';
  h += '<tr>';
  h += statCell_('New Files', newCount, '#15803d');
  h += statCell_('Updated', updCount, '#b45309');
  h += statCell_('Logistics Tagged', logCount, '#1d4ed8');
  h += '</tr></table></td></tr>';

  h += '<tr><td style="padding:12px 26px 0;color:#6b7280;font-size:11px;">Since ' + escapeHtml_(fmtDateTime_(new Date(sinceIso))) + '</td></tr>';

  // Attachment summary. States plainly what is attached and what is not, so a
  // missing file reads as "too big" rather than "nothing happened".
  if (changes.length && (att.blobs.length || att.skipped.length)) {
    h += '<tr><td style="padding:14px 26px 0;">';
    h += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">';
    h += '<tr><td style="padding:12px 14px;">';
    h += '<div style="font-size:12px;font-weight:bold;color:#111827;">'
       + att.blobs.length + ' file' + (att.blobs.length === 1 ? '' : 's') + ' attached'
       + (att.totalBytes ? ' (' + sizeText_(att.totalBytes) + ')' : '') + '</div>';
    if (att.skipped.length) {
      h += '<div style="font-size:11px;color:#6b7280;padding-top:6px;">Not attached &mdash; open these from the link:</div>';
      att.skipped.forEach(function (sk) {
        h += '<div style="font-size:11px;color:#374151;padding:2px 0;">&middot;&nbsp;';
        h += sk.url ? ('<a href="' + sk.url + '" style="color:#1d4ed8;text-decoration:underline;">' + escapeHtml_(sk.name) + '</a>')
                    : escapeHtml_(sk.name);
        h += ' <span style="color:#9ca3af;">&mdash; ' + escapeHtml_(sk.why) + '</span></div>';
      });
    }
    h += '<div style="font-size:10px;color:#9ca3af;padding-top:8px;">Drive links only open while signed in as '
       + 'aliriz6683@gmail.com &mdash; the work account has no access to this drive.</div>';
    h += '</td></tr></table></td></tr>';
  }

  if (!changes.length) {
    h += '<tr><td style="padding:26px;">';
    h += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">';
    h += '<tr><td style="padding:20px;text-align:center;color:#166534;font-size:14px;font-weight:bold;">';
    h += '&#10003;&nbsp;All clear &mdash; nothing changed in the master drive.</td></tr></table>';
    h += '</td></tr>';
  } else {
    // Logistics callout first, because that is the part that creates work.
    if (pushed && pushed.length) {
      h += '<tr><td style="padding:18px 26px 0;">';
      h += '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;">';
      h += '<tr><td style="padding:14px 16px;">';
      h += '<div style="color:#1e3a8a;font-size:13px;font-weight:bold;padding-bottom:6px;">'
         + pushed.length + ' item' + (pushed.length === 1 ? '' : 's') + ' added to Logistics Team Tasks</div>';
      pushed.forEach(function (c) {
        h += '<div style="font-size:12px;color:#374151;padding:2px 0;">&middot;&nbsp;'
           + '<a href="' + c.fileUrl + '" style="color:#1d4ed8;text-decoration:underline;font-weight:600;">'
           + escapeHtml_(c.fileName) + '</a></div>';
      });
      h += '<div style="padding-top:8px;"><a href="' + CONFIG.HUB_URL
         + '" style="color:#1d4ed8;text-decoration:underline;font-size:12px;font-weight:600;">Open Logistics Team Tasks &rarr;</a></div>';
      h += '</td></tr></table></td></tr>';
    }

    // Group by folder
    var groups = {}, order = [];
    changes.forEach(function (c) {
      if (!groups[c.path]) { groups[c.path] = []; order.push(c.path); }
      groups[c.path].push(c);
    });

    order.forEach(function (folder) {
      h += '<tr><td style="padding:18px 26px 0;">';
      h += '<div style="font-size:13px;font-weight:bold;color:#111827;border-left:3px solid #1e3a8a;padding-left:9px;margin-bottom:8px;">'
         + escapeHtml_(folder) + '</div>';
      h += '<table cellpadding="0" cellspacing="0" border="0" width="100%">';
      groups[folder].forEach(function (c) {
        var badgeBg = c.action === 'New File' ? '#dcfce7' : '#dbeafe';
        var badgeFg = c.action === 'New File' ? '#166534' : '#1e40af';
        var badgeTx = c.action === 'New File' ? 'NEW' : 'UPDATED';
        h += '<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;">';
        h += '<span style="display:inline-block;background:' + badgeBg + ';color:' + badgeFg
           + ';font-size:9px;font-weight:bold;padding:2px 7px;border-radius:3px;letter-spacing:.5px;">'
           + badgeTx + '</span>&nbsp;&nbsp;';
        h += '<a href="' + c.fileUrl + '" style="color:#1d4ed8;text-decoration:underline;font-weight:600;font-size:13px;">'
           + escapeHtml_(c.fileName) + '</a>';
        if (c.isLogistics) {
          h += '&nbsp;<span style="display:inline-block;background:#1e3a8a;color:#ffffff;font-size:9px;font-weight:bold;padding:2px 6px;border-radius:3px;">LOGISTICS</span>';
        }
        h += '<div style="font-size:11px;color:#6b7280;padding-top:3px;">';
        h += '<span style="display:inline-block;background:#f3f4f6;color:#4b5563;padding:1px 6px;border-radius:3px;">'
           + escapeHtml_(c.fileType) + '</span>&nbsp;&middot;&nbsp;' + escapeHtml_(c.modifiedBy);
        if (c.sizeText) h += '&nbsp;&middot;&nbsp;' + c.sizeText;
        h += '&nbsp;&middot;&nbsp;' + escapeHtml_(fmtDateTime_(new Date(c.modified)));
        h += '</div></td></tr>';
      });
      h += '</table></td></tr>';
    });

    h += '<tr><td style="padding:18px 26px 0;">';
    h += '<a href="https://drive.google.com/drive/folders/' + CONFIG.DRIVE_ID
       + '" style="color:#1d4ed8;text-decoration:underline;font-size:12px;font-weight:600;">View the master drive &rarr;</a>';
    h += '</td></tr>';
  }

  // Footer
  h += '<tr><td style="padding:22px 26px;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb;margin-top:18px;">';
  h += 'NAIG 2027 Drive Monitor &middot; runs daily at ' + CONFIG.END_OF_DAY_HOUR + ':00 '
     + escapeHtml_(CONFIG.TIMEZONE) + '<br>Every change is logged to the Change Log sheet.';
  h += '</td></tr>';

  h += '</table></td></tr></table></body></html>';
  return h;
}

function statCell_(label, value, color) {
  return '<td width="33%" style="padding:14px 10px;text-align:center;border-right:1px solid #e5e7eb;">'
       + '<div style="font-size:22px;font-weight:bold;color:' + color + ';">' + value + '</div>'
       + '<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;padding-top:2px;">'
       + escapeHtml_(label) + '</div></td>';
}

/* ========================================================================== */
/* TRIGGER                                                                    */
/* ========================================================================== */

function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger('runDailyScan')
    .timeBased()
    .atHour(CONFIG.END_OF_DAY_HOUR)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();
  Logger.log('Daily trigger installed for ' + CONFIG.END_OF_DAY_HOUR + ':00 ' + CONFIG.TIMEZONE);
}

function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  Logger.log('All project triggers removed.');
}

/* ========================================================================== */
/* HELPERS                                                                    */
/* ========================================================================== */

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sizeText_(bytes) {
  var b = parseInt(bytes, 10);
  if (!b || isNaN(b)) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function prettyType_(mime) {
  var m = {
    'application/vnd.google-apps.document': 'Doc',
    'application/vnd.google-apps.spreadsheet': 'Sheet',
    'application/vnd.google-apps.presentation': 'Slides',
    'application/vnd.google-apps.form': 'Form',
    'application/pdf': 'PDF',
    'image/png': 'Image', 'image/jpeg': 'Image', 'image/gif': 'Image',
    'video/mp4': 'Video', 'text/csv': 'CSV', 'text/plain': 'Text',
    'application/zip': 'Zip'
  };
  if (m[mime]) return m[mime];
  if (!mime) return 'File';
  if (mime.indexOf('word') !== -1) return 'Word';
  if (mime.indexOf('sheet') !== -1 || mime.indexOf('excel') !== -1) return 'Excel';
  if (mime.indexOf('presentation') !== -1 || mime.indexOf('powerpoint') !== -1) return 'PowerPoint';
  if (mime.indexOf('image/') === 0) return 'Image';
  if (mime.indexOf('video/') === 0) return 'Video';
  if (mime.indexOf('audio/') === 0) return 'Audio';
  return 'File';
}

function fmtDate_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'MMM d, yyyy'); }
function fmtDateTime_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'MMM d, yyyy h:mm a'); }
function fmtLongDate_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'EEEE, MMMM d, yyyy'); }
