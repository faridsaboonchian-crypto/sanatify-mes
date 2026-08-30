const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// 1) حذف }}} اضافی در انتهای فایل
html = html.replace(/\}\}\}\s*<\/script>/g, '}</script>');
console.log('✅ Removed extra }}}');

// 2) اضافه کردن توابع گمشده (stub versions)
const missingFunctions = `
async function loadSummary() {
  const s = await getJson('/api/summary');
  cache.summary = s;
  document.getElementById('kpiBox').innerHTML = [
    { l: 'تولید سالم', v: groupFa(s.production_good_quantity), c: 'green' },
    { l: 'ضایعات', v: groupFa(s.waste_quantity), c: 'red' },
    { l: 'توقف (دقیقه)', v: groupFa(s.downtime_minutes), c: 'amber' },
    { l: 'راندمان ٪', v: fa(s.yield_rate_percent), c: s.yield_rate_percent >= 96 ? 'green' : 'amber' }
  ].map(k => '<div class="kpi ' + k.c + '"><div class="v">' + k.v + '</div><div class="l">' + esc(k.l) + '</div></div>').join('');
}

async function loadAnalytics() { console.log('Analytics tab - not implemented yet'); }
async function loadProduction() { console.log('Production tab - not implemented yet'); }
async function loadWaste() { console.log('Waste tab - not implemented yet'); }
async function loadDowntime() { console.log('Downtime tab - not implemented yet'); }
async function loadQuality() { console.log('Quality tab - not implemented yet'); }
async function loadMaintenance() { console.log('Maintenance tab - not implemented yet'); }
async function loadGenealogy() { console.log('Genealogy - not implemented yet'); }
async function loadBalance() { console.log('Balance - not implemented yet'); }

function invNewRequestId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

const INV_WAREHOUSES = { raw: 'مواد اولیه', product: 'محصول', spare: 'قطعات', quarantine: 'قرنطینه' };
const INV_STATUS_FA = { available: 'قابل مصرف', quarantine: 'قرنطینه', rejected: 'مردود' };
const INV_TX_FA = { receipt: 'رسید', issue: 'حواله', transfer: 'انتقال', adjustment: 'اصلاح' };
const WORKTYPE_FA = { breakdown: 'خرابی اضطراری', repair: 'تعمیر', pm: 'PM' };
const PRIORITY_FA = { low: 'کم', medium: 'متوسط', high: 'بالا', critical: 'بحرانی' };
const MAINTENANCE_FA = {};

function applyRoleUI() { /* stub */ }
function maintenanceLogsInRange() { return []; }
function pmStatus(p) { return { next: '-', days: 0 }; }
function exportList(k, filename, title, cols) { /* stub */ }
function downloadCsv(filename, headers, rows, title) {
  const lines = [];
  if (title) { lines.push(title); lines.push(''); }
  lines.push(headers.map(h => h.label).join(','));
  rows.forEach(row => {
    lines.push(headers.map(h => row[h.key] || '').join(','));
  });
  const csv = '\\uFEFF' + lines.join('\\r\\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function invItem(itemId) {
  const item = (inventoryData?.items || []).find(x => String(x.id) === String(itemId));
  return item || null;
}

`;

// اضافه کردن توابع قبل از </script>
const scriptEnd = html.lastIndexOf('</script>');
html = html.slice(0, scriptEnd) + missingFunctions + html.slice(scriptEnd);

fs.writeFileSync('public/index.html', html, 'utf8');
console.log('✅ Added missing functions');
console.log('✅ File saved successfully');