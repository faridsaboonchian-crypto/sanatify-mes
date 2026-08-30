const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
const log = [];

// 1) حذف بلوک سرگردان TOP-LEVEL (بین listener کارتکس و loadInventory)
for (let guard = 0; guard < 5; guard++) {
    const e = /async\s+function\s+loadInventory\s*\(/.exec(h);
    if (!e) break;
    const before = h.slice(0, e.index);
    const re = /^[ \t]{0,3}const[ \t]+items[ \t]*=/mg;
    let last = -1, m;
    while ((m = re.exec(before)) !== null) last = m.index;
    if (last === -1) break;
    const region = h.slice(last, e.index);
    if (!/inventoryData\.items/.test(region)) break;
    h = h.slice(0, last) + h.slice(e.index);
    log.push('stray top-level block removed');
}

// 2) تعمیر رشتهٔ شکستهٔ downloadCsv (اگر وجود داشت)
if (/lines\.join\('[^')]*[\r\n]+[^)]*\)/.test(h)) {
    h = h.replace(/lines\.join\('[^')]*[\r\n]+[^)]*\)/g, 'lines.join(String.fromCharCode(13,10))');
    log.push('downloadCsv fixed');
}

// 3) تضمین loader انبار
if (/\binventory:\s*null/.test(h)) { h = h.replace(/\binventory:\s*null/, 'warehouse: loadInventory'); log.push('loaders fixed'); }

fs.writeFileSync(p, h, 'utf8');
console.log(log.length ? 'FIXED: ' + log.join(' | ') : 'no changes needed');

// تأیید سینتکس
const i = h.indexOf('<script>'); const j = h.lastIndexOf('</script>');
try { new (require('vm').Script)(h.slice(i + 8, j)); console.log('SYNTAX OK'); }
catch (err) { console.log('SYNTAX FAIL: ' + err.message); }