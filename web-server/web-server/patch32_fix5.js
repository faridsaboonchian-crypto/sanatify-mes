const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SP = path.join(__dirname, 'server.js');
const HP = path.join(__dirname, 'public', 'index.html');
let s = fs.readFileSync(SP, 'utf8');
let h = fs.readFileSync(HP, 'utf8');
const log = [];
fs.writeFileSync(SP + '.bak_p32f5', s);
fs.writeFileSync(HP + '.bak_p32f5', h);

// S2: سرور — ردیابی حالا تولید و مصرف را هم برمی‌گرداند
const OLD_G = "rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h) };";
const NEW_G = "rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h), production_logs: (d.production_logs || []).filter((x) => String(x.heat_number || '') === h), consumed_materials: (d.inventory_issues || []).filter((x) => String(x.heat_number || '') === h || String(x.work_order || '') === h || String(x.destination_ref || '') === h) };";
if (s.includes('consumed_materials: (d.inventory_issues')) log.push('S2-genealogy: already');
else if (s.includes(OLD_G)) { s = s.split(OLD_G).join(NEW_G); log.push('S2-genealogy: replaced'); }
else log.push('S2-genealogy: ANCHOR MISSING');

// H2: فرم تولید — کد بچ واقعاً ارسال شود
const OLD_F = "machine_id: 'st-pack', description: document.getElementById('fpDesc').value.trim() };";
const NEW_F = "machine_id: 'st-pack', heat_number: document.getElementById('fpHeat').value.trim(), description: document.getElementById('fpDesc').value.trim() };";
if (h.includes("heat_number: document.getElementById('fpHeat')")) log.push('H2-fpsave-heat: already');
else if (h.includes(OLD_F)) { h = h.split(OLD_F).join(NEW_F); log.push('H2-fpsave-heat: replaced'); }
else log.push('H2-fpsave-heat: ANCHOR MISSING');

let okS = true, okH = true;
try { new vm.Script(s); log.push('server.js syntax OK'); } catch (e) { okS = false; log.push('server.js syntax ERROR: ' + e.message); }
const i = h.lastIndexOf('<script>'); const j = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(i + 8, j)); log.push('index.html syntax OK'); } catch (e) { okH = false; log.push('index.html syntax ERROR: ' + e.message); }
if (okS) fs.writeFileSync(SP, s, 'utf8'); else log.push('server.js NOT saved');
if (okH) fs.writeFileSync(HP, h, 'utf8'); else log.push('index.html NOT saved');
console.log(log.join('\n'));
console.log(okS && okH ? '✅ PHASE 3.2 LINK PATCHED + SAVED' : '❌ CHECK ERRORS');