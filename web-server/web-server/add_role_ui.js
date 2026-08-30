const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
if (h.indexOf('function applyRoleUI') !== -1) {
  console.log('applyRoleUI already exists - no change made');
  process.exit(0);
}
const idx = h.lastIndexOf('</script>');
if (idx === -1) { console.log('ERROR: script end not found'); process.exit(1); }
const block = [
"",
"function applyRoleUI() {",
"  fetch('/api/auth/me', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {",
"    var role = (j && j.ok && j.user) ? String(j.user.role || 'viewer') : 'viewer';",
"    var admin = (role === 'admin');",
"    function show(ids, ok) { ids.forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = (admin || ok) ? '' : 'none'; }); }",
"    show(['btnAddInventoryItem','btnInventoryReceipt','btnInventoryIssue','btnInventoryTransfer','btnInventoryAdjust'], role === 'warehouse');",
"    show(['btnAddProduction','btnAddWaste'], role === 'operator');",
"    show(['btnAddDowntime'], role === 'operator' || role === 'engineering');",
"    show(['btnAddQuality'], role === 'quality' || role === 'qc');",
"    show(['btnAddMaintenance','btnAddPlan'], role === 'engineering' || role === 'supervisor');",
"  }).catch(function () {});",
"}",
"applyRoleUI();",
""
].join('\n');
h = h.slice(0, idx) + block + h.slice(idx);
fs.writeFileSync(p, h, 'utf8');
console.log('OK: applyRoleUI appended - buttons will show per role');
