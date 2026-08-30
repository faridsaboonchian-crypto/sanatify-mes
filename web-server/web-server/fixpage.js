const fs = require('fs');
const vm = require('vm');
function log(x) { console.log(x); }
function repairStrings(src) {
    let n = 0; let s = src;
    s = s.replace(/lines\.join\(['"]\\r\r?\n\s*['"]\)/g, () => { n++; return "lines.join(String.fromCharCode(13,10))"; });
    s = s.replace(/msg \+ ['"]\r?\n\s*['"];/g, () => { n++; return "msg + String.fromCharCode(10);"; });
    return { s, n };
}
function removeDupHandlers(s) {
    const start = s.indexOf('// // ');
    if (start === -1) return { s, removed: false };
    const end = s.indexOf('// INDUSTRIAL FAY MES', start);
    if (end === -1 || end < start) return { s, removed: false };
    return { s: s.slice(0, start) + s.slice(end), removed: true };
}
function removeStrayStock(s) {
    const lis = s.search(/invCardexItem'\)\s*\?\.\s*addEventListener/);
    if (lis === -1) return { s, removed: false };
    const stock = s.indexOf('// STOCK', lis);
    if (stock === -1) return { s, removed: false };
    const anchor = s.indexOf('async function loadInventory', stock);
    if (anchor === -1) return { s, removed: false };
    let startCut = s.lastIndexOf('// ================', stock);
    if (startCut === -1 || startCut < lis) startCut = stock;
    return { s: s.slice(0, startCut) + s.slice(anchor), removed: true };
}
function check(code, label) {
    try { new vm.Script(code); log('[OK] ' + label + ' : syntax OK'); return true; }
    catch (e) { log('[FAIL] ' + label + ' : ' + e.message); return false; }
}
// ================= index.html =================
let html = fs.readFileSync('public/index.html', 'utf8');
const r1 = repairStrings(html); html = r1.s;
const d1 = removeDupHandlers(html); html = d1.s;
const s1 = removeStrayStock(html); html = s1.s;
log('index.html -> strings fixed: ' + r1.n + ' | dup handlers removed: ' + d1.removed + ' | stray block removed: ' + s1.removed);
fs.writeFileSync('public/index.html', html, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (m) check(m[1], 'index.html inline JS');
// ================= server.js =================
let srv = fs.readFileSync('server.js', 'utf8');
const r2 = repairStrings(srv); srv = r2.s;
log('server.js -> strings fixed: ' + r2.n);
fs.writeFileSync('server.js', srv, 'utf8');
check(srv, 'server.js');
log('DONE');