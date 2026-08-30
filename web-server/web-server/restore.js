const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');

// 1) حذف کاراکترهای \n خام که اول خطوط تزریق شده‌اند
c = c.replace(/^\\n/gm, '');

// 2) اصلاح renderTable2 (اینترپولیشن‌های خراب داخل کوتیشن تک)
c = c.split(`return '<th data-tab="\${tab}" data-sort="\${c.key}">\${esc(c.label)}\${arrow}</th>';`).join(`return '<th data-tab="' + tab + '" data-sort="' + c.key + '">' + esc(c.label) + arrow + '</th>';`);
c = c.split(`html += '<tr><td colspan="\${cols.length}" class="empty">داده‌ای مطابق فیلتر یافت نشد.</td></tr>';`).join(`html += '<tr><td colspan="' + cols.length + '" class="empty">داده‌ای مطابق فیلتر یافت نشد.</td></tr>';`);
c = c.split(`cols.map((c) => '<td>\${formatCell(c, row)}</td>').join('')`).join(`cols.map((c) => '<td>' + formatCell(c, row) + '</td>').join('')`);

// 3) رفع TDZ مربوط به loaders
c = c.replace(/loaders\.inventory = loadInventory;\r?\n/, '');
c = c.split('inventory: null').join('inventory: loadInventory');

// 4) رفع TDZ مربوط به loadRole/currentTab
c = c.replace(/^loadRole\(\);$/m, 'setTimeout(loadRole, 0);');

// 5) افزودن دو تابع جاافتادهٔ کارتکس
const NEWFUNCS = `
function invFillCardexSelect() {
const el = document.getElementById('invCardexItem');
if (!el) return;
const old = el.value;
const items = (inventoryData && inventoryData.items) ? inventoryData.items : [];
el.innerHTML = '<option value="">همه کالاها</option>' + items.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc((x.code || '') + ' — ' + (x.name || '')) + '</option>'; }).join('');
if (old) el.value = old;
}
function invRenderCardex() {
const table = document.getElementById('tbl-inv-cardex');
if (!table) return;
const sel = document.getElementById('invCardexItem');
const itemId = sel ? sel.value : '';
const txs = ((inventoryData && inventoryData.transactions) ? inventoryData.transactions : []).filter(function (t) { return !itemId || String(t.item_id) === String(itemId); });
let html = '<thead><tr><th>نوع تراکنش</th><th>شماره سند</th><th>کالا</th><th>مقدار</th><th>انبار / مبدا</th><th>مقصد</th><th>لات / بچ</th><th>تاریخ</th></tr></thead><tbody>';
if (!txs.length) html += '<tr><td colspan="8" class="empty">کارتکس خالی است.</td></tr>';
txs.forEach(function (row) {
const docNo = row.receipt_no || row.issue_no || row.transfer_no || row.adjustment_no || '-';
const location = row.warehouse ? (INV_WAREHOUSES[row.warehouse] || row.warehouse) : (row.from_warehouse ? (INV_WAREHOUSES[row.from_warehouse] || row.from_warehouse) : '-');
const destination = row.destination ? row.destination : (row.to_warehouse ? (INV_WAREHOUSES[row.to_warehouse] || row.to_warehouse) : '-');
const qty = (row.tx_type === 'adjustment') ? row.delta_quantity : row.quantity;
html += '<tr><td>' + esc(INV_TX_FA[row.tx_type] || row.tx_type || '-') + '</td><td>' + esc(docNo) + '</td><td>' + esc(invItemName(row.item_id)) + '</td><td>' + invQty(qty) + '</td><td>' + esc(location) + '</td><td>' + esc(destination) + '</td><td>' + esc(row.lot_no || '-') + '</td><td>' + fmtDate(row.timestamp) + '</td></tr>';
});
table.innerHTML = html + '</tbody>';
}
document.getElementById('invCardexItem')?.addEventListener('change', invRenderCardex);
`;
c = c.replace('function invRenderStock() {', NEWFUNCS + '\nfunction invRenderStock() {');

// اعتبارسنجی و ذخیرهٔ امن
const i = c.lastIndexOf('<script>');
const j = c.lastIndexOf('</' + 'script>');
try {
    new vm.Script(c.slice(i + 8, j));
    fs.writeFileSync(p, c, 'utf8');
    console.log('RESTORED + SYNTAX OK');
} catch (e) {
    const m = /<anonymous>:(\d+)/.exec(e.stack || '');
    const n = m ? +m[1] : 0;
    console.log('STILL BROKEN line ' + n + ': ' + e.message);
}