const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
const log = [];

// 1) حذف بلوک سرگردان TOP-LEVEL بین listener کارتکس و loadInventory
const lisMark = "invCardexItem')?.addEventListener";
const loadMark = 'async function loadInventory';
let li = h.indexOf(lisMark);
if (li === -1) li = h.indexOf('invRenderCardex());');
const lo = h.indexOf(loadMark);
if (li !== -1 && lo !== -1 && lo > li) {
    const lineEnd = h.indexOf('\n', li);
    const between = h.slice(lineEnd + 1, lo);
    if (/inventoryData\.items/.test(between)) {
        h = h.slice(0, lineEnd + 1) + h.slice(lo);
        log.push('stray top-level STOCK block removed');
    }
}

// 2) اصلاح loaders: inventory:null -> warehouse: loadInventory
if (/\binventory:\s*null/.test(h)) {
    h = h.replace(/\binventory:\s*null/, 'warehouse: loadInventory');
    log.push('loaders fixed -> warehouse: loadInventory');
}
if (!/warehouse:\s*loadInventory/.test(h)) {
    h = h.replace(/maintenance:\s*loadMaintenance/, 'maintenance: loadMaintenance,\n            warehouse: loadInventory');
    log.push('warehouse loader added');
}

// 3) اصلاح join شکستهٔ downloadCsv (اگر وجود داشت)
const reJoin = /lines\.join\('\\r[\r\n]+'\)/;
if (reJoin.test(h)) {
    h = h.replace(reJoin, 'lines.join(String.fromCharCode(13,10))');
    log.push('downloadCsv join fixed');
}
fs.writeFileSync(p, h, 'utf8');
console.log(log.length ? log.join('\n') : 'index.html: no changes needed');

// 4) اصلاح backupLog سرور (اگر شکسته بود)
let s = fs.readFileSync('server.js', 'utf8');
const reLog = /msg \+ '[\r\n]+'\s*;/;
if (reLog.test(s)) {
    s = s.replace(reLog, "msg + String.fromCharCode(10);");
    fs.writeFileSync('server.js', s, 'utf8');
    console.log('server.js backupLog fixed');
}

// 5) تأیید سینتکس
const m = h.match(/<script>([\s\S]*)<\/script>/);
try { new vm.Script(m[1]); console.log('[OK] index.html inline JS syntax OK'); }
catch (e) { console.log('[FAIL] ' + e.message); }