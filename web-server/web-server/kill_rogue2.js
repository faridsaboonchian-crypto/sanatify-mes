const fs = require('fs');
let h = fs.readFileSync('public/index.html', 'utf8');
let s1 = h.indexOf("invCardexItem')?.addEventListener");
let s2 = h.indexOf("invCardexItem').addEventListener");
let s = Math.max(s1, s2);
let e = h.indexOf('async function loadInventory');
console.log('listener at: ' + s);
console.log('loadInventory at: ' + e);
if (s > 0 && e > s) {
  let lineEnd = h.indexOf('\n', s);
  let removed = e - (lineEnd + 1);
  console.log('REMOVING ' + removed + ' chars of rogue top-level code...');
  h = h.slice(0, lineEnd + 1) + h.slice(e);
  fs.writeFileSync('public/index.html', h, 'utf8');
  console.log('SAVED SUCCESSFULLY');
} else {
  console.log('NOT FOUND');
}
