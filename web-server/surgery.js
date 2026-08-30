const fs = require('fs');
console.log('🔍 شروع جراحی دقیق فایل‌ها...');
let html = fs.readFileSync('public/index.html', 'utf8');
let htmlFixed = 0;

// 1. جراحی شکستگی فیزیکی در تابع downloadCsv
const regex1 = /lines\.join\('\\r[\r\n]+'\);/g;
if (regex1.test(html)) {
    html = html.replace(regex1, "lines.join(String.fromCharCode(13, 10));");
    console.log('✅ شکستگی downloadCsv در index.html جراحی شد.');
    htmlFixed++;
}

// 2. حذف بلوک‌های سرگردان و تکراری STOCK که در فایل پیوستی تو وجود دارد
const strayBlock = html.indexOf('// =========================================================\n// STOCK');
if (strayBlock !== -1) {
    html = html.slice(0, strayBlock) + html.slice(html.indexOf('async function loadInventory()', strayBlock));
    console.log('✅ بلوک سرگردان STOCK و کدهای تکراری حذف شد.');
    htmlFixed++;
}

if (htmlFixed > 0) {
    fs.writeFileSync('public/index.html', html, 'utf8');
    console.log('💾 فایل index.html با موفقیت ذخیره شد.');
} else {
    console.log('⚠️ هیچ شکستگی استانداردی در index.html پیدا نشد.');
}

// 3. جراحی شکستگی در backupLog سرور
let srv = fs.readFileSync('server.js', 'utf8');
const regex2 = /msg \+ '[\r\n]+';/g;
if (regex2.test(srv)) {
    srv = srv.replace(regex2, "msg + String.fromCharCode(10);");
    fs.writeFileSync('server.js', srv, 'utf8');
    console.log('✅ شکستگی backupLog در server.js جراحی شد.');
}

console.log('🎉 پایان جراحی.');