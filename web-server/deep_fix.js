const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
console.log('=== DEEP DIAGNOSIS ===');
console.log('file size:', h.length);
const i = h.indexOf('<script>');
const j = h.lastIndexOf('</script>');
let src = h.slice(i + 8, j);
function syntaxCheck(code) { try { new vm.Script(code); return null; } catch (e) { return e; } }
function showErr(e, code) {
    const m = /<anonymous>:(\d+)/.exec(e.stack || '');
    const n = m ? +m[1] : 0; const L = code.split('\n');
    console.log('FAIL at line ' + n + ': ' + e.message);
    for (let k = Math.max(0, n - 4); k < Math.min(L.length, n + 2); k++) console.log((k + 1) + '| ' + L[k]);
}
let err = syntaxCheck(src);
if (err) { console.log('BEFORE-FIX:'); showErr(err, src); } else console.log('SYNTAX OK (before fix)');
const lis = src.indexOf("invCardexItem')?.addEventListener");
const load = src.indexOf('async function loadInventory');
let fixed = false;
if (lis !== -1 && load !== -1 && load > lis) {
    const cutStart = src.indexOf('\n', lis) + 1;
    const region = src.slice(cutStart, load);
    if (region.indexOf('inventoryData.items') !== -1) {
        console.log('STRAY BLOCK FOUND (' + region.length + ' chars) -> removing');
        src = src.slice(0, cutStart) + src.slice(load);
        fixed = true;
    }
}
if (fixed) { h = h.slice(0, i + 8) + src + h.slice(j); fs.writeFileSync(p, h, 'utf8'); console.log('file rewritten, new size:', h.length); }
err = syntaxCheck(src);
if (err) { console.log('STILL FAIL:'); showErr(err, src); } else console.log('FINAL SYNTAX: OK ✅');
console.log('markers: loaders=' + src.indexOf('const loaders') + ' | bootstrap=' + src.indexOf('refreshCurrentTab().then') + ' | loadInventory=' + src.indexOf('async function loadInventory'));
console.log('=== DONE ===');