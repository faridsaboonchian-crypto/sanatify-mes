const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');
function check(s){ const i=s.lastIndexOf('<script>'); const j=s.lastIndexOf('</'+'script>'); try{ new vm.Script(s.slice(i+8,j)); return true; }catch(e){ return false; } }
// A) حذف HTML سرگردان داخل <script>
c = c.replace(/<script>\s*(<h3[\s\S]*?<\/table>\s*<\/div>\s*)(?=const API)/, '<script>\n');
// B) تعمیر رشته‌های چندخطی
c = c.replace(/حذف شود؟\r?\nاین کالا/g, 'حذف شود؟\\nاین کالا');
c = c.replace(/msg \+= '\r?\n⚠️/g, "msg += '\\n⚠️");
c = c.replace(/msg \+= `\r?\n⚠️/g, "msg += '\\n⚠️");
// C) رفع TDZ (اگر الگو وجود داشت)
if (c.indexOf('loaders.inventory = loadInventory;') !== -1 && c.indexOf('loaders.inventory = loadInventory;') < c.indexOf('const loaders = {')) {
  c = c.replace(/loaders\.inventory = loadInventory;/, '/* set below */');
  c = c.replace(/inventory: null/, 'inventory: loadInventory, warehouse: loadInventory');
}
if (/\nloadRole\(\);/.test(c) && c.indexOf('loadRole();') < c.indexOf('let autoRefreshOn')) {
  c = c.replace(/\nloadRole\(\);/, '\nsetTimeout(loadRole, 0);');
}
// D) رفع ${} داخل کوتیشن تک در renderTable2
c = c.replace("'<th data-tab=\"${tab}\" data-sort=\"${c.key}\">${esc(c.label)}${arrow}</th>'", "'<th data-tab=\"' + tab + '\" data-sort=\"' + c.key + '\">' + esc(c.label) + arrow + '</th>'");
c = c.replace("'<tr><td colspan=\"${cols.length}\" class=\"empty\">داده‌ای مطابق فیلتر یافت نشد.</td></tr>'", "'<tr><td colspan=\"' + cols.length + '\" class=\"empty\">داده‌ای مطابق فیلتر یافت نشد.</td></tr>'");
c = c.replace("'<td>${formatCell(c, row)}</td>'", "'<td>' + formatCell(c, row) + '</td>'");
// E) اگر هنوز خراب است، تبدیل بک‌تیک‌ها به کوتیشن (فقط برای نسخهٔ خراب)
if (!check(c)) { c = c.split('`').join("'"); }
if (check(c)) { fs.writeFileSync(p, c, 'utf8'); console.log('PATCHED + SYNTAX OK'); }
else { console.log('NOT WRITTEN - STILL BROKEN'); }