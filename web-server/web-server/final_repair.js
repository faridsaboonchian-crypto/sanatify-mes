const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');

// 1. حذف بلوک HTML سرگردان که اشتباهاً داخل <script> تزریق شده
c = c.replace(/<script>\s*<h3 class="inv-subtitle">[\s\S]*?<\/table>\s*<\/div>\s*const API/, '<script>\nconst API');

// 2. تبدیل تمام بک‌تیک‌ها به کوتیشن تکی (رفع مشکل Template Literal های هیبریدی)
c = c.replace(/\x60/g, "'");

// 3. چسباندن ایمن رشته‌های چندخطی با استفاده از Lookbehind برای نادیده گرفتن Escape ها
let lines = c.split('\n');
let out = [];
let buffer = null;
let quoteChar = null;

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (buffer === null) {
        let sCount = (line.match(/(?<!\\)'/g) || []).length;
        let dCount = (line.match(/(?<!\\)"/g) || []).length;

        if (sCount % 2 !== 0) { buffer = line; quoteChar = "'"; }
        else if (dCount % 2 !== 0) { buffer = line; quoteChar = '"'; }
        else { out.push(line); }
    } else {
        buffer += '\\n' + line;
        let regex = new RegExp('(?<!\\\\)' + quoteChar, 'g');
        let qCount = (buffer.match(regex) || []).length;
        if (qCount % 2 === 0) {
            out.push(buffer);
            buffer = null;
            quoteChar = null;
        }
    }
}
if (buffer !== null) out.push(buffer);

let fixed = out.join('\n');
fs.writeFileSync(p, fixed, 'utf8');

// 4. اعتبارسنجی نهایی موتور V8
const i = fixed.lastIndexOf('<script>');
const j = fixed.lastIndexOf('</script>');
if (i === -1 || j === -1) { console.log('ERROR: script tags missing'); process.exit(1); }
try {
    new vm.Script(fixed.slice(i + 8, j));
    console.log('SUCCESS: SYNTAX OK - File repaired and saved.');
} catch (e) {
    const m = /<anonymous>:(\d+)/.exec(e.stack || '');
    console.log('STILL ERROR line ' + (m ? m[1] : '?') + ': ' + e.message);
}