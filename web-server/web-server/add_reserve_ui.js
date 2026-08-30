const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');
fs.writeFileSync('public/index.html.before_reserve', c, 'utf8'); // بک‌آپ خودکار

function apply(c, anchor, repl) {
    if (c.includes(anchor)) return { c: c.split(anchor).join(repl), ok: true };
    const a2 = anchor.split('\n').join('\r\n');
    if (c.includes(a2)) return { c: c.split(a2).join(repl.split('\n').join('\r\n')), ok: true };
    return { c, ok: false };
}
const report = [];
function doRep(c, name, anchor, repl) { const r = apply(c, anchor, repl); report.push(name + ': ' + (r.ok ? 'OK' : 'NOT FOUND')); return r.c; }

if (c.includes('id="btnInventoryReserve"')) { console.log('ALREADY INSTALLED - nothing to do'); process.exit(0); }

// 1) دکمه رزرو در toolbar
c = doRep(c, 'button', `<button class="act" id="btnInventoryAdjust" style="display:none">
⚖️ اصلاح موجودی
</button>`, `<button class="act" id="btnInventoryAdjust" style="display:none">
⚖️ اصلاح موجودی
</button>
<button class="act" id="btnInventoryReserve" style="display:none">
📌 رزرو کالا
</button>`);

// 2) فرم رزرو
c = doRep(c, 'form', `<div class="note" id="invAdjustMsg"></div>
</div>`, `<div class="note" id="invAdjustMsg"></div>
</div>
<div class="filters hidden" id="invReserveForm">
<div class="frow">
<select id="iresItem" class="fsel"></select>
<input id="iresQty" type="number" min="0.001" placeholder="مقدار رزرو" style="width:110px" />
<select id="iresWarehouse" class="fsel"></select>
<input id="iresRef" placeholder="مرجع (شماره سفارش / دستور کار)" style="flex:1 1 200px" />
</div>
<div class="frow" style="margin-top:8px">
<input id="iresDesc" placeholder="شرح" style="flex:1 1 220px" />
<button class="act" id="invReserveSave" data-save style="background:#15803d">ثبت رزرو</button>
<button class="act fclear" onclick="document.getElementById('invReserveForm').classList.add('hidden')">انصراف</button>
</div>
<div class="note" id="invReserveMsg"></div>
</div>`);

// 3) جدول رزروهای باز
c = doRep(c, 'restable', `<h3 class="inv-subtitle">
گردش اخیر انبار
</h3>
<div class="tablewrap">
<table id="tbl-inv-tx"></table>
</div>`, `<h3 class="inv-subtitle">
گردش اخیر انبار
</h3>
<div class="tablewrap">
<table id="tbl-inv-tx"></table>
</div>
<h3 class="inv-subtitle">
رزروهای باز (اختصاص یافته)
</h3>
<div class="tablewrap">
<table id="tbl-inv-reservations"></table>
</div>`);

// 4) ورودی جستجو کنار فیلتر انبار
c = doRep(c, 'search', `<div class="frow" style="margin:8px 0">
<select id="invWhFilter" class="fsel">`, `<div class="frow" style="margin:8px 0">
<input id="invStockSearch" class="fsel" placeholder="جستجوی نام / کد کالا..." style="min-width:180px" />
<select id="invWhFilter" class="fsel">`);

// 5) فیلتر جستجو در invRenderStock
c = doRep(c, 'stockfilter', `const rows = (inventoryData.stockview || []).filter(x => !wh || x.warehouse === wh);`, `const q = ((document.getElementById('invStockSearch') || {}).value || '').trim().toLowerCase();
const rows = (inventoryData.stockview || []).filter(x => (!wh || x.warehouse === wh) && (!q || String(x.name || '').toLowerCase().indexOf(q) !== -1 || String(x.code || '').toLowerCase().indexOf(q) !== -1));`);

// 6) رندر رزروها داخل invRender
c = doRep(c, 'invrender', `invRenderStock();
invRenderItems();
invRenderTx();
invRenderCardex();
}`, `invRenderStock();
invRenderItems();
invRenderTx();
invRenderCardex();
invRenderReservations();
}`);

// 7) نمایش دکمه رزرو برای نقش انبار
c = doRep(c, 'role', `'btnInventoryAdjust'
].forEach(id => {`, `'btnInventoryAdjust',
'btnInventoryReserve'
].forEach(id => {`);

// 8) بلوک JS رزرو + جستجو
const JS = `
// ===== RESERVE UI (Phase 2 / Step 2.2) =====
function invFillReserveSelects() {
var itemSel = document.getElementById('iresItem');
if (itemSel) {
var items = (inventoryData && inventoryData.items) || [];
itemSel.innerHTML = '<option value="">انتخاب کالا...</option>' + items.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.code + ' — ' + x.name) + '</option>'; }).join('');
}
var whSel = document.getElementById('iresWarehouse');
if (whSel && !whSel.dataset.ready) { whSel.innerHTML = invWarehouseOptions(true); whSel.dataset.ready = '1'; }
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
document.getElementById('btnInventoryReserve')?.addEventListener('click', function () {
invFillReserveSelects();
document.getElementById('invReserveForm').classList.toggle('hidden');
});
document.getElementById('invReserveSave')?.addEventListener('click', function () {
var body = {
item_id: document.getElementById('iresItem').value,
quantity: Number(document.getElementById('iresQty').value),
warehouse: document.getElementById('iresWarehouse').value,
reason: (document.getElementById('iresDesc').value || '').trim(),
work_order: (document.getElementById('iresRef').value || '').trim()
};
invPost('/api/inventory/reserve', body, 'invReserveMsg', 'invReserveForm');
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
// ===== END RESERVE UI =====
`;
c = doRep(c, 'jsblock', `const AUTO_REFRESH_MS = 15000;`, JS + `\nconst AUTO_REFRESH_MS = 15000;`);

console.log(report.join('\n'));
const bad = report.filter(x => x.includes('NOT FOUND'));
if (bad.length) { console.log('ABORT - anchors missing, file NOT written'); process.exit(1); }

const i = c.lastIndexOf('<script>');
const j = c.lastIndexOf('</' + 'script>');
try { new vm.Script(c.slice(i + 8, j)); } catch (e) { console.log('SYNTAX ERROR - file NOT written: ' + e.message); process.exit(1); }
fs.writeFileSync(p, c, 'utf8');
console.log('SUCCESS - reserve UI + stock search installed');