const fs = require('fs');
const vm = require('vm');

// 1. Backup (خط قرمز ۱۶)
fs.copyFileSync('server.js', 'server.js.bak_phase31');
fs.copyFileSync('public/index.html', 'public/index.html.bak_phase31');
console.log('✅ Backups created (.bak_phase31)');

let s = fs.readFileSync('server.js', 'utf8');
let h = fs.readFileSync('public/index.html', 'utf8');

// 2. Patch server.js (Endpoint Consume)
const oldConsume = `if (req.method === 'POST' && pathname === '/api/inventory/reserve/consume') {
if (!auth.requireRole(req, ['warehouse'])) { return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403); }
readBody(req).then(body => {
try {
const b = JSON.parse(body || '{}');
const live = invEnsure(readLive());
const rec = live.inventory_reservations.find(x => x.id === String(b.reservation_id || '') || x.reservation_no === String(b.reservation_id || ''));
if (!rec) return sendJson(res, { error: 'رزرو یافت نشد.' }, 404);
if (rec.status !== 'open') return sendJson(res, { error: 'این رزرو قبلاً بسته شده است.' }, 409);
const qty = Number(b.quantity) > 0 ? Number(b.quantity) : Number(rec.quantity);
rec.status = 'released';
const agg = invAggWarehouse(live, rec.item_id, rec.warehouse);
if (agg.available < qty - 1e-9) { rec.status = 'open'; return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست.', available: agg.available }, 409); }
const sources = invPickSources(live, rec.item_id, rec.warehouse, null, null, qty);
if (!sources) { rec.status = 'open'; return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست.', available: agg.available }, 409); }
const baseNo = 'GIN-' + Date.now();
let mainIssue = null;
sources.forEach((src, idx) => {
const iss = { id: 'gin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: String(b.request_id || '') + (idx > 0 ? '-' + (idx + 1) : ''), issue_no: baseNo + (idx > 0 ? '-' + (idx + 1) : ''), item_id: rec.item_id, quantity: src.qty, unit: (invFindItem(live, rec.item_id) || {}).unit || '', lot_no: src.lot_no, warehouse: rec.warehouse, location: src.location, destination: String(b.destination || rec.reason || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };
live.inventory_issues.push(iss);
if (!mainIssue) mainIssue = iss;
});
rec.status = 'consumed'; rec.closed_at = new Date().toISOString();
invSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });
return sendJson(res, { ok: true, record: rec, issue: mainIssue }, 201);
} catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
}).catch(e => sendJson(res, { error: e.message }, 500));
return;
}`;

const newConsume = `if (req.method === 'POST' && pathname === '/api/inventory/reserve/consume') {
if (!auth.requireRole(req, ['warehouse', 'operator', 'admin'])) { return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403); }
readBody(req).then(body => {
try {
const b = JSON.parse(body || '{}');
const live = invEnsure(readLive());
const dup = invDuplicate(live, b.request_id);
if (dup) return sendJson(res, { ok: true, duplicate: true, record: dup });
const rec = live.inventory_reservations.find(x => x.id === String(b.reservation_id || '') || x.reservation_no === String(b.reservation_id || ''));
if (!rec) return sendJson(res, { error: 'رزرو یافت نشد.' }, 404);
if (rec.status !== 'open') return sendJson(res, { error: 'این رزرو قبلاً بسته یا مصرف شده است.' }, 409);
const reqQty = Number(b.quantity);
if (!Number.isFinite(reqQty) || reqQty <= 0) return sendJson(res, { error: 'مقدار مصرف باید بیشتر از صفر باشد.' }, 400);
if (reqQty > Number(rec.quantity) + 1e-9) return sendJson(res, { error: 'مقدار مصرف نمی‌تواند بیشتر از مقدار رزرو شده باشد.' }, 409);
const agg = invAggWarehouse(live, rec.item_id, rec.warehouse);
if (agg.available < reqQty - 1e-9) { return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست.', available: agg.available }, 409); }
const sources = invPickSources(live, rec.item_id, rec.warehouse, null, null, reqQty);
if (!sources) { return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست.', available: agg.available }, 409); }
const baseNo = 'GIN-' + Date.now();
let mainIssue = null;
sources.forEach((src, idx) => {
const iss = { id: 'gin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: String(b.request_id || '') + (idx > 0 ? '-' + (idx + 1) : ''), issue_no: baseNo + (idx > 0 ? '-' + (idx + 1) : ''), item_id: rec.item_id, quantity: src.qty, unit: (invFindItem(live, rec.item_id) || {}).unit || '', lot_no: src.lot_no, warehouse: rec.warehouse, location: src.location, destination: String(b.destination || 'مصرف تولید').trim(), destination_ref: String(b.production_id || b.work_order || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };
live.inventory_issues.push(iss);
if (!mainIssue) mainIssue = iss;
});
rec.quantity = round2(Number(rec.quantity) - reqQty);
if (rec.quantity <= 1e-9) { rec.status = 'consumed'; rec.closed_at = new Date().toISOString(); }
if (b.production_id) rec.production_id = String(b.production_id);
live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
live.inventory_reservation_logs.push({ id: 'rlog-con-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: reqQty, warehouse: rec.warehouse, lot_no: '', destination: String(b.production_id || 'مصرف تولید'), timestamp: new Date().toISOString() });
invSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });
return sendJson(res, { ok: true, record: rec, issue: mainIssue }, 201);
} catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
}).catch(e => sendJson(res, { error: e.message }, 500));
return;
}`;

if (s.includes(oldConsume)) {
    s = s.replace(oldConsume, newConsume);
    console.log('✅ server.js patched.');
} else { console.log('❌ server.js anchor not found. STOP.'); process.exit(1); }

// 3. Patch public/index.html (UI)
const oldBtn = `<button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button>`;
const newBtn = `<button type="button" class="act" data-consume="' + esc(r.id) + '" data-max="' + esc(r.quantity) + '" style="background:#15803d;padding:4px 10px;font-size:11px;margin-left:4px">مصرف</button><button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button>`;

if (h.includes(oldBtn)) {
    h = h.split(oldBtn).join(newBtn);
    console.log('✅ index.html buttons patched.');
} else { console.log('❌ index.html button anchor not found. STOP.'); process.exit(1); }

const oldListener = `document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {
var btn = e.target.closest('button[data-unreserve]');`;
const newListener = `document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {
var btnCons = e.target.closest('button[data-consume]');
if (btnCons) {
  var id = btnCons.getAttribute('data-consume');
  var maxQty = Number(btnCons.getAttribute('data-max')) || 0;
  var qtyStr = prompt('مقدار مصرف از رزرو (حداکثر ' + maxQty + '):', String(maxQty));
  if (qtyStr === null) return;
  var qty = Number(qtyStr);
  if (!Number.isFinite(qty) || qty <= 0) { alert('مقدار معتبر نیست.'); return; }
  if (qty > maxQty) { alert('مقدار مصرف نمی‌تواند بیشتر از مقدار رزرو باشد.'); return; }
  var prodRef = prompt('ارجاع تولید / شماره دستور کار (اختیاری):', '');
  if (prodRef === null) prodRef = '';
  btnCons.disabled = true;
  fetch('/api/inventory/reserve/consume', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: prodRef, production_id: prodRef, request_id: invNewRequestId('web-consume') }) 
  })
  .then(function (r) { return r.json(); })
  .then(function (j) { if (!j.ok && !j.duplicate) throw new Error(j.error || 'خطا'); loadInventory(); })
  .catch(function (err) { alert('خطا در مصرف رزرو: ' + err.message); })
  .finally(function () { btnCons.disabled = false; });
  return;
}
var btn = e.target.closest('button[data-unreserve]');`;

if (h.includes(oldListener)) {
    h = h.replace(oldListener, newListener);
    console.log('✅ index.html listener patched.');
} else { console.log('❌ index.html listener anchor not found. STOP.'); process.exit(1); }

// 4. Syntax Validation
try { new vm.Script(s); console.log('✅ server.js syntax OK.'); } catch (e) { console.log('❌ server.js syntax error:', e.message); process.exit(1); }
try {
    const i1 = h.lastIndexOf('<script>'); const i2 = h.lastIndexOf('</' + 'script>');
    new vm.Script(h.slice(i1 + 8, i2));
    console.log('✅ index.html syntax OK.');
} catch (e) { console.log('❌ index.html syntax error:', e.message); process.exit(1); }

fs.writeFileSync('server.js', s, 'utf8');
fs.writeFileSync('public/index.html', h, 'utf8');
console.log('🎉 Phase 3.1 Implementation Complete.');