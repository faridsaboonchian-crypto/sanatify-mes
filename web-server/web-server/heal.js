const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');
const si = c.lastIndexOf('<script>');
const sj = c.lastIndexOf('</' + 'script>');
if (si === -1 || sj === -1) { console.log('NO SCRIPT TAGS'); process.exit(1); }
const head = c.slice(0, si + 8);
let body = c.slice(si + 8, sj);
const tail = c.slice(sj);
// A) حذف HTML سرگردان قبل از اولین دستور واقعی
const apiIdx = body.indexOf("const API = '';");
if (apiIdx > 0) body = body.slice(apiIdx);
// B) رفع TDZ: اگر انتساب loaders قبل از تعریف const آمده
const earlyAssign = 'loaders.inventory = loadInventory;';
const constLoaders = 'const loaders = {';
const ea = body.indexOf(earlyAssign);
const cl = body.indexOf(constLoaders);
if (ea !== -1 && cl !== -1 && ea < cl) {
    body = body.replace(earlyAssign, '/* inventory wired below */');
    body = body.replace(/inventory:\s*null/, 'inventory: loadInventory');
}
// C) اصلاح ${} داخل کوتیشن تک در renderTable2
body = body.replace("'<th data-tab=\"${tab}\" data-sort=\"${c.key}\">${esc(c.label)}${arrow}</th>'",
    "'<th data-tab=\"' + tab + '\" data-sort=\"' + c.key + '\">' + esc(c.label) + arrow + '</th>'");
body = body.replace("'<tr><td colspan=\"${cols.length}\" class=\"empty\">داده‌ای مطابق فیلتر یافت نشد.</td></tr>'",
    "'<tr><td colspan=\"' + cols.length + '\" class=\"empty\">داده‌ای مطابق فیلتر یافت نشد.</td></tr>'");
body = body.replace("'<td>${formatCell(c, row)}</td>'", "'<td>' + formatCell(c, row) + '</td>'");
// اعتبارسنجی و ذخیرهٔ امن
try {
    new vm.Script(body);
    fs.writeFileSync(p, head + body + tail, 'utf8');
    console.log('HEALED + SAVED');
} catch (e) {
    console.log('STILL BROKEN: ' + e.message);
    const m = /<anonymous>:(\d+)/.exec(e.stack || '');
    if (m) { const L = body.split('\n'); console.log('LINE ' + m[1] + ': ' + (L[+m[1] - 1] || '').slice(0, 140)); }
}