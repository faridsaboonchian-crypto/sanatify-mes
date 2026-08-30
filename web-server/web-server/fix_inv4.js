const fs = require('fs');
const vm = require('vm');
let h = fs.readFileSync('public/index.html', 'utf8');
let changed = false;
if (h.indexOf('FIX-INV-3 ') === -1 && h.indexOf('FIX-INV-3\n') === -1 && h.indexOf('===== FIX-INV-3 =') === -1) {
  const j = h.lastIndexOf('</script>');
  const block = "\n// ===== FIX-INV-3 =====\nfunction invFillFormSelects(){var items=(typeof inventoryData!=='undefined'&&inventoryData&&inventoryData.items)?inventoryData.items:[];var itemOpts='<option value=\"\">انتخاب کالا (کد — نام)...</option>';items.forEach(function(it){itemOpts+='<option value=\"'+it.id+'\">'+(it.code||'')+' — '+(it.name||'')+'</option>';});['irItem','iiItem','itItem','iaItem'].forEach(function(id){var el=document.getElementById(id);if(el){var prev=el.value;el.innerHTML=itemOpts;if(prev)el.value=prev;}});var whOpts='<option value=\"\">انتخاب انبار...</option>';Object.keys(INV_WAREHOUSES).forEach(function(k){whOpts+='<option value=\"'+k+'\">'+INV_WAREHOUSES[k]+'</option>';});['irWarehouse','iiWarehouse','itFromWarehouse','itToWarehouse','iaWarehouse'].forEach(function(id){var el=document.getElementById(id);if(el){var prev=el.value;el.innerHTML=whOpts;if(prev)el.value=prev;}});}\n['btnAddInventoryItem','btnInventoryReceipt','btnInventoryIssue','btnInventoryTransfer','btnInventoryAdjust'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener('click',invFillFormSelects);});\ninvFillFormSelects();\n// ===== END FIX-INV-3 =====\n";
  h = h.slice(0, j) + block + h.slice(j);
  changed = true;
  console.log('client: FIX-INV-3 applied');
}
if (h.indexOf('FIX-INV-3B') === -1) {
  const j = h.lastIndexOf('</script>');
  const block2 = "\n// ===== FIX-INV-3B =====\nfunction invWarehouseLabel(code){if(!code)return '—';var map={raw:'مواد خام',product:'محصول',spare:'قطعات یدکی',quarantine:'قرنطینه'};return map[String(code)]||String(code);}\nfunction inv2Chip(r){if(r.status==='none')return '<span class=\"chip\" style=\"background:#e2e8f0;color:#475569\">بدون موجودی</span>';if((Number(r.available)||0)<(Number(r.min_stock)||0))return '<span class=\"chip crit\">بحرانی</span>';if(r.status==='warn')return '<span class=\"chip wait\">نزدیک نقطه سفارش</span>';if(r.status==='low')return '<span class=\"chip no\">کمبود موجودی</span>';return '<span class=\"chip ok\">موجودی کافی</span>';}\n// ===== END FIX-INV-3B =====\n";
  h = h.slice(0, j) + block2 + h.slice(j);
  changed = true;
  console.log('client: FIX-INV-3B applied');
}
if (changed) fs.writeFileSync('public/index.html', h, 'utf8');
let s = fs.readFileSync('server.js', 'utf8');
if (s.indexOf('FIX-INV-3S') === -1) {
  const anchor = 'const totalAvailable = stock.filter';
  const i = s.indexOf(anchor);
  if (i !== -1) {
    const blockS = "// ===== FIX-INV-3S (Phase 1.5 / Option B) =====\nitems.forEach(function(item){var has=false;for(var v=0;v<stockview.length;v++){if(stockview[v].item_id===item.id){has=true;break;}}if(!has)stockview.push({item_id:item.id,code:item.code,name:item.name,category:item.category,unit:item.unit,warehouse:'',physical:0,reserved:0,blocked:0,available:0,min_stock:Number(item.min_stock||0),max_stock:Number(item.max_stock||0),reorder_point:Number(item.reorder_point||0),status:'none'});});\n// ===== END FIX-INV-3S =====\n";
    s = s.slice(0, i) + blockS + s.slice(i);
    fs.writeFileSync('server.js', s, 'utf8');
    console.log('server: FIX-INV-3S applied');
  } else { console.log('server: anchor NOT found'); }
} else { console.log('server: already patched'); }
try { new vm.Script(fs.readFileSync('server.js', 'utf8')); console.log('server syntax OK'); } catch (e) { console.log('server SYNTAX ERROR: ' + e.message); }
const hh = fs.readFileSync('public/index.html', 'utf8');
const a = hh.lastIndexOf('<script>'); const b = hh.lastIndexOf('</script>');
try { new vm.Script(hh.slice(a + 8, b)); console.log('client syntax OK'); } catch (e) { console.log('client SYNTAX ERROR: ' + e.message); }