const fs = require('fs');
const vm = require('vm');
fs.copyFileSync('server.js', 'server.js.bak_chain');
fs.copyFileSync('public/index.html', 'public/index.html.bak_chain');
let s = fs.readFileSync('server.js', 'utf8');
let h = fs.readFileSync('public/index.html', 'utf8');
const log = [];

// ---------- SERVER: ثبت لاگ رزرو/آزادسازی و اتصال به گردش ----------
if (!s.includes('inventory_reservation_logs')) {
    const a1 = 'closed_at: null };';
    if (s.includes(a1)) { s = s.replace(a1, a1 + "\nlive.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : []; live.inventory_reservation_logs.push({ id: 'rlog-' + rec.id, tx_type: 'reserve', receipt_no: rec.reservation_no, item_id: rec.item_id, quantity: rec.quantity, warehouse: rec.warehouse, lot_no: '', destination: rec.work_order || rec.reason || 'رزرو', timestamp: rec.created_at });"); log.push('S1 OK'); } else log.push('S1 NOT FOUND');
    const a2 = "rec.status = 'released'; rec.closed_at = new Date().toISOString();";
    if (s.includes(a2)) { s = s.replace(a2, a2 + "\nlive.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : []; live.inventory_reservation_logs.push({ id: 'rlog-rel-' + rec.id, tx_type: 'release', issue_no: 'REL-' + Date.now(), item_id: rec.item_id, quantity: rec.quantity, warehouse: rec.warehouse, lot_no: '', destination: 'بازگشت به موجودی', timestamp: rec.closed_at });"); log.push('S2 OK'); } else log.push('S2 NOT FOUND');
    const a3 = 'live.inventory_reservations.splice(idx, 1);';
    if (s.includes(a3)) { s = s.replace(a3, "const __rel = live.inventory_reservations[idx]; if (__rel) { live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : []; live.inventory_reservation_logs.push({ id: 'rlog-unr-' + __rel.id, tx_type: 'release', issue_no: 'REL-' + Date.now(), item_id: __rel.item_id, quantity: __rel.quantity, warehouse: __rel.warehouse, lot_no: '', destination: 'آزادسازی رزرو', timestamp: new Date().toISOString() }); }\n" + a3); log.push('S3 OK'); } else log.push('S3 NOT FOUND');
    const a4 = "].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 200);";
    if (s.includes(a4)) { s = s.replace(a4, "].concat(live.inventory_reservation_logs || []).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 200);"); log.push('S4 OK'); } else log.push('S4 NOT FOUND');
} else log.push('SERVER already patched');

// ---------- FRONTEND: جایگزینی بلوک RESERVE UI با نسخهٔ v2 ----------
const M1 = '// ===== RESERVE UI + STOCK SEARCH (universal patch) =====';
const M2 = '// ===== END RESERVE UI =====';
const i1 = h.indexOf(M1); const i2 = h.indexOf(M2);
if (i1 !== -1 && i2 !== -1) {
    const BLOCK = M1 + "\n" + `function invFillReserveSelects() {
var itemSel = document.getElementById('iresItem');
if (itemSel) {
var items = (inventoryData && inventoryData.items) ? inventoryData.items : [];
itemSel.innerHTML = '<option value="">انتخاب کالا...</option>' + items.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc((x.code || '') + ' — ' + (x.name || '')) + '</option>'; }).join('');
}
var whSel = document.getElementById('iresWarehouse');
if (whSel) { whSel.innerHTML = Object.keys(INV_WAREHOUSES).map(function (k) { return '<option value="' + k + '">' + INV_WAREHOUSES[k] + '</option>'; }).join(''); }
}
function invRenderReservations() {
var table = document.getElementById('tbl-inv-reservations');
if (!table) return;
var ress = ((inventoryData && inventoryData.reservations) || []).filter(function (r) { return r.status === 'open'; });
var html = '<thead><tr><th>کالا</th><th>مقدار</th><th>انبار</th><th>مرجع</th><th>تاریخ</th><th>عملیات</th></tr></thead><tbody>';
if (!ress.length) { html += '<tr><td colspan="6" class="empty">رزرو بازی وجود ندارد.</td></tr>'; }
else ress.forEach(function (r) {
html += '<tr><td>' + esc(invItemName(r.item_id)) + '</td><td>' + invQty(r.quantity) + '</td><td>' + esc(INV_WAREHOUSES[r.warehouse] || r.warehouse || '-') + '</td><td>' + esc(r.work_order || r.reason || r.reference || '-') + '</td><td>' + fmtDate(r.created_at || r.timestamp) + '</td><td><button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button></td></tr>';
});
table.innerHTML = html + '</tbody>';
}
var __origTxLabel = (typeof invTxLabel === 'function') ? invTxLabel : null;
invTxLabel = function (t) { if (t === 'reserve') return 'رزرو موجودی'; if (t === 'release') return 'آزادسازی رزرو'; return __origTxLabel ? __origTxLabel(t) : String(t || '-'); };
var __origInvRender = invRender;
invRender = function () { var r = __origInvRender.apply(this, arguments); try { invRenderReservations(); } catch (e) {} return r; };
var __origRenderStock = invRenderStock;
invRenderStock = function () {
var q = ((document.getElementById('invStockSearch') || {}).value || '').trim().toLowerCase();
if (q && inventoryData && inventoryData.stockview) {
var orig = inventoryData.stockview;
inventoryData.stockview = orig.filter(function (x) { return String(x.name || '').toLowerCase().indexOf(q) !== -1 || String(x.code || '').toLowerCase().indexOf(q) !== -1; });
try { return __origRenderStock(); } finally { inventoryData.stockview = orig; }
}
return __origRenderStock();
};
document.getElementById('iresItem')?.addEventListener('change', function () {
var id = this.value; var ws = document.getElementById('iresWarehouse'); if (!id || !ws) return;
var best = ''; var bestAv = -1;
((inventoryData && inventoryData.stockview) || []).forEach(function (r) { if (String(r.item_id) === String(id)) { var av = Number(r.available) || 0; if (av > bestAv) { bestAv = av; best = r.warehouse; } } });
if (best) ws.value = best;
});
document.getElementById('btnInventoryReserve')?.addEventListener('click', function () {
invFillReserveSelects();
document.getElementById('invReserveForm').classList.toggle('hidden');
});
document.getElementById('invReserveSave')?.addEventListener('click', function () {
invPost('/api/inventory/reserve', {
item_id: document.getElementById('iresItem').value,
quantity: Number(document.getElementById('iresQty').value),
warehouse: document.getElementById('iresWarehouse').value,
reference: document.getElementById('iresRef').value,
description: document.getElementById('iresDesc').value
}, 'invReserveMsg', 'invReserveForm');
});
document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {
var btn = e.target.closest('button[data-unreserve]');
if (!btn) return;
if (!confirm('آیا از آزادسازی این رزرو اطمینان دارید؟')) return;
btn.disabled = true;
fetch('/api/inventory/unreserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.getAttribute('data-unreserve'), request_id: invNewRequestId('web') }) })
.then(function (r) { return r.json(); })
.then(function (j) { if (!j.ok) throw new Error(j.error || 'خطا'); loadInventory(); })
.catch(function (err) { alert('خطا در آزادسازی: ' + err.message); })
.finally(function () { btn.disabled = false; });
});
document.getElementById('invStockSearch')?.addEventListener('input', function () { invRenderStock(); });
` + "\n" + M2;
    h = h.slice(0, i1) + BLOCK + h.slice(i2 + M2.length);
    log.push('UI v2 OK');
} else log.push('UI markers NOT FOUND');

// ---------- اعتبارسنجی و ذخیره ----------
let okS = true, okH = true;
try { new vm.Script(s); } catch (e) { okS = false; log.push('SERVER SYNTAX: ' + e.message); }
const hi = h.lastIndexOf('<script>'); const hj = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(hi + 8, hj)); } catch (e) { okH = false; log.push('HTML SYNTAX: ' + e.message); }
if (okS) fs.writeFileSync('server.js', s, 'utf8'); else log.push('server.js NOT written');
if (okH) fs.writeFileSync('public/index.html', h, 'utf8'); else log.push('index.html NOT written');
console.log(log.join('\n'));
console.log(okS && okH ? 'ALL PATCHED + SAVED' : 'CHECK ERRORS ABOVE');