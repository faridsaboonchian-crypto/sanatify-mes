const fs = require('fs');
const backupPath = 'New Text Document (13).txt';
const htmlPath = 'public/index.html';

console.log('در حال بازسازی index.html از روی بکاپ سالم...');

// خواندن فایل بکاپ
const content = fs.readFileSync(backupPath, 'utf8');

// استخراج بخش HTML (از <!DOCTYPE html> تا </html>)
const htmlMatch = content.match(/(<!DOCTYPE html>[\s\S]*?<\/html>)/i);

if (!htmlMatch) {
    console.error('❌ خطا: نتوانستم بخش HTML را در فایل بکاپ پیدا کنم!');
    process.exit(1);
}

const htmlContent = htmlMatch[1];

// بررسی وجود بلوک مخرب STOCK
const stockIdx = htmlContent.indexOf('// STOCK');
const loadInvIdx = htmlContent.indexOf('async function loadInventory()');

let cleanHtml = htmlContent;

if (stockIdx !== -1 && loadInvIdx !== -1 && stockIdx < loadInvIdx) {
    console.log('⚠️ بلوک مخرب STOCK پیدا شد! در حال حذف...');
    const lineStart = htmlContent.lastIndexOf('\n', stockIdx) + 1;
    cleanHtml = htmlContent.slice(0, lineStart) + htmlContent.slice(loadInvIdx);
    console.log('✅ بلوک مخرب با موفقیت حذف شد!');
} else {
    console.log('✅ فایل بکاپ سالم است و نیازی به حذف ندارد.');
}

// نوشتن فایل تمیز
fs.writeFileSync(htmlPath, cleanHtml, 'utf8');
console.log('✅ index.html با موفقیت بازسازی شد!');
console.log('📊 اندازه فایل:', cleanHtml.length, 'کاراکتر');
