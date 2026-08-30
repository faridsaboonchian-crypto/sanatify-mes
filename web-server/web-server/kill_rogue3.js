const fs = require('fs');
let h = fs.readFileSync('public/index.html', 'utf8');
let s = h.indexOf('invCardexItem');
let e = h.indexOf('async function loadInventory');
console.log('invCardexItem at: ' + s);
console.log('loadInventory at: ' + e);
if (s > 0 && e > s) {
  let addEvIdx = h.indexOf('addEventListener', s);
  if (addEvIdx !== -1 && addEvIdx < e) {
    let addEvLineEnd = h.indexOf('\n', addEvIdx);
    console.log('addEventListener line ends at: ' + addEvLineEnd);
    let removed = e - (addEvLineEnd + 1);
    console.log('REMOVING ' + removed + ' chars of rogue top-level code...');
    h = h.slice(0, addEvLineEnd + 1) + h.slice(e);
    fs.writeFileSync('public/index.html', h, 'utf8');
    console.log('SAVED SUCCESSFULLY');
  } else {
    console.log('addEventListener not found between markers');
  }
} else {
  console.log('NOT FOUND: s=' + s + ' e=' + e);
}
