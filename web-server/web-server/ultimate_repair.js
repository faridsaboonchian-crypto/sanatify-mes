const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');

// 1) حذف بلوک HTML تزریق‌شده داخل <script>
c = c.replace(/<script>\s*<h3[\s\S]*?<\/table>\s*<\/div>\s*/, '<script>\n');

// 2) تبدیل همهٔ بک‌تیک‌ها به کوتیشن تکی
c = c.split('`').join("'");

// 3) چسباندن رشته‌های چندخطی (بر اساس توازن کوتیشن‌ها)
function countQ(s, q) { let n = 0; for (let i = 0; i < s.length; i++) { if (s[i] === q && (i === 0 || s[i - 1] !== '\\')) n++; } return n; }
const lines = c.split('\n');
const out = [];
let open = null, buf = '';
for (const ln of lines) {
    if (open === null) {
        if (countQ(ln, "'") % 2) { open = "'"; buf = ln; }
        else if (countQ(ln, '"') % 2) { open = '"'; buf = ln; }
        else out.push(ln);
    } else {
        buf += '\\n' + ln.trim();
        if (countQ(buf, open) % 2 === 0) { out.push(buf); buf = ''; open = null; }
    }
}
if (buf) out.push(buf);
c = out.join('\n');

// 4) اعتبارسنجی و ذخیرهٔ امن
const i = c.lastIndexOf('<script>');
const j = c.lastIndexOf('</' + 'script>');
try {
    new vm.Script(c.slice(i + 8, j));
    fs.writeFileSync(p, c, 'utf8');
    console.log('SUCCESS: index.html repaired and saved.');
} catch (e) {
    const m = /<anonymous>:(\d+)/.exec(e.stack || '');
    const n = m ? +m[1] : 0;
    console.log('STILL ERROR line ' + (n || '?') + ': ' + e.message);
    if (n) { const L = c.slice(i + 8, j).split('\n'); console.log('CONTEXT:\n' + L.slice(Math.max(0, n - 4), n + 3).map((x, k) => (Math.max(0, n - 4) + k + 1) + ': ' + x).join('\n')); }
}