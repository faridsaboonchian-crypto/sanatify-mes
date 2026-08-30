const fs = require('fs');
const p = 'public/index.html';
let c = fs.readFileSync(p, 'utf8');
const MARK = '// ===== FIX-TX-LABELS =====';
if (c.includes(MARK)) { console.log('already patched'); process.exit(0); }
const BLOCK = MARK + "\n(function(){ var __ot = (typeof invTxLabel==='function') ? invTxLabel : null; invTxLabel = function(t){ if(t==='reserve') return 'رزرو موجودی'; if(t==='release') return 'آزادسازی رزرو'; return __ot ? __ot(t) : String(t||'-'); }; try { INV_TX_FA.reserve='رزرو موجودی'; INV_TX_FA.release='آزادسازی رزرو'; } catch(e){} })();\n// ===== END FIX-TX-LABELS =====\n";
const i = c.lastIndexOf('</script>');
if (i === -1) { console.log('no script end found'); process.exit(1); }
c = c.slice(0, i) + BLOCK + c.slice(i);
fs.writeFileSync(p, c, 'utf8');
console.log('labels patched OK');