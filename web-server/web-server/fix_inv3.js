const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
if (h.indexOf('FIX-INV-3') !== -1) { console.log('already applied'); process.exit(0); }
const j = h.lastIndexOf('</script>');
if (j === -1) { console.log('ERROR: </script> NOT FOUND'); process.exit(1); }
const block = `
// ===== FIX-INV-3 (پر شدن select های فرم های انبار) =====
function invFillFormSelects(){
  var items = (typeof inventoryData !== 'undefined' && inventoryData && inventoryData.items) ? inventoryData.items : [];
  var itemOpts = '<option value="">انتخاب کالا (کد — نام)...</option>';
  items.forEach(function(it){ itemOpts += '<option value="' + it.id + '">' + (it.code || '') + ' — ' + (it.name || '') + '</option>'; });
  ['irItem','iiItem','itItem','iaItem'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) { var prev = el.value; el.innerHTML = itemOpts; if (prev) el.value = prev; }
  });
  var whOpts = '<option value="">انتخاب انبار...</option>';
  Object.keys(INV_WAREHOUSES).forEach(function(k){ whOpts += '<option value="' + k + '">' + INV_WAREHOUSES[k] + '</option>'; });
  ['irWarehouse','iiWarehouse','itFromWarehouse','itToWarehouse','iaWarehouse'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) { var prev = el.value; el.innerHTML = whOpts; if (prev) el.value = prev; }
  });
}
['btnAddInventoryReceipt','btnAddInventoryIssue','btnAddInventoryTransfer','btnAddInventoryAdjust','btnAddInventoryItem'].forEach(function(id){
  var el = document.getElementById(id);
  if (el) el.addEventListener('click', invFillFormSelects);
});
invFillFormSelects();
// ===== END FIX-INV-3 =====
`;
h = h.slice(0, j) + block + h.slice(j);
fs.writeFileSync(p, h, 'utf8');
console.log('OK: FIX-INV-3 applied');