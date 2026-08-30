const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('clean_source.txt', 'utf8');
const starts = [];
let idx = src.indexOf('<!DOCTYPE html>');
while (idx !== -1) { starts.push(idx); idx = src.indexOf('<!DOCTYPE html>', idx + 1); }
if (starts.length < 2) { console.log('ERROR: نسخه دوم index.html در clean_source.txt پیدا نشد'); process.exit(1); }
const begin = starts[1];
const end = src.indexOf('</html>', begin);
if (end === -1) { console.log('ERROR: </html> پیدا نشد'); process.exit(1); }
let html = src.slice(begin, end + '</html>'.length);
html = html.replace(/حذف شود؟\r?\nاین کالا/g, 'حذف شود؟\\nاین کالا');
html = html.replace(/msg \+= '\r?\n⚠️/g, "msg += '\\n⚠️");
const si = html.lastIndexOf('<script>');
const sj = html.lastIndexOf('</script>');
try { new vm.Script(html.slice(si + 8, sj)); }
catch (e) { console.log('SYNTAX ERROR: ' + e.message); process.exit(1); }
fs.writeFileSync('public/index.html', html, 'utf8');
console.log('OK: index.html با نسخه تمیز جایگزین شد');