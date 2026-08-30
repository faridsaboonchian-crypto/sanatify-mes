const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
if (h.indexOf('APPEND-FIX v1') !== -1) { console.log('already applied'); process.exit(0); }
const idx = h.lastIndexOf('</script>');
if (idx === -1) { console.log('ERROR'); process.exit(1); }
const block = `
// ===== APPEND-FIX v1 (الحاقی — بدون تغییر کدهای قبلی) =====
function invNewRequestId(prefix) { return (prefix || 'web') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function invMsg(id, text, ok) { const el = document.getElementById(id); if (!el) return; el.textContent = text || ''; el.style.color = ok ? '#059669' : '#dc2626'; }
function invItem(itemId) { const it = ((inventoryData && inventoryData.items) || []).find(function (x) { return String(x.id) === String(itemId); }); return it || null; }
const INV_WAREHOUSES = { raw: 'مواد خام', product: 'محصول', spare: 'قطعات یدکی', quarantine: 'قرنطینه' };
const INV_STATUS_FA = { available: 'قابل مصرف', quarantine: 'قرنطینه', rejected: 'مردود' };
const INV_TX_FA = { receipt: 'رسید', issue: 'حواله', transfer: 'انتقال', adjustment: 'اصلاح' };
const WORKTYPE_FA = { breakdown: 'تعمیر خرابی اضطراری', repair: 'تعمیر برنامه‌ریزی‌شده', pm: 'PM پیشگیرانه' };
const PRIORITY_FA = { low: 'کم', medium: 'متوسط', high: 'بالا', critical: 'بحرانی' };
let lastGenealogy = null; let lastBalance = null;
function downloadCsv(filename, headers, rows, title) {
  var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var lines = [];
  if (title) { lines.push(q(title)); lines.push(''); }
  lines.push((headers || []).map(function (h) { return q(h.label); }).join(','));
  (rows || []).forEach(function (r) { lines.push((headers || []).map(function (h) { return q(r[h.key]); }).join(',')); });
  var csv = '\\uFEFF' + lines.join('\\r\\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url; a.download = (filename || 'export') + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}
function pmStatus(p) {
  try {
    var last = jalaliToDate(p.last_done || '');
    if (!last) return { next: '-', days: 9999 };
    var next = new Date(last.getTime() + (Number(p.interval_days) || 0) * 86400000);
    return { next: next.toLocaleDateString('fa-IR'), days: Math.round((next.getTime() - Date.now()) / 86400000) };
  } catch (e) { return { next: '-', days: 9999 }; }
}
function maintenanceLogsInRange() { return cache.mntLogs || []; }
function curUser() { return (WEB_USER && WEB_USER.username) || ''; }
async function postJson(path, body) {
  var r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
function fillStationSelect(id) {
  var el = document.getElementById(id); if (!el) return;
  el.innerHTML = Object.keys(STATIONS).map(function (k) { return '<option value="' + k + '">' + STATIONS[k] + '</option>'; }).join('');
}
['fwStation', 'fdStation', 'fmStation', 'plStation'].forEach(fillStationSelect);
function fillPlanSelect() {
  var el = document.getElementById('fmPlan'); if (!el) return;
  var plans = cache.mntPlans || [];
  el.innerHTML = '<option value="">بدون ارجاع به برنامه PM</option>' + plans.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.title) + '</option>'; }).join('');
}
function cellHtml(c, r) {
  var v = r[c.key];
  if (c.num) return '<td>' + groupFa(v) + '</td>';
  if (c.date) return '<td>' + fmtDate(v) + '</td>';
  if (c.station) return '<td>' + stationFa(v) + '</td>';
  if (c.wt) return '<td>' + wtypeFa(v) + '</td>';
  if (c.chip) return '<td>' + (Number(v) ? '<span class="chip ok">مطابق</span>' : '<span class="chip no">مغایر</span>') + '</td>';
  if (c.src) return '<td>' + (v === 'sensor' ? 'سنسور' : 'دستی') + '</td>';
  return '<td>' + esc(v == null ? '' : v) + '</td>';
}
function renderListTab(tab, rows) {
  var table = document.getElementById('tbl-' + tab); if (!table) return;
  var cols = COLS[tab] || [];
  var html = '<thead><tr>' + cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
  if (!rows || !rows.length) html += '<tr><td colspan="' + cols.length + '" class="empty">رکوردی ثبت نشده است.</td></tr>';
  else rows.slice().reverse().forEach(function (r) { html += '<tr>' + cols.map(function (c) { return cellHtml(c, r); }).join('') + '</tr>'; });
  table.innerHTML = html + '</tbody>';
}
async function loadProduction() { renderListTab('production', await getJson('/api/production')); }
async function loadWaste() { renderListTab('waste', await getJson('/api/waste')); }
async function loadDowntime() { renderListTab('downtime', await getJson('/api/downtime')); }
async function loadQuality() { renderListTab('quality', await getJson('/api/quality')); }
async function loadMaintenance() {
  var j = await getJson('/api/maintenance-extra');
  cache.mntLogs = j.logs || []; cache.mntPlans = j.plans || [];
  fillPlanSelect();
  var t = document.getElementById('tbl-mntlogs');
  if (t) {
    var html = '<thead><tr><th>تاریخ</th><th>ایستگاه</th><th>نوع</th><th>اولویت</th><th>مدت</th><th>تکنسین</th></tr></thead><tbody>';
    if (!cache.mntLogs.length) html += '<tr><td colspan="6" class="empty">رکوردی ثبت نشده</td></tr>';
    cache.mntLogs.slice().reverse().forEach(function (r) { html += '<tr><td>' + esc(r.work_date || '-') + '</td><td>' + stationFa(r.machine_id) + '</td><td>' + (WORKTYPE_FA[r.work_type] || r.work_type || '-') + '</td><td>' + (PRIORITY_FA[r.priority] || r.priority || '-') + '</td><td>' + groupFa(r.duration_minutes) + '</td><td>' + esc(r.technician || '-') + '</td></tr>'; });
    t.innerHTML = html + '</tbody>';
  }
  var tp = document.getElementById('tbl-pmplans');
  if (tp) {
    var h2 = '<thead><tr><th>ایستگاه</th><th>عنوان</th><th>دوره</th><th>آخرین انجام</th><th>سررسید</th><th>وضعیت</th></tr></thead><tbody>';
    if (!cache.mntPlans.length) h2 += '<tr><td colspan="6" class="empty">برنامه‌ای تعریف نشده</td></tr>';
    cache.mntPlans.forEach(function (p) { var st = pmStatus(p); h2 += '<tr><td>' + stationFa(p.machine_id) + '</td><td>' + esc(p.title) + '</td><td>' + groupFa(p.interval_days) + '</td><td>' + esc(p.last_done || '-') + '</td><td>' + esc(st.next) + '</td><td>' + (st.days < 0 ? '<span class="chip no">عقب‌افتاده</span>' : st.days <= 7 ? '<span class="chip wait">نزدیک سررسید</span>' : '<span class="chip ok">طبق برنامه</span>') + '</td></tr>'; });
    tp.innerHTML = h2 + '</tbody>';
  }
}
function toggleForm(id) { var el = document.getElementById(id); if (el) el.classList.toggle('hidden'); }
document.getElementById('btnAddProduction')?.addEventListener('click', function () { toggleForm('formProduction'); var b = document.getElementById('fpBy'); if (b) b.textContent = 'ثبت‌کننده: ' + (curUser() || '-'); });
document.getElementById('btnAddWaste')?.addEventListener('click', function () { toggleForm('formWaste'); });
document.getElementById('btnAddDowntime')?.addEventListener('click', function () { toggleForm('formDowntime'); });
document.getElementById('btnAddQuality')?.addEventListener('click', function () { toggleForm('formQuality'); var b = document.getElementById('fqBy'); if (b) b.textContent = 'ثبت‌کننده: ' + (curUser() || '-'); });
document.getElementById('btnAddMaintenance')?.addEventListener('click', function () { toggleForm('formMaintenance'); fillPlanSelect(); });
document.getElementById('btnAddPlan')?.addEventListener('click', function () { toggleForm('formPlan'); });
['fpCancel', 'fwCancel', 'fdCancel', 'fqCancel', 'fmCancel', 'plCancel'].forEach(function (id) {
  var map = { fpCancel: 'formProduction', fwCancel: 'formWaste', fdCancel: 'formDowntime', fqCancel: 'formQuality', fmCancel: 'formMaintenance', plCancel: 'formPlan' };
  document.getElementById(id)?.addEventListener('click', function () { var f = document.getElementById(map[id]); if (f) f.classList.add('hidden'); });
});
document.getElementById('fpSave')?.addEventListener('click', async function () {
  try {
    await postJson('/api/entry/production', { operator_id: curUser(), product_id: document.getElementById('fpProduct').value, shift_id: document.getElementById('fpShift').value, good_quantity: Number(document.getElementById('fpQty').value) || 0, pallet_count: Number(document.getElementById('fpPallets').value) || 0, machine_id: 'st-pack', description: document.getElementById('fpDesc').value });
    invMsg('fpMsg', 'ثبت با موفقیت انجام شد ✓', true); toggleForm('formProduction'); await loadProduction();
  } catch (e) { invMsg('fpMsg', 'خطا: ' + e.message, false); }
});
document.getElementById('fwSave')?.addEventListener('click', async function () {
  try {
    await postJson('/api/entry/waste', { operator_id: curUser(), shift_id: document.getElementById('fwShift').value, machine_id: document.getElementById('fwStation').value, reason_id: document.getElementById('fwReason').value, waste_type: document.getElementById('fwType').value, quantity: Number(document.getElementById('fwQty').value) || 0, description: document.getElementById('fwDesc').value });
    invMsg('fwMsg', 'ثبت با موفقیت انجام شد ✓', true); toggleForm('formWaste'); await loadWaste();
  } catch (e) { invMsg('fwMsg', 'خطا: ' + e.message, false); }
});
document.getElementById('fdSave')?.addEventListener('click', async function () {
  try {
    var st = parseJalaliDateTime(readJalaliValue(document.getElementById('formDowntime'), 'fds'), document.getElementById('fdStartTime').value);
    var en = parseJalaliDateTime(readJalaliValue(document.getElementById('formDowntime'), 'fde'), document.getElementById('fdEndTime').value);
    if (!st || !en) { invMsg('fdMsg', 'تاریخ شمسی معتبر وارد کنید.', false); return; }
    await postJson('/api/entry/downtime', { shift_id: document.getElementById('fdShift').value, machine_id: document.getElementById('fdStation').value, reason_id: document.getElementById('fdReason').value, is_unplanned: Number(document.getElementById('fdType').value), start_time: st.toISOString(), end_time: en.toISOString(), description: document.getElementById('fdDesc').value });
    invMsg('fdMsg', 'ثبت با موفقیت انجام شد ✓', true); toggleForm('formDowntime'); await loadDowntime();
  } catch (e) { invMsg('fdMsg', 'خطا: ' + e.message, false); }
});
document.getElementById('fqSave')?.addEventListener('click', async function () {
  try {
    await postJson('/api/entry/quality', { operator_id: curUser(), heat_number: document.getElementById('fqHeat').value, rebar_size: Number(document.getElementById('fqSize').value) || 0, yield_strength: Number(document.getElementById('fqPressure').value) || 0, tensile_strength: Number(document.getElementById('fqLining').value) || 0, elongation_percent: Number(document.getElementById('fqDrop').value) || 0, bend_test_passed: Number(document.getElementById('fqLeak').value), visual_inspection: Number(document.getElementById('fqVisual').value), description: document.getElementById('fqDesc').value });
    invMsg('fqMsg', 'ثبت با موفقیت انجام شد ✓', true); toggleForm('formQuality'); await loadQuality();
  } catch (e) { invMsg('fqMsg', 'خطا: ' + e.message, false); }
});
document.getElementById('fmSave')?.addEventListener('click', async function () {
  try {
    await postJson('/api/entry/maintenance', { machine_id: document.getElementById('fmStation').value, work_type: document.getElementById('fmType').value, priority: document.getElementById('fmPriority').value, work_date: readJalaliValue(document.getElementById('formMaintenance'), 'fmd'), duration_minutes: Number(document.getElementById('fmDuration').value) || 0, technician: document.getElementById('fmTech').value, cost: Number(document.getElementById('fmCost').value) || 0, parts: document.getElementById('fmParts').value, root_cause: document.getElementById('fmRootCause').value, action_taken: document.getElementById('fmAction').value, description: document.getElementById('fmDesc').value, plan_id: document.getElementById('fmPlan').value });
    invMsg('fmMsg', 'ثبت با موفقیت انجام شد ✓', true); toggleForm('formMaintenance'); await loadMaintenance();
  } catch (e) { invMsg('fmMsg', 'خطا: ' + e.message, false); }
});
document.getElementById('plSave')?.addEventListener('click', async function () {
  try {
    await postJson('/api/pm/plan', { machine_id: document.getElementById('plStation').value, title: document.getElementById('plTitle').value, interval_days: Number(document.getElementById('plInterval').value) || 0, last_done: readJalaliValue(document.getElementById('formPlan'), 'pllast'), responsible: document.getElementById('plResp').value, priority: document.getElementById('plPriority').value, notes: document.getElementById('plNotes').value });
    invMsg('plMsg', 'برنامه PM ثبت شد ✓', true); toggleForm('formPlan'); await loadMaintenance();
  } catch (e) { invMsg('plMsg', 'خطا: ' + e.message, false); }
});
// ===== END APPEND-FIX v1 =====
`;
h = h.slice(0, idx) + block + h.slice(idx);
fs.writeFileSync(p, h, 'utf8');
console.log('OK: append-fix applied');