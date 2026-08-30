const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');

const si = h.lastIndexOf('<script>');
const sj = h.lastIndexOf('</script>');
if (si === -1 || sj === -1) { console.log('Script tags not found.'); return; }

let before = h.slice(0, si + 8);
let script = h.slice(si + 8, sj);
let after = h.slice(sj);

//正则匹配所有单引号字符串（包括包含换行符的非法字符串）
const regex = /'((?:[^'\\]|\\.|[\n])*)'/g;

let fixedScript = script.replace(regex, (match, inner) => {
    // اگر رشته دارای Enter (خط جدید) بود، آن را به Backtick تبدیل کن
    if (inner.includes('\n')) {
        // جلوگیری از تداخل با کاراکترهای خاص Template Literal
        inner = inner.replace(/`/g, '\\`');
        inner = inner.replace(/\$\{/g, '\\${');
        return '`' + inner + '`';
    }
    return match;
});

fs.writeFileSync(p, before + fixedScript + after, 'utf8');
console.log('✅ Successfully fixed multi-line string syntax errors!');