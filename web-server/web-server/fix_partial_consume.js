const fs = require('fs');
const vm = require('vm');
const SP = 'server.js', HP = 'public/index.html';
let s = fs.readFileSync(SP, 'utf8');
let h = fs.readFileSync(HP, 'utf8');
const log = [];
if (!fs.existsSync(SP + '.bak_pc')) fs.writeFileSync(SP + '.bak_pc', s);
if (!fs.existsSync(HP + '.bak_pc')) fs.writeFileSync(HP + '.bak_pc', h);

// --- سرور: ایدمپوتنسی + جلوگیری از مصرف بیش از رزرو باز
const A1 = "const qty = Number(b.quantity) > 0 ? Number(b.quantity) : Number(rec.quantity);\nrec.status = 'released';";
const A2 = "const dup = invDuplicate(live, b.request_id);\nif (dup) return sendJson(res, { ok: true, duplicate: true, record: dup });\nconst qty = Number(b.quantity) > 0 ? Number(b.quantity) : Number(rec.quantity);\nif (qty > Number(rec.quantity) + 1e-9) return sendJson(res, { error: 'مقدار مصرف نمی‌تواند بیشتر از رزرو باز باشد. (رزرو باز: ' + rec.quantity + ')', max: rec.quantity }, 409);\nrec.status = 'released';";
if (s.includes(A1)) { s = s.split(A1).join(A2); log.push('SRV guard: added'); }
else if (s.includes('if (dup) return sendJson(res, { ok: true, duplicate: true')) log.push('SRV guard: already');
else log.push('SRV guard: ANCHOR MISSING');

// --- سرور: مصرف جزئی + ثبت تراکنش مصرف + نگهداری باقی‌ماندهٔ رزرو
const B1 = "rec.status = 'consumed'; rec.closed_at = new Date().toISOString();\ninvSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });";
const B2 = "live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];\nlive.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف تولید'), timestamp: new Date().toISOString() });\nrec.quantity = round2(Number(rec.quantity) - qty);\nif (rec.quantity <= 1e-9) { rec.status = 'consumed'; rec.closed_at = new Date().toISOString(); } else { rec.status = 'open'; rec.closed_at = null; }\ninvSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });";
if (s.includes(B1)) { s = s.split(B1).join(B2); log.push('SRV partial: added'); }
else if (s.includes('rec.quantity = round2(Number(rec.quantity) - qty)')) log.push('SRV partial: already');
else log.push('SRV partial: ANCHOR MISSING');

// --- UI: برچسب «مصرف رزرو» در گردش/کارتکس
const L1 = "if(t==='release') return 'آزادسازی رزرو';";
const L2 = "if(t==='release') return 'آزادسازی رزرو'; if(t==='consume') return 'مصرف رزرو';";
if (h.includes(L1) && !h.includes("t==='consume'")) { h = h.split(L1).join(L2); log.push('UI label: added'); } else log.push('UI label: already');
const L3 = "INV_TX_FA.release='آزادسازی رزرو';";
const L4 = "INV_TX_FA.release='آزادسازی رزرو'; INV_TX_FA.consume='مصرف رزرو';";
if (h.includes(L3) && !h.includes('INV_TX_FA.consume')) { h = h.split(L3).join(L4); log.push('UI INV_TX_FA: added'); } else log.push('UI INV_TX_FA: already');

// --- UI: دکمهٔ «مصرف» + هندلر (اگر نیست)
if (!h.includes('data-consume')) {
    const R1 = `<td><button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button></td>`;
    const R2 = `<td><button type="button" class="act" data-consume="' + esc(r.id) + '" data-max="' + esc(r.quantity) + '" style="background:#15803d;padding:4px 10px;font-size:11px;margin-left:4px">مصرف</button><button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button></td>`;
    if (h.includes(R1)) { h = h.split(R1).join(R2); log.push('UI consume btn: added'); } else log.push('UI consume btn: ANCHOR MISSING');
    const H1 = '// ===== END RESERVE UI =====';
    const H2 = `// ===== CONSUME UI =====
document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {
var btn = e.target.closest('button[data-consume]');
if (!btn) return;
var id = btn.getAttribute('data-consume');
var maxQty = Number(btn.getAttribute('data-max')) || 0;
var q = prompt('مقدار مصرف از رزرو (حداکثر ' + maxQty + '):', String(maxQty));
if (q === null) return;
var qty = Number(q);
if (!Number.isFinite(qty) || qty <= 0) { alert('مقدار معتبر نیست.'); return; }
if (qty > maxQty) { alert('مقدار مصرف نمی‌تواند بیشتر از رزرو باز باشد (' + maxQty + ').'); return; }
var ref = prompt('ارجاع تولید / دستور کار (اختیاری):', '');
if (ref === null) ref = '';
btn.disabled = true;
fetch('/api/inventory/reserve/consume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: ref, request_id: invNewRequestId('web-consume') }) })
.then(function (r) { return r.json(); })
.then(function (j) { if (!j.ok) throw new Error(j.error || 'خطا'); loadInventory(); })
.catch(function (err) { alert('خطا در مصرف رزرو: ' + err.message); })
.finally(function () { btn.disabled = false; });
});
// ===== END CONSUME UI =====
// ===== END RESERVE UI =====`;
    if (h.includes(H1)) { h = h.split(H1).join(H2); log.push('UI consume handler: added'); } else log.push('UI consume handler: ANCHOR MISSING');
} else log.push('UI consume: already');

// --- اعتبارسنجی و ذخیره
let okS = true, okH = true;
try { new vm.Script(s); } catch (e) { okS = false; log.push('SRV SYNTAX: ' + e.message); }
const i1 = h.lastIndexOf('<script>'); const i2 = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(i1 + 8, i2)); } catch (e) { okH = false; log.push('HTML SYNTAX: ' + e.message); }
if (okS) fs.writeFileSync(SP, s, 'utf8'); else log.push('SRV NOT written');
if (okH) fs.writeFileSync(HP, h, 'utf8'); else log.push('HTML NOT written');
console.log(log.join('\n'));
console.log(okS && okH ? 'ALL PATCHED + SAVED' : 'CHECK ERRORS ABOVE');