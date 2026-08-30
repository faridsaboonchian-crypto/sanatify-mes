const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
// 1) حذف HTML سرگردانِ تزریق‌شده بلافاصله بعد از <script>
h = h.replace(/<script>\s*(<h3[\s\S]*?<\/table>\s*<\/div>\s*)(?=const API)/, '<script>\n');
const si = h.lastIndexOf('<script>');
const sj = h.lastIndexOf('</script>');
let js = h.slice(si + 8, sj);
// 2) تبدیل همه بک‌تیک‌ها به کوتیشن تکی (در این اسکریپت هیچ ${} وجود ندارد)
if (js.indexOf('${') === -1) { js = js.replace(/`/g, "'"); } else { console.log('WARN: template literal found, skipped global replace'); }
// 3) تعمیر رشته‌های چندخطی (اینتر خام داخل رشته)
js = js.replace(/حذف شود؟\s*\r?\nاین کالا/g, 'حذف شود؟\\nاین کالا');
js = js.replace(/msg \+= '\s*\r?\n⚠️/g, "msg += '\\n⚠️");
h = h.slice(0, si + 8) + js + h.slice(sj);
fs.writeFileSync(p, h, 'utf8');
// اعتبارسنجی
const h2 = fs.readFileSync(p, 'utf8');
const a = h2.lastIndexOf('<script>'); const b = h2.lastIndexOf('</script>');
try { new vm.Script(h2.slice(a + 8, b)); console.log('SYNTAX OK'); }
catch (e) { console.log('SYNTAX ERROR: ' + e.message); const m = /<anonymous>:(\d+)/.exec(e.stack || ''); if (m) { const ln = +m[1]; const L = h2.slice(a + 8, b).split('\n'); console.log('LINE ' + ln + ': ' + (L[ln - 1] || '')); } }