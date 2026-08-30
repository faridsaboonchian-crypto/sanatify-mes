const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
const bak = 'public/index.html.broken';
function check(src) {
    const i = src.lastIndexOf('<script>');
    const j = src.lastIndexOf('</script>');
    if (i === -1 || j === -1) return 'NO SCRIPT TAGS';
    try { new vm.Script(src.slice(i + 8, j)); return 'OK'; }
    catch (e) { return 'ERR: ' + e.message; }
}
function repair(src) {
    let h = src;
    // 1) حذف HTML تزریق‌شده داخل <script> قبل از اولین دستور JS
    h = h.replace(/(<script>\s*)(<h3[\s\S]*?<\/table>\s*<\/div>\s*)(?=const API)/, '$1');
    // 2) یکسان‌سازی بک‌تیک‌های خراب به کوتیشن تکی
    h = h.replace(/`/g, "'");
    // 3) تعمیر رشته‌های چندخطی (اینتر خام داخل رشته)
    h = h.replace(/حذف شود؟\r?\nاین کالا/g, 'حذف شود؟\\nاین کالا');
    h = h.replace(/msg \+= '\r?\n⚠️/g, "msg += '\\n⚠️");
    return h;
}
let cur = fs.readFileSync(p, 'utf8');
console.log('current index.html raw  =>', check(cur));
let fixedCur = repair(cur);
let okCur = check(fixedCur) === 'OK';
console.log('current after repair    =>', check(fixedCur));
let okBak = false, fixedBak = null;
if (fs.existsSync(bak)) {
    console.log('index.html.broken raw   =>', check(fs.readFileSync(bak, 'utf8')));
    fixedBak = repair(fs.readFileSync(bak, 'utf8'));
    okBak = check(fixedBak) === 'OK';
    console.log('broken after repair     =>', check(fixedBak));
}
if (okCur) { fs.writeFileSync(p, fixedCur, 'utf8'); console.log('SAVED: repaired from current index.html'); }
else if (okBak) { fs.writeFileSync(p, fixedBak, 'utf8'); console.log('SAVED: current unfixable -> restored from index.html.broken (repaired)'); }
else { console.log('NOT SAVED: neither version could be fully repaired. Send the ERR lines.'); }