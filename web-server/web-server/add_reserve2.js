const fs = require('fs');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');
if (c.includes('id="btnInventoryReserve"')) { console.log('ALREADY INSTALLED - nothing to do'); process.exit(0); }

const RESERVE_FORM = `
<div class="filters hidden" id="invReserveForm">
<div class="frow">
<select id="iresItem" class="fsel"></select>
<input id="iresQty" type="number" min="0.001" placeholder="مقدار رزرو" style="width:110px" />
<select id="iresWarehouse" class="fsel"></select>
<input id="iresRef" placeholder="مرجع (شماره سفارش / دستور کار)" style="flex:1 1 200px" />
<input id="iresDesc" placeholder="شرح" style="flex:1 1 220px" />
</div>
<div class="frow" style="margin-top:8px">
<button class="act" id="invReserveSave" data-save style="background:#15803d">ثبت رزرو</button>
<button class="act fclear" onclick="document.getElementById('invReserveForm').classList.add('hidden')">انصراف</button>
</div>
<div class="note" id="invReserveMsg"></div>
</div>`;

const JSBLOCK = `
// ===== RESERVE UI + STOCK SEARCH (universal patch) =====
function invFillReserveSelects() {
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
var html = '<thead><tr><th>کالا</th><th>مقدار</th><th>انبار</th><th>مرجع / دستور کار</th><th>تاریخ</th><th>عملیات</th></tr></thead><tbody>';
if (!ress.length) { html += '<tr><td colspan="6" class="empty">رزرو بازی وجود ندارد.</td></tr>'; }
else ress.forEach(function (r) {
html += '<tr><td>' + esc(invItemName(r.item_id)) + '</td><td>' + invQty(r.quantity) + '</td><td>' + esc(INV_WAREHOUSES[r.warehouse] || r.warehouse || '-') + '</td><td>' + esc(r.work_order || r.reason || r.reference || '-') + '</td><td>' + fmtDate(r.created_at || r.timestamp) + '</td><td><button type="button" class="act" data-unreserve="' + esc(r.id) + '" style="background:#b91c1c;padding:4px 10px;font-size:11px">آزادسازی</button></td></tr>';
});
table.innerHTML = html + '</tbody>';
}
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
document.getElementById('btnInventoryReserve')?.addEventListener('click', function () {
invFillReserveSelects();
document.getElementById('invReserveForm').classList.toggle('hidden');
});
document.getElementById('invReserveSave')?.addEventListener('click', function () {
invPost('/api/inventory/reserve', {
item_id: document.getElementById('iresItem').value,
quantity: Number(document.getElementById('iresQty').value),
warehouse: document.getElementById('iresWarehouse').value,
work_order: (document.getElementById('iresRef').value || '').trim(),
reason: (document.getElementById('iresDesc').value || '').trim()
}, 'invReserveMsg', 'invReserveForm');
});
document.getElementById('tbl-inv-reservations')?.addEventListener('click', function (e) {
var btn = e.target.closest('button[data-unreserve]');
if (!btn) return;
if (!confirm('آیا از آزادسازی این رزرو اطمینان دارید؟')) return;
btn.disabled = true;
fetch('/api/inventory/unreserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.getAttribute('data-unreserve'), request_id: invNewRequestId('web') }) })
.then(function (r) { return r.json(); })
.then(function (j) { if (!j.ok) throw new Error(j.error || 'خطا'); if (typeof loadInventory === 'function') loadInventory(); })
.catch(function (err) { alert('خطا در آزادسازی: ' + err.message); })
.finally(function () { btn.disabled = false; });
});
document.getElementById('invStockSearch')?.addEventListener('input', function () { invRenderStock(); });
(function () {
fetch('/api/auth/me', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
var role = (j && j.ok && j.user) ? String(j.user.role || 'viewer') : 'viewer';
var el = document.getElementById('btnInventoryReserve');
if (el) el.style.display = (role === 'admin' || role === 'warehouse') ? '' : 'none';
}).catch(function () {});
})();
// ===== END RESERVE UI =====`;

function ins(anchor, add, pos) {
    if (!c.includes(anchor)) return false;
    c = (pos === 'before') ? c.replace(anchor, add + '\n' + anchor) : c.replace(anchor, anchor + add);
    return true;
}
const r1 = ins('<button class="act excel" id="expInventoryStock">', '<button class="act" id="btnInventoryReserve" style="display:none">📌 رزرو کالا</button>', 'before');
const r2 = ins('<div class="kpis" id="invKpis"></div>', RESERVE_FORM, 'before');
const r3 = ins('<table id="tbl-inv-tx"></table>', '\n</div>\n<h3 class="inv-subtitle">رزروهای باز (اختصاص یافته)</h3>\n<div class="tablewrap">\n<table id="tbl-inv-reservations"></table>', 'after');
const r4 = ins('<select id="invWhFilter" class="fsel">', '<input id="invStockSearch" class="fsel" placeholder="جستجوی نام / کد کالا..." style="min-width:180px" />', 'before');
const r5 = ins('const AUTO_REFRESH_MS = 15000;', JSBLOCK, 'before');
console.log('button:', r1, '| form:', r2, '| restable:', r3, '| search:', r4, '| jsblock:', r5);
if (!(r1 && r2 && r3 && r4 && r5)) { console.log('ABORT - anchors missing, file NOT written'); process.exit(1); }
fs.writeFileSync(p, c, 'utf8');
console.log('SUCCESS - reserve UI + stock search installed');