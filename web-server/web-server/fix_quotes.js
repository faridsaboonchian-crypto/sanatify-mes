const fs = require('fs');
const vm = require('vm');
let h = fs.readFileSync('public/index.html', 'utf8');
h = h.replace(/\r\n/g, '\n');

// 1) حذف تکهٔ HTML که اشتباهاً داخل <script> رفته
h = h.split('<script>\n<h3 class="inv-subtitle">\nرزروهای باز (اختصاص یافته)\n</h3>\n<div class="tablewrap">\n<table id="tbl-inv-reservations"></table>\n</div>\nconst API').join('<script>\nconst API');

// 2) تبدیل همهٔ بک‌تیک‌های خراب به کوتیشن تکی
h = h.split('`').join("'");

// 3) درست کردن دو رشتهٔ چندخطی در invDeleteItem
h = h.split("حذف شود؟\nاین کالا").join("حذف شود؟\\nاین کالا");
h = h.split("msg += '\n⚠️").join("msg += '\\n⚠️");

fs.writeFileSync('public/index.html', h, 'utf8');

// بررسی سینتکس
const i = h.lastIndexOf('<script>');
const j = h.lastIndexOf('</script>');
try { new vm.Script(h.slice(i + 8, j)); console.log('SYNTAX OK'); }
catch (e) { console.log('SYNTAX ERROR line ' + (e.stack.match(/<anonymous>:(\d+)/) || [])[1] + ': ' + e.message); }