const fs = require('fs');
let h = fs.readFileSync('public/index.html', 'utf8');
let s = h.indexOf('// STOCK');
let e = h.indexOf('async function loadInventory');
console.log('s=' + s + ' e=' + e);
if (s > 0 && e > s) {
  let lineStart = h.lastIndexOf('\n', s) + 1;
  h = h.slice(0, lineStart) + h.slice(e);
  fs.writeFileSync('public/index.html', h, 'utf8');
  console.log('REMOVED ' + (e - lineStart) + ' chars');
} else {
  console.log('NOT FOUND');
}
