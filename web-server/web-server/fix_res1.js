const fs = require('fs');
const vm = require('vm');
const p = 'server.js';
let s = fs.readFileSync(p, 'utf8');
if (s.indexOf('FIX-RES-1') !== -1) { console.log('FIX-RES-1 already applied'); process.exit(0); }
let changed = false;
if (s.indexOf('reservations: live.inventory_reservations') === -1 && s.indexOf('transactions,') !== -1) {
  s = s.replace('transactions,', 'transactions,\nreservations: live.inventory_reservations || [],');
  changed = true;
  console.log('A) reservations added to GET /api/inventory');
}
const anchorB = '// ===== GET /api/* =====';
const blockB = `// ================================================================
// FIX-RES-1 — RESERVATION ENGINE (Phase 2 / Step 2.1)
// رزرو موجودی: ایجاد / آزادسازی / مصرف (بدون تغییر توابع موجود)
// ================================================================
if (req.method === 'POST' && pathname === '/api/inventory/reserve') {
if (!auth.requireRole(req, ['warehouse'])) { return sendJson(res, { error: 'دسترسی غیرمجاز: مدیریت رزرو فقط برای انباردار یا مدیر سیستم است.' }, 403); }
readBody(req).then(body => {
try {
const b = JSON.parse(body || '{}');
const live = invEnsure(readLive());
const item = invFindItem(live, String(b.item_id || ''));
const qty = Number(b.quantity);
const warehouse = String(b.warehouse || '').trim();
if (!item) return sendJson(res, { error: 'کالای انتخاب‌شده یافت نشد.' }, 400);
if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, { error: 'مقدار رزرو باید بیشتر از صفر باشد.' }, 400);
if (!warehouse) return sendJson(res, { error: 'انبار رزرو الزامی است.' }, 400);
const agg = invAggWarehouse(live, item.id, warehouse);
if (agg.available < qty - 1e-9) return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست. (قابل مصرف: ' + agg.available + ' | درخواست: ' + qty + ')', available: agg.available }, 409);
const rec = { id: 'res-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: String(b.request_id || ''), reservation_no: 'RES-' + Date.now(), item_id: item.id, warehouse: warehouse, quantity: qty, status: 'open', reason: String(b.reason || '').trim(), work_order: String(b.work_order || '').trim(), created_by: String((req.user && req.user.username) || ''), created_at: new Date().toISOString(), closed_at: null };
live.inventory_reservations.push(rec);
invSave(live, req, 'inventory.reserve.insert', rec);
return sendJson(res, { ok: true, record: rec }, 201);
} catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
}).catch(e => sendJson(res, { error: e.message }, 500));
return;
}
if (req.method === 'POST' && pathname === '/api/inventory/reserve/release') {
if (!auth.requireRole(req, ['warehouse'])) { return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403); }
readBody(req).then(body => {
try {
const b = JSON.parse(body || '{}');
const live = invEnsure(readLive());
const rec = live.inventory_reservations.find(x => x.id === String(b.reservation_id || '') || x.reservation_no === String(b.reservation_id || ''));
if (!rec) return sendJson(res, { error: 'رزرو یافت نشد.' }, 404);
if (rec.status !== 'open') return sendJson(res, { error: 'این رزرو قبلاً بسته شده است.' }, 409);
rec.status = 'released'; rec.closed_at = new Date().toISOString();
invSave(live, req, 'inventory.reserve.release', rec);
return sendJson(res, { ok: true, record: rec });
} catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
}).catch(e => sendJson(res, { error: e.message }, 500));
return;
}
if (req.method === 'POST' && pathname === '/api/inventory/reserve/consume') {
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
}
// ===== END FIX-RES-1 =====`;
if (s.indexOf(anchorB) !== -1) {
  s = s.replace(anchorB, blockB + '\n' + anchorB);
  changed = true;
  console.log('B) reservation endpoints inserted');
}
if (!changed) { console.log('ERROR: anchors not found - nothing changed'); process.exit(1); }
fs.writeFileSync(p, s, 'utf8');
try { new vm.Script(s); console.log('server syntax OK'); } catch (e) { console.log('SYNTAX ERROR: ' + e.message); process.exit(1); }
console.log('FIX-RES-1 applied');