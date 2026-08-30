const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
if (h.indexOf('FIX-PROD-1') !== -1) { console.log('already applied'); process.exit(0); }
const block = fs.readFileSync('prod_block.js', 'utf8');
const i = h.lastIndexOf('</script>');
h = h.slice(0, i) + '\n// ===== FIX-PROD-1 =====\n' + block + '\n' + h.slice(i);
fs.writeFileSync(p, h, 'utf8');
console.log('OK: fix_prod applied');