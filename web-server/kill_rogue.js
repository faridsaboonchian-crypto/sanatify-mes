const fs = require('fs');
const vm = require('vm');
const path = 'public/index.html';
let html = fs.readFileSync(path, 'utf8');

const startMarker = '// =========================================================\n// STOCK';
const endMarker = 'async function loadInventory()';

let startIdx = html.indexOf(startMarker);
if (startIdx === -1) startIdx = html.indexOf('// STOCK');
let endIdx = html.indexOf(endMarker);

if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    console.log('✅ بلوک مخرب TOP-LEVEL پیدا شد!');
    console.log('   در حال حذف ' + (endIdx - startIdx) + ' کاراکتر کد مرده...');

    // حذف کامل بلوک مخرب
    html = html.substring(0, startIdx) + html.substring(endIdx);
    fs.writeFileSync(path, html, 'utf8');
    console.log('✅ فایل با موفقیت ذخیره شد!');

    // تست سلامت نهایی
    const i = html.indexOf('<script>');
    const j = html.lastIndexOf('</script>');
    if (i !== -1 && j !== -1) {
        try {
            new vm.Script(html.substring(i + 8, j));
            console.log('✅ تست سینتکس: PASS (فایل کاملاً سالم است)');
        } catch (e) {
            console.log('❌ تست سینتکس: FAIL -', e.message);
        }
    }
} else {
    console.log('❌ بلوک مخرب پیدا نشد. startIdx:', startIdx, 'endIdx:', endIdx);
}