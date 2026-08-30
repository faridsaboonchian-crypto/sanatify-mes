cd "D:\MES  SANATIFY APP\web-server\web-server"
Set-Content fix_vis.js -Value @'
const fs = require('fs');
const vm = require('vm');
// ---------- server.js ----------
let s = fs.readFileSync('server.js', 'utf8');
const anchor = 'const totalAvailable = stock.filter';
if (s.indexOf('FIX-INV-3') !== -1) { console.log('server: already patched'); }
else {
  const i = s.indexOf(anchor);
  if (i === -1) { console.log('server: ANCHOR NOT FOUND'); }
  else {
    const block = '// ===== FIX-INV-3 (Phase 1.5 / Option B) =====\nitems.forEach(item => {\nif (!stockview.some(v => v.item_id === item.id)) {\nstockview.push({ item_id: item.id, code: item.code, name: item.name, category: item.category, unit: item.unit, warehouse: \'\', physical: 0, reserved: 0, blocked: 0, available: 0, min_stock: Number(item.min_stock || 0), max_stock: Number(item.max_stock || 0), reorder_point: Number(item.reorder_point || 0), status: \'none\' });\n}\n});\n// ===== END FIX-INV-3 =====\n';
    s = s.slice(0, i) + block + s.slice(i);
    fs.writeFileSync('server.js', s, 'utf8');
    console.log('server: FIX-INV-3 applied');
  }
}
// ---------- index.html ----------
let h = fs.readFileSync('public/index.html', 'utf8');
if (h.indexOf('FIX-INV-3') !== -1) { console.log('client: already patched'); }
else {
  const j = h.lastIndexOf('</script>');
  if (j === -1) { console.log('client: </script> NOT FOUND'); }
  else {
    const block = '\n// ===== FIX-INV-3 (Phase 1.5 / Option B) =====\nfunction invWarehouseLabel(code){if(!code)return \'\u2014\';var map={raw:\'\u0645\u0648\u0627\u062f \u062e\u0627\u0645\',product:\'\u0645\u062d\u0635\u0648\u0644\',spare:\'\u0642\u0637\u0639\u0627\u062a \u06cc\u062f\u06a9\u06cc\',quarantine:\'\u0642\u0631\u0646\u0637\u06cc\u0646\u0647\'};return map[String(code)]||String(code);}\nfunction inv2Chip(r){if(r.status===\'none\')return \'<span class="chip" style="background:#e2e8f0;color:#475569">\u0628\u062f\u0648\u0646 \u0645\u0648\u062c\u0648\u062f\u06cc</span>\';if((Number(r.available)||0)<(Number(r.min_stock)||0))return \'<span class="chip crit">\u0628\u062d\u0631\u0627\u0646\u06cc</span>\';if(r.status===\'warn\')return \'<span class="chip wait">\u0646\u0632\u062f\u06cc\u06a9 \u0646\u0642\u0637\u0647 \u0633\u0641\u0627\u0631\u0634</span>\';if(r.status===\'low\')return \'<span class="chip no">\u06a9\u0645\u0628\u0648\u062f \u0645\u0648\u062c\u0648\u062f\u06cc</span>\';return \'<span class="chip ok">\u0645\u0648\u062c\u0648\u062f\u06cc \u06a9\u0627\u0641\u06cc</span>\';}\n// ===== END FIX-INV-3 =====\n';
    h = h.slice(0, j) + block + h.slice(j);
    fs.writeFileSync('public/index.html', h, 'utf8');
    console.log('client: FIX-INV-3 applied');
  }
}
// ---------- syntax checks ----------
try { new vm.Script(fs.readFileSync('server.js', 'utf8')); console.log('server syntax OK'); } catch (e) { console.log('server SYNTAX ERROR: ' + e.message); }
const hh = fs.readFileSync('public/index.html', 'utf8');
const a = hh.lastIndexOf('<script>'); const b = hh.lastIndexOf('</script>');
try { new vm.Script(hh.slice(a + 8, b)); console.log('client syntax OK'); } catch (e) { console.log('client SYNTAX ERROR: ' + e.message); }
'@
node fix_vis.js