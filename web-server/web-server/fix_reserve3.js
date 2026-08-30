const fs = require('fs');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');
const log = [];
const has = (s) => c.indexOf(s) !== -1;
function insBefore(anchor, add, name) {
    if (!has(anchor)) { log.push(name + ': ANCHOR MISSING'); return; }
    if (has(add)) { log.push(name + ': already'); return; }
    c = c.replace(anchor, add + '\n' + anchor); log.push(name + ': inserted');
}
function insAfter(anchor, add, name) {
    if (!has(anchor)) { log.push(name + ': ANCHOR MISSING'); return; }
    if (has(add)) { log.push(name + ': already'); return; }
    c = c.replace(anchor, anchor + add); log.push(name + ': inserted');
}

const FORM = `<div class="filters hidden" id="invReserveForm">
<div class="frow">
<select id="iresItem" class="fsel"></select>
<input id="iresQty" type="number" min="0.001" placeholder="مقدار رزرو" style="width:110px" />
<select id="iresWarehouse" class="fsel"></select>
<input id="iresLocation" placeholder="محل/قفسه (اختیاری)" />
<input id="iresLot" placeholder="شماره بچ/لات (اختیاری)" />
</div>
<div class="frow" style="margin-top:8px">
<input id="iresRef" placeholder="مرجع (شماره سفارش / دستور کار)" style="flex:1 1 200px" />
<input id="iresDesc" placeholder="شرح" style="flex:1 1 220px" />
<button class="act" id="invReserveSave" data-save style="background:#15803d">ثبت رزرو</button>
<button class="act fclear" onclick="document.getElementById('invReserveForm').classList.add('hidden')">انصراف</button>
</div>
<div class="note" id="invReserveMsg"></div>
</div>`;

insBefore('<button class="act excel" id="expInventoryStock">', '<button class="act" id="btnInventoryReserve" style="display:none">📌 رزرو کالا</button>', 'button');
insBefore('<div class="kpis" id="invKpis"></div>', FORM, 'form');
insAfter('<table id="tbl-inv-tx"></table>', '\n</div>\n<h3 class="inv-subtitle">رزروهای باز (اختصاص یافته)</h3>\n<div class="tablewrap">\n<table id="tbl-inv-reservations"></table>', 'restable');
insBefore('<select id="invWhFilter" class="fsel">', '<input id="invStockSearch" class="fsel" placeholder="جستجوی نام / کد کالا..." style="min-width:180px" />', 'stocksearch');
insBefore('<select id="invCardexItem" class="fsel">', '<input id="invCardexSearch" class="fsel" placeholder="جستجوی کالا در کارتکس (نام / کد)..." style="min-width:180px" />', 'cardexsearch');

const needBind = !has('RESERVE UI + STOCK SEARCH') && !has('RESERVE UI v2') && !has('RESERVE UI v3');
const BIND = needBind ? `
var bb = document.getElementById('btnInventoryReserve');
if (bb) bb.addEventListener('click', function () { if (typeof invFillFormSelects === 'function') invFillFormSelects(); if (typeof invFillReserveSelects === 'function') invFillReserveSelects(); document.getElementById('invReserveForm').classList.toggle('hidden'); });
var bs = document.getElementById('invReserveSave');
if (bs) bs.addEventListener('click', function () { invPost('/api/inventory/reserve', { item_id: document.getElementById('iresItem').value, quantity: Number(document.getElementById('iresQty').value), warehouse: document.getElementById('iresWarehouse').value, location: (document.getElementById('iresLocation') || {}).value || '', lot_no: (document.getElementById('iresLot') || {}).value || '', reference: (document.getElementById('iresRef') || {}).value || '', description: (document.getElementById('iresDesc') || {}).value || '' }, 'invReserveMsg', 'invReserveForm'); });
var rt = document.getElementById('tbl-inv-reservations');
if (rt) rt.addEventListener('click', function (e) { var b = e.target.closest('button[data-unreserve]'); if (!b) return; if (!confirm('آزادسازی این رزرو؟')) return; b.disabled = true; fetch('/api/inventory/unreserve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.getAttribute('data-unreserve') }) }).then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || 'خطا'); loadInventory(); }).catch(function (err) { alert('خطا: ' + err.message); }).finally(function () { b.disabled = false; }); });
` : '';

const V3 = `
// ===== RESERVE UI v3 =====
(function () {
var __origCardex = (typeof invRenderCardex === 'function') ? invRenderCardex : null;
if (__origCardex) {
invRenderCardex = function () {
var q = ((document.getElementById('invCardexSearch') || {}).value || '').trim().toLowerCase();
if (q && inventoryData && inventoryData.transactions) {
var orig = inventoryData.transactions;
inventoryData.transactions = orig.filter(function (t) { return String(invItemName(t.item_id)).toLowerCase().indexOf(q) !== -1; });
try { return __origCardex(); } finally { inventoryData.transactions = orig; }
}
return __origCardex();
};
}
var cs = document.getElementById('invCardexSearch');
if (cs) cs.addEventListener('input', function () { if (typeof invRenderCardex === 'function') invRenderCardex(); });
function showRes() {
var el = document.getElementById('btnInventoryReserve');
if (!el) return;
fetch('/api/auth/me', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
var role = (j && j.ok && j.user) ? String(j.user.role || 'viewer') : 'viewer';
el.style.display = (role === 'admin' || role === 'warehouse') ? '' : 'none';
}).catch(function () { el.style.display = ''; });
}
showRes();
${BIND}
})();
// ===== END RESERVE UI v3 =====
`;

if (!has('RESERVE UI v3')) {
    const j = c.lastIndexOf('</' + 'script>');
    c = c.slice(0, j) + V3 + c.slice(j);
    log.push('v3 block: appended');
} else log.push('v3 block: already');

fs.writeFileSync(p, c, 'utf8');
console.log(log.join('\n'));
console.log('DONE');