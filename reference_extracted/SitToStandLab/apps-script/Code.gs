/**
 * Sit-to-Stand Biomechanics Lab - Google Sheets receiver
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment > Web app
 *   Execute as: Me      Who has access: Anyone
 * Paste the /exec URL into CONFIG.sheets.webhookUrl (config.js).
 *
 * Sheets created automatically: Sessions (1 row/test), Reps (1 row/rep attempt), Frames (optional time series).
 * Columns are matched BY NAME; new keys from a newer schema are appended as new columns.
 * Re-sent sessions (same session_id) are ignored ("duplicate").
 */
var SHEET_SESSIONS = 'Sessions', SHEET_REPS = 'Reps', SHEET_FRAMES = 'Frames';

function doGet() {
  return json_({ status: 'active', service: 'sts-lab' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var p = JSON.parse(e.postData.contents);
    if (!p.summary || !p.summary.session_id) return json_({ status: 'error', message: 'summary.session_id missing' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sid = String(p.summary.session_id);

    var sessions = sheet_(ss, SHEET_SESSIONS);
    if (sessionExists_(sessions, sid)) return json_({ status: 'duplicate', session_id: sid });

    var rows = 0;
    rows += append_(sessions, [p.summary]);
    if (p.reps && p.reps.length) rows += append_(sheet_(ss, SHEET_REPS), p.reps);
    if (p.frames && p.frames.length) rows += append_(sheet_(ss, SHEET_FRAMES), p.frames);
    SpreadsheetApp.flush();
    return json_({ status: 'success', session_id: sid, rowsWritten: rows });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function sheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function sessionExists_(sh, sid) {
  var last = sh.getLastRow();
  if (last < 2) return false;
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = header.indexOf('session_id');
  if (col < 0) return false;
  var vals = sh.getRange(2, col + 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === sid) return true;
  return false;
}

/** Append objects as rows, mapping keys to header names; adds missing columns. Returns rows written. */
function append_(sh, objs) {
  var header = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
  var added = false;
  objs.forEach(function (o) {
    Object.keys(o).forEach(function (k) { if (header.indexOf(k) < 0) { header.push(k); added = true; } });
  });
  if (added || sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var data = objs.map(function (o) {
    return header.map(function (k) {
      var v = o[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;   // block formula injection
      return v;
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, data.length, header.length).setValues(data);
  return data.length;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
