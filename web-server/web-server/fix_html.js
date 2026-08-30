const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');

function check(src) {
  const i = src.lastIndexOf('<script>');
  const j = src.lastIndexOf('</script>');
  if (i === -1 || j === -1) return 'NO SCRIPT TAGS';
  try { new vm.Script(src.slice(i + 8, j)); return 'OK'; }
  catch (e) { return 'SYNTAX ERROR: ' + e.message; }
}

console.log('before: ' + check(h));
let fixed = h.replace(/\}\}\}(\s*<\/script>)/g, '$1');
if (fixed !== h) console.log('stray }}} removed');
console.log('after:  ' + check(fixed));

if (check(fixed) === 'OK') { 
  fs.writeFileSync(p, fixed, 'utf8'); 
  console.log('SAVED'); 
} else { 
  console.log('NOT SAVED - still broken, send me the error text'); 
}