const fs = require('fs');
// ---------- index.html ----------
let h = fs.readFileSync('public/index.html', 'utf8');
let changed = false;
// 1) رشته شکسته downloadCsv
const reCsv = /lines\.join\('\\r[\r\n]+'\);/;
if (reCsv.test(h)) { h = h.replace(reCsv, 'lines.join(String.fromCharCode(13,10));'); changed = true; console.log('FIX downloadCsv'); }
// 2) حذف بلوک تکراری هندلرهای تعمیرات
const dupStart = h.indexOf('// // =====================================================================');
if (dupStart !== -1) {
    const dupEnd = h.indexOf('// INDUSTRIAL FAY MES', dupStart);
    if (dupEnd !== -1) { h = h.slice(0, dupStart) + h.slice(dupEnd); changed = true; console.log('FIX duplicate maintenance handlers'); }
}
// 3) انتقال تعریف loaders/currentTab به بالای اسکریپت (رفع TDZ)
const st = h.indexOf('const AUTO_REFRESH_MS = 15000;');
if (st !== -1) {
    const ls = h.indexOf('const loaders = {', st);
    if (ls !== -1) {
        const le = h.indexOf('};', ls);
        if (le !== -1) {
            const block = h.slice(st, le + 2);
            let rest = h.slice(0, st) + h.slice(le + 2);
            const anchor = 'let WEB_USER = null;';
            const ai = rest.indexOf(anchor);
            if (ai !== -1) {
                rest = rest.slice(0, ai + anchor.length) + '\n' + block + '\n' + rest.slice(ai + anchor.length);
                h = rest; changed = true; console.log('FIX loaders/currentTab order');
            }
        }
    }
}
if (changed) { fs.writeFileSync('public/index.html', h, 'utf8'); console.log('index.html saved'); }
// ---------- server.js ----------
let s = fs.readFileSync('server.js', 'utf8');
const reLog = /msg \+ '[\r\n]+';/;
if (reLog.test(s)) { s = s.replace(reLog, 'msg + String.fromCharCode(10);'); fs.writeFileSync('server.js', s, 'utf8'); console.log('FIX backupLog'); }
console.log('REPAIR DONE');