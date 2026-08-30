const fs = require('fs');
const vm = require('vm');
const HP = 'public/index.html';
const SP = 'server.js';
fs.copyFileSync(HP, HP + '.bak_consume');
fs.copyFileSync(SP, SP + '.bak_consume');
const log = [];

// ---------- UI: افزودن دکمه مصرف ----------
let h = fs.readFileSync(HP, 'utf8');
const anchorBtn = `<button type="button" class="act" data-unreserve="' + esc(r.id) + '"`;
const consumeBtn = `<button type="button" class="act" data-consume="' + esc(r.id) + '" data-max="' + esc(r.quantity) + '" style="background:#15803d;padding:4px 10px;font-size:11px;margin-left:4px">مصرف</button>`;
if (!h.includes('data-consume=')) {
    if (h.includes(anchorBtn)) { h = h.split(anchorBtn).join(consumeBtn + anchorBtn); log.push('UI button: added'); }
    else log.push('UI button: ANCHOR MISSING');
} else log.push('UI button: already');

const anchorHandler = `document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {`;
const consumeHandler = `document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {
var cbtn = e.target.closest('button[data-consume]');
if (!cbtn) return;
var id = cbtn.getAttribute('data-consume');
var maxQty = Number(cbtn.getAttribute('data-max')) || 0;
var q = prompt('مقدار مصرف از رزرو (حداکثر ' + maxQty + '):', String(maxQty));
if (q === null) return;
var qty = Number(q);
if (!Number.isFinite(qty) || qty <= 0) { alert('مقدار معتبر نیست.'); return; }
if (qty > maxQty) { alert('مقدار مصرف نمی‌تواند بیشتر از مقدار رزرو باشد (' + maxQty + ').'); return; }
var ref = prompt('ارجاع تولید / دستور کار (اختیاری):', '');
if (ref === null) ref = '';
if (!confirm('مصرف ' + qty + ' از رزرو انجام شود؟')) return;
cbtn.disabled = true;
fetch('/api/inventory/reserve/consume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: ref, destination_ref: ref, description: ref, request_id: invNewRequestId('web-consume') }) })
.then(function (r) { return r.json(); })
.then(function (j) { if (!j.ok) throw new Error(j.error || 'خطا'); loadInventory(); })
.catch(function (err) { alert('خطا در مصرف رزرو: ' + err.message); })
.finally(function () { cbtn.disabled = false; });
});
`;
if (!h.includes("e.target.closest('button[data-consume]')")) {
    if (h.includes(anchorHandler)) { h = h.replace(anchorHandler, consumeHandler + '\n' + anchorHandler); log.push('UI handler: added'); }
    else log.push('UI handler: ANCHOR MISSING');
} else log.push('UI handler: already');

// برچسب مصرف در کارتکس/گردش
if (h.includes("if(t==='release') return 'آزادسازی رزرو';") && !h.includes("if(t==='consume')")) {
    h = h.split("if(t==='release') return 'آزادسازی رزرو';").join("if(t==='release') return 'آزادسازی رزرو'; if(t==='consume') return 'مصرف از رزرو';");
    log.push('UI label: added');
}
if (h.includes("INV_TX_FA.release='آزادسازی رزرو';") && !h.includes('INV_TX_FA.consume')) {
    h = h.split("INV_TX_FA.release='آزادسازی رزرو';").join("INV_TX_FA.release='آزادسازی رزرو'; INV_TX_FA.consume='مصرف از رزرو';");
    log.push('UI INV_TX_FA: added');
}

// ---------- SERVER: مصرف جزئی + ایدمپوتنسی + لاگ ----------
let s = fs.readFileSync(SP, 'utf8');
const sOld1 = `const qty = Number(b.quantity) > 0 ? Number(b.quantity) : Number(rec.quantity);
rec.status = 'released';`;
const sNew1 = `const dup = invDuplicate(live, b.request_id);
if (dup) return sendJson(res, { ok: true, duplicate: true, record: dup });
const qty = Number(b.quantity) > 0 ? Number(b.quantity) : Number(rec.quantity);
if (qty > Number(rec.quantity) + 1e-9) return sendJson(res, { error: 'مقدار مصرف نمی‌تواند بیشتر از مقدار رزرو باشد.', max: rec.quantity }, 409);
rec.status = 'released';`;
if (!s.includes('const dup = invDuplicate(live, b.request_id);\nif (dup) return sendJson(res, { ok: true, duplicate: true')) {
    if (s.includes(sOld1)) { s = s.split(sOld1).join(sNew1); log.push('SRV idemp+max: added'); }
    else log.push('SRV idemp+max: ANCHOR MISSING');
} else log.push('SRV idemp+max: already');

const sOld2 = `rec.status = 'consumed'; rec.closed_at = new Date().toISOString();
invSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });`;
const sNew2 = `live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
live.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف تولید'), timestamp: new Date().toISOString() });
rec.quantity = round2(Number(rec.quantity) - qty);
if (rec.quantity <= 1e-9) { rec.status = 'consumed'; rec.closed_at = new Date().toISOString(); } else { rec.status = 'open'; rec.closed_at = null; }
invSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });`;
if (!s.includes("tx_type: 'consume'")) {
    if (s.includes(sOld2)) { s = s.split(sOld2).join(sNew2); log.push('SRV partial+log: added'); }
    else log.push('SRV partial+log: ANCHOR MISSING');
} else log.push('SRV partial+log: already');

// ---------- اعتبارسنجی و ذخیره ----------
let okH = true, okS = true;
try { const i1 = h.lastIndexOf('<script>'); const i2 = h.lastIndexOf('</' + 'script>'); new vm.Script(h.slice(i1 + 8, i2)); } catch (e) { okH = false; log.push('HTML SYNTAX: ' + e.message); }
try { new vm.Script(s); } catch (e) { okS = false; log.push('SRV SYNTAX: ' + e.message); }
if (okH) fs.writeFileSync(HP, h, 'utf8'); else log.push('HTML NOT written');
if (okS) fs.writeFileSync(SP, s, 'utf8'); else log.push('SRV NOT written');
console.log(log.join('\n'));
console.log(okH && okS ? 'ALL PATCHED + SAVED' : 'CHECK ERRORS ABOVE');