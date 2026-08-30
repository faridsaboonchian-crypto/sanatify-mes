const fs = require('fs');
const vm = require('vm');
const path = require('path');
const SP = 'server.js', LP = 'live.json', HP = path.join('public', 'index.html');
fs.copyFileSync(SP, SP + '.bak_consume');
fs.copyFileSync(LP, LP + '.bak_consume');
fs.copyFileSync(HP, HP + '.bak_consume');
let s = fs.readFileSync(SP, 'utf8');
let l = fs.readFileSync(LP, 'utf8');
let h = fs.readFileSync(HP, 'utf8');
const log = [];

// ---------- 1) سرور: جایگزینی هندلر مصرف (مصرف جزئی صحیح) ----------
const startM = "if (req.method === 'POST' && pathname === '/api/inventory/reserve/consume') {";
const endM = "// ===== END FIX-RES-1 =====";
const i0 = s.indexOf(startM); const i1 = s.indexOf(endM);
if (i0 === -1 || i1 === -1) { log.push('SRV ANCHOR MISSING'); }
else {
    const NEW = `if (req.method === 'POST' && pathname === '/api/inventory/reserve/consume') {
if (!auth.requireRole(req, ['warehouse'])) { return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403); }
readBody(req).then(body => {
try {
const b = JSON.parse(body || '{}');
const live = invEnsure(readLive());
const rec = live.inventory_reservations.find(x => x.id === String(b.reservation_id || '') || x.reservation_no === String(b.reservation_id || ''));
if (!rec) return sendJson(res, { error: 'رزرو یافت نشد.' }, 404);
if (rec.status !== 'open') return sendJson(res, { error: 'این رزرو قبلاً بسته شده است.' }, 409);
const qty = Number(b.quantity) > 0 ? Number(b.quantity) : Number(rec.quantity);
if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, { error: 'مقدار مصرف باید بیشتر از صفر باشد.' }, 400);
if (qty > Number(rec.quantity) + 1e-9) return sendJson(res, { error: 'مقدار مصرف نمی‌تواند بیشتر از ماندهٔ رزرو باشد. (مانده رزرو: ' + rec.quantity + ')', max: rec.quantity }, 409);
const dup = invDuplicate(live, b.request_id);
if (dup) return sendJson(res, { ok: true, duplicate: true, record: dup });
const agg = invAggWarehouse(live, rec.item_id, rec.warehouse);
const availRows = agg.rows.filter(x => x.stock_status === 'available' && Number(x.quantity) > 0).sort((a, b) => Number(b.quantity) - Number(a.quantity));
let remain = round2(qty); const sources = [];
for (const row of availRows) { if (remain <= 1e-9) break; const take = round2(Math.min(Number(row.quantity), remain)); if (take <= 1e-9) continue; sources.push({ location: row.location, lot_no: row.lot_no, qty: take }); remain = round2(remain - take); }
if (remain > 1e-9) return sendJson(res, { error: 'موجودی فیزیکی کافی نیست.', physical: agg.physical }, 409);
const baseNo = 'GIN-' + Date.now();
let mainIssue = null;
sources.forEach((src, idx) => {
const iss = { id: 'gin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: String(b.request_id || '') + (idx > 0 ? '-' + (idx + 1) : ''), issue_no: baseNo + (idx > 0 ? '-' + (idx + 1) : ''), item_id: rec.item_id, quantity: src.qty, unit: (invFindItem(live, rec.item_id) || {}).unit || '', lot_no: src.lot_no, warehouse: rec.warehouse, location: src.location, destination: String(b.destination || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };
live.inventory_issues.push(iss);
if (!mainIssue) mainIssue = iss;
});
live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
live.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف رزرو'), timestamp: new Date().toISOString() });
rec.quantity = round2(Number(rec.quantity) - qty);
if (rec.quantity <= 1e-9) { rec.status = 'consumed'; rec.closed_at = new Date().toISOString(); } else { rec.status = 'open'; rec.closed_at = null; }
invSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });
return sendJson(res, { ok: true, record: rec, issue: mainIssue }, 201);
} catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
}).catch(e => sendJson(res, { error: e.message }, 500));
return;
}
`;
    s = s.slice(0, i0) + NEW + s.slice(i1);
    log.push('SRV consume handler replaced');
}

// ---------- 2) داده: بازکردن رزروهای قبلی با ماندهٔ صحیح ----------
const live = JSON.parse(l);
const fixMap = { 'RES-1786539974839': 200, 'RES-1786540848121': 300, 'RES-1786541076827': 80 };
let fixed = 0;
(live.inventory_reservations || []).forEach(r => { if (fixMap[r.reservation_no]) { r.status = 'open'; r.quantity = fixMap[r.reservation_no]; r.closed_at = null; fixed++; } });
log.push('LIVE reservations fixed: ' + fixed);
l = JSON.stringify(live, null, 2);

// ---------- 3) UI: دکمهٔ مصرف با مقدار دلخواه ----------
if (!h.includes('data-consume')) {
    const oldBtn = `<td><button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button></td>`;
    const newBtn = `<td style="white-space:nowrap"><button type="button" class="act" data-consume="' + esc(r.id) + '" data-max="' + esc(r.quantity) + '" style="background:#15803d;padding:4px 10px;font-size:11px;margin-left:4px">مصرف</button><button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button></td>`;
    if (h.includes(oldBtn)) { h = h.split(oldBtn).join(newBtn); log.push('UI button added'); } else log.push('UI button anchor missing');
    const endUI = '// ===== END RESERVE UI =====';
    const HANDLER = `document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {
var cbtn = e.target.closest('button[data-consume]');
if (!cbtn) return;
var id = cbtn.getAttribute('data-consume');
var maxQty = Number(cbtn.getAttribute('data-max')) || 0;
var q = prompt('مقدار مصرف از رزرو (حداکثر ' + maxQty + '):', String(maxQty));
if (q === null) return;
var qty = Number(q);
if (!Number.isFinite(qty) || qty <= 0) { alert('مقدار معتبر نیست.'); return; }
if (qty > maxQty) { alert('مقدار مصرف نمی‌تواند بیشتر از ماندهٔ رزرو باشد (' + maxQty + ').'); return; }
var ref = prompt('ارجاع تولید / دستور کار (اختیاری):', '');
if (ref === null) ref = '';
cbtn.disabled = true;
fetch('/api/inventory/reserve/consume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: ref, request_id: invNewRequestId('web-consume') }) })
.then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
.then(function (res) { if (!res.ok) { alert('خطا: ' + ((res.j && res.j.error) || 'مصرف انجام نشد.')); return; } loadInventory(); })
.catch(function (err) { alert('خطا در ارتباط با سرور: ' + err.message); })
.finally(function () { cbtn.disabled = false; });
});
`;
    if (h.includes(endUI)) { h = h.split(endUI).join(HANDLER + endUI); log.push('UI handler added'); } else log.push('UI handler anchor missing');
} else log.push('UI consume already present');

// ---------- اعتبارسنجی و ذخیره ----------
let okS = true, okH = true;
try { new vm.Script(s); } catch (e) { okS = false; log.push('SRV SYNTAX: ' + e.message); }
const a = h.lastIndexOf('<script>'); const b2 = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(a + 8, b2)); } catch (e) { okH = false; log.push('HTML SYNTAX: ' + e.message); }
if (okS) fs.writeFileSync(SP, s, 'utf8'); else log.push('SRV NOT written');
fs.writeFileSync(LP, l, 'utf8');
if (okH) fs.writeFileSync(HP, h, 'utf8'); else log.push('HTML NOT written');
console.log(log.join('\n'));
console.log(okS && okH ? 'ALL PATCHED + SAVED' : 'CHECK ERRORS ABOVE');