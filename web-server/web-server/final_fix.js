const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
const log = [];

// 1) حذف بلوک سرگردان TOP-LEVEL بین listener کارتکس و loadInventory
const eIdx = h.indexOf('async function loadInventory()');
const sHit = h.lastIndexOf('invRenderCardex());', eIdx);
if (eIdx !== -1 && sHit !== -1) {
    const lineEnd = h.indexOf('\n', sHit);
    if (lineEnd !== -1 && lineEnd < eIdx) {
        const removed = h.slice(lineEnd + 1, eIdx);
        if (removed.includes('inventoryData.items') || removed.includes('tbl-inv-stock')) {
            h = h.slice(0, lineEnd + 1) + h.slice(eIdx);
            log.push('orphan top-level block removed');
        }
    }
}

// 2) تعمیر رشتهٔ شکستهٔ downloadCsv (اینتر واقعی داخل کوتیشن)
const reCsv = /lines\.join\('[^')]*[\r\n]+[^)]*\)/;
if (reCsv.test(h)) { h = h.replace(reCsv, 'lines.join(String.fromCharCode(13,10))'); log.push('downloadCsv fixed'); }

// 3) تضمین loader انبار
if (/inventory:\s*null/.test(h)) { h = h.replace(/inventory:\s*null/, 'warehouse: loadInventory'); log.push('loaders fixed'); }

fs.writeFileSync(p, h, 'utf8');
console.log(log.length ? 'FIXED: ' + log.join(' | ') : 'no changes needed');

// تأیید سینتکس
const i = h.indexOf('<script>'); const j = h.lastIndexOf('</script>');
try { new vm.Script(h.slice(i + 8, j)); console.log('SYNTAX OK'); }
catch (e) { console.log('SYNTAX FAIL: ' + e.message); }