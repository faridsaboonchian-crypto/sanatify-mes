const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');
const before = c;

// A) حذف بلوک‌های باقی‌مانده از تعمیرهای قبلی (اگر وجود داشته باشد)
c = c.replace(/\/\/ ===== FIX-INV-[\s\S]*?\/\/ ===== END FIX-INV-[^\n]*\n?/g, '');

// B) بازنویسی تابع renderTable2 (اصلاح اینترپولیشن خراب)
const s = c.indexOf('function renderTable2(tab, rows) {');
const e = c.indexOf('function buildFilterBar(tab) {');
if (s !== -1 && e !== -1) {
    const fixedFn = [
        "function renderTable2(tab, rows) {",
        "const cols = COLS[tab]; const v = view[tab]; const tbl = document.getElementById('tbl-' + tab);",
        "let html = '<thead><tr>' + cols.map((cc) => { const arrow = v.sortKey === cc.key ? (v.sortDir > 0 ? ' ▲' : ' ▼') : ''; return '<th data-sort=\"' + cc.key + '\">' + esc(cc.label) + arrow + '</th>'; }).join('') + '</tr></thead><tbody>';",
        "if (!rows.length) html += '<tr><td colspan=\"' + cols.length + '\" class=\"empty\">داده‌ای مطابق فیلتر یافت نشد.</td></tr>';",
        "else rows.forEach((row) => { html += '<tr>' + cols.map((cc) => '<td>' + formatCell(cc, row) + '</td>').join('') + '</tr>'; });",
        "html += '</tbody>'; tbl.innerHTML = html;",
        "tbl.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => { const k = th.dataset.sort; if (v.sortKey === k) v.sortDir *= -1; else { v.sortKey = k; v.sortDir = 1; } v.page = 0; renderListTab(tab, true); });",
        "}",
        ""
    ].join('\n');
    c = c.slice(0, s) + fixedFn + c.slice(e);
}

// C) رفع خطای TDZ و اتصال تب انبار
c = c.replace(/loaders\.inventory\s*=\s*loadInventory;\n?/, '');
c = c.replace(/inventory:\s*null/, 'inventory: loadInventory, warehouse: loadInventory');

if (c === before) { console.log('NO CHANGE'); } else { fs.writeFileSync(p, c, 'utf8'); console.log('PATCHED'); }

const i = c.lastIndexOf('<script>');
const j = c.lastIndexOf('</' + 'script>');
try { new vm.Script(c.slice(i + 8, j)); console.log('SYNTAX OK'); }
catch (err) { console.log('SYNTAX ERROR: ' + err.message); }