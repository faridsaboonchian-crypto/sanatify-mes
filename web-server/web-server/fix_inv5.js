const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
if (h.indexOf('FIX-INV-5') !== -1) { console.log('FIX-INV-5 already applied'); process.exit(0); }
const b = fs.readFileSync('inv5_block.js', 'utf8');
const j = h.lastIndexOf('</script>');
if (j === -1) { console.log('ERROR: </script> not found'); process.exit(1); }
h = h.slice(0, j) + '\n' + b + '\n' + h.slice(j);
fs.writeFileSync(p, h, 'utf8');
console.log('OK: FIX-INV-5 applied');
