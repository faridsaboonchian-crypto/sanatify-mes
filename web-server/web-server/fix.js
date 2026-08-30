const fs = require('fs');
let c = fs.readFileSync('index.html', 'utf8');
let changed = true;
while(changed) {
  changed = false;
  let newC = c.replace(/\x60([^\x60]*?)'\s*\+\s*([^\x60]*?)\s*\+\s*'([^\x60]*?)\x60/, '\x60\x24{}\x60');
  if (newC !== c) {
    c = newC;
    changed = true;
  }
}
fs.writeFileSync('index.html', c, 'utf8');
console.log('Fixed index.html successfully!');
