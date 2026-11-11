/* =====================================================================
   MEIS SENIORS '27 - POST OFFICE (Google Apps Script)
   Paste this whole file into Extensions > Apps Script of your Google Sheet.
   Tabs it uses:  People (Name | Secret code)   Messages   Settings (manager code)
   Codes are checked HERE, on Google's server. They are never sent to the website.
   ===================================================================== */

var SHEET_PEOPLE = 'People', SHEET_MSG = 'Messages', SHEET_SET = 'Settings', MAX_FAILS = 8;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MEIS')
    .addItem('1) Create the tabs (first time)', 'setup')
    .addItem('2) Make codes for empty rows', 'makeCodes')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  var p = ss.getSheetByName(SHEET_PEOPLE) || ss.insertSheet(SHEET_PEOPLE);
  if (p.getLastRow() === 0) p.appendRow(['Name', 'Secret code']);
  p.getRange('B:B').setNumberFormat('@');
  var m = ss.getSheetByName(SHEET_MSG) || ss.insertSheet(SHEET_MSG);
  if (m.getLastRow() === 0) m.appendRow(['Time', 'To', 'From (empty = anonymous)', 'Message', 'ID']);
  m.getRange('B:E').setNumberFormat('@');
  var s = ss.getSheetByName(SHEET_SET) || ss.insertSheet(SHEET_SET);
  s.getRange('B1').setNumberFormat('@');
  if (!s.getRange('A1').getValue()) s.getRange('A1').setValue('Manager code');
  if (!String(s.getRange('B1').getValue()).trim()) s.getRange('B1').setValue(String(Math.floor(100000 + Math.random() * 900000)));
}

function makeCodes() {
  setup();
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_PEOPLE), last = sh.getLastRow();
  if (last < 2) { SpreadsheetApp.getUi().alert('Put the names in column A first.'); return; }
  var vals = sh.getRange(2, 1, last - 1, 2).getValues(), used = {}, made = 0;
  vals.forEach(function (r) { var c = String(r[1]).trim(); if (c) used[c] = 1; });
  vals.forEach(function (r) {
    if (String(r[0]).trim() && !String(r[1]).trim()) {
      var c; do { c = String(Math.floor(10000 + Math.random() * 90000)); } while (used[c]);
      used[c] = 1; r[1] = c; made++;
    }
  });
  sh.getRange(2, 2, last - 1, 1).setNumberFormat('@').setValues(vals.map(function (r) { return [r[1]]; }));
  SpreadsheetApp.getUi().alert('Made ' + made + ' new codes.');
}

/* ---------- web app entry points ---------- */
function doGet(e) {
  var a = (e && e.parameter && e.parameter.a) || '';
  if (a === 'names') return out({ ok: true, names: names() });
  return out({ ok: true, hello: 'MEIS post office is open' });
}

function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return out({ ok: false, error: 'bad' }); }
  try {
    if (d.a === 'send') return out(send(d));
    if (d.a === 'read') return out(read(d));
    if (d.a === 'admin') return out(admin(d));
    if (d.a === 'del') return out(del(d));
  } catch (err) { return out({ ok: false, error: 'server' }); }
  return out({ ok: false, error: 'bad' });
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function norm(s) { return String(s || '').trim().toLowerCase(); }
function normCode(s) { return String(s || '').replace(/\D/g, '').replace(/^0+/, ''); }
function sheet(n) { return SpreadsheetApp.getActive().getSheetByName(n); }

function people() {
  var sh = sheet(SHEET_PEOPLE);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().filter(function (r) { return String(r[0]).trim(); });
}
function names() { return people().map(function (r) { return String(r[0]).trim(); }); }
function managerCode() { var s = sheet(SHEET_SET); return s ? normCode(s.getRange('B1').getValue()) : ''; }

/* too many wrong tries -> wait 10 minutes */
function failed(key) { var c = CacheService.getScriptCache(); c.put(key, String(Number(c.get(key) || 0) + 1), 600); }
function locked(key) { return Number(CacheService.getScriptCache().get(key) || 0) >= MAX_FAILS; }
function clearFails(key) { CacheService.getScriptCache().remove(key); }

function send(d) {
  if (d.hp) return { ok: true };
  var to = norm(d.to), hit = people().filter(function (r) { return norm(r[0]) === to; })[0];
  if (!hit) return { ok: false, error: 'noname' };
  var text = String(d.text || '').trim().slice(0, 600);
  if (!text) return { ok: false, error: 'empty' };
  var from = String(d.from || '').trim().slice(0, 40);
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { sheet(SHEET_MSG).appendRow([new Date(), String(hit[0]).trim(), from, text, Utilities.getUuid().slice(0, 8)]); }
  finally { lock.releaseLock(); }
  return { ok: true };
}

function fmt(v) {
  try { return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'd MMM yyyy'); } catch (e) { return ''; }
}
function allMessages() {
  var sh = sheet(SHEET_MSG);
  return sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues() : [];
}

function read(d) {
  var name = norm(d.name), code = normCode(d.code), key = 'f_' + name;
  if (locked(key)) return { ok: false, error: 'locked' };
  var hit = people().filter(function (r) { return norm(r[0]) === name; })[0];
  if (!hit || !code || normCode(hit[1]) !== code) { failed(key); return { ok: false, error: 'bad' }; }
  clearFails(key);
  var mine = allMessages().filter(function (r) { return norm(r[1]) === name; }).reverse()
    .map(function (r) { return { when: fmt(r[0]), from: String(r[2] || '').trim(), text: String(r[3]) }; });
  return { ok: true, messages: mine };
}

/* manager: sees every letter and can delete */
function admin(d) {
  var key = 'f_admin', code = normCode(d.code), mc = managerCode();
  if (locked(key)) return { ok: false, error: 'locked' };
  if (!code || !mc || code !== mc) { failed(key); return { ok: false, error: 'bad' }; }
  clearFails(key);
  var all = allMessages().reverse().map(function (r) {
    return { id: String(r[4]), when: fmt(r[0]), to: String(r[1]), from: String(r[2] || '').trim(), text: String(r[3]) };
  });
  return { ok: true, messages: all };
}

function del(d) {
  var code = normCode(d.code), mc = managerCode();
  if (!code || !mc || code !== mc) return { ok: false, error: 'bad' };
  var id = String(d.id || ''); if (!id) return { ok: false, error: 'bad' };
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var sh = sheet(SHEET_MSG), last = sh.getLastRow();
    if (last < 2) return { ok: false, error: 'bad' };
    var ids = sh.getRange(2, 5, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]) === id) { sh.deleteRow(i + 2); return { ok: true }; } }
  } finally { lock.releaseLock(); }
  return { ok: false, error: 'bad' };
}
