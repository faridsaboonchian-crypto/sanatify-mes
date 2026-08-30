const fs = require('fs');
let h = fs.readFileSync('public/index.html', 'utf8');
const stub = "function applyRoleUI() { /* stub */ }";
const full = "function applyRoleUI() {\n" +
"  fetch('/api/auth/me', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {\n" +
"    var role = (j && j.ok && j.user) ? (j.user.role || 'viewer') : 'viewer';\n" +
"    WEB_USER = (j && j.ok && j.user) ? j.user : null;\n" +
"    var isInv = (role === 'admin' || role === 'warehouse');\n" +
"    ['btnAddInventoryItem','btnInventoryReceipt','btnInventoryIssue','btnInventoryTransfer','btnInventoryAdjust'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = isInv ? '' : 'none'; });\n" +
"    var isEng = (role === 'admin' || role === 'engineering' || role === 'supervisor');\n" +
"    ['btnAddMaintenance','btnAddPlan'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = isEng ? '' : 'none'; });\n" +
"    var isOp = (role === 'admin' || role === 'operator' || role === 'supervisor' || role === 'quality' || role === 'qc');\n" +
"    ['btnAddProduction','btnAddWaste','btnAddDowntime','btnAddQuality'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = isOp ? '' : 'none'; });\n" +
"  }).catch(function () {});\n" +
"}\napplyRoleUI();";
if (h.includes(stub)) {
  h = h.split(stub).join(full);
  fs.writeFileSync('public/index.html', h, 'utf8');
  console.log('OK: applyRoleUI upgraded');
} else {
  console.log('stub not found (already upgraded?)');
}
