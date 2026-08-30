const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');

const stockIdx = h.indexOf('// STOCK');
const loadInvIdx = h.indexOf('async function loadInventory()');

console.log('stockIdx:', stockIdx, 'loadInvIdx:', loadInvIdx);

if (stockIdx !== -1 && loadInvIdx !== -1 && stockIdx < loadInvIdx) {
    // پیدا کردن ابتدای خطی که // STOCK در آن قرار دارد
    const lineStart = h.lastIndexOf('\n', stockIdx) + 1;
    const removedLen = loadInvIdx - lineStart;
    
    // حذف کل بلوک سرگردان از // STOCK تا قبل از loadInventory
    h = h.slice(0, lineStart) + h.slice(loadInvIdx);
    
    fs.writeFileSync(p, h, 'utf8');
    console.log('✅ بلوک سرگردان STOCK (' + removedLen + ' کاراکتر) با موفقیت حذف شد!');
} else {
    console.log('❌ بلوک STOCK پیدا نشد یا قبلاً حذف شده است.');
}
