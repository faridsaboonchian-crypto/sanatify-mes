const fs = require('fs');
const vm = require('vm');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
const log = [];
if (/\n\}\}\}\s*<\/script>/.test(h)) {
  h = h.replace(/\n\}\}\}\s*(<\/script>)/, '\n$1');
  log.push('}}} حذف شد');
}
if (h.indexOf('function invNewRequestId') === -1) {
  const j = h.lastIndexOf('</script>');
  const b = '\n// ===== FIX-INV-1 =====\n' +
    'function invNewRequestId(x){return (x||"web")+"-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);}\n' +
    'function invMsg(id,t,ok){var el=document.getElementById(id);if(!el)return;el.textContent=t||"";el.style.color=ok?"#059669":"#dc2626";}\n' +
    'function invItem(id){var it=((inventoryData&&inventoryData.items)||[]).find(function(x){return String(x.id)===String(id);});return it||null;}\n' +
    'var INV_WAREHOUSES={raw:"مواد خام",product:"محصول",spare:"قطعات یدکی",quarantine:"قرنطینه"};\n' +
    'var INV_STATUS_FA={available:"قابل مصرف",quarantine:"قرنطینه",rejected:"مردود"};\n' +
    'var INV_TX_FA={receipt:"رسید",issue:"حواله",transfer:"انتقال",adjustment:"اصلاح"};\n' +
    'var WORKTYPE_FA={breakdown:"تعمیر خرابی اضطراری",repair:"تعمیر برنامه‌ریزی‌شده",pm:"PM پیشگیرانه"};\n' +
    'var PRIORITY_FA={low:"کم",medium:"متوسط",high:"بالا",critical:"بحرانی"};\n' +
    'var lastGenealogy=null,lastBalance=null;\n' +
    'function downloadCsv(csfn,headers,rows,title){var DQ=String.fromCharCode(34);var q=function(v){return DQ+String(v==null?"":v).replace(/"/g,DQ+DQ)+DQ;};var L=[];if(title){L.push(q(title));L.push("");}L.push((headers||[]).map(function(x){return q(x.label);}).join(","));(rows||[]).forEach(function(r){L.push((headers||[]).map(function(x){return q(r[x.key]);}).join(","));});var csv=String.fromCharCode(65279)+L.join(String.fromCharCode(13,10));var bl=new Blob([csv],{type:"text/csv;charset=utf-8;"});var u=URL.createObjectURL(bl);var a=document.createElement("a");a.href=u;a.download=(csfn||"export")+".csv";document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(u);},1500);}\n' +
    'function pmStatus(pl){try{var last=jalaliToDate(pl.last_done||"");if(!last)return{next:"-",days:9999};var nx=new Date(last.getTime()+(Number(pl.interval_days)||0)*86400000);return{next:nx.toLocaleDateString("fa-IR"),days:Math.round((nx.getTime()-Date.now())/86400000)};}catch(e){return{next:"-",days:9999};}}\n' +
    'function maintenanceLogsInRange(){return cache.mntLogs||[];}\n' +
    '// ===== END FIX-INV-1 =====\n';
  h = h.slice(0, j) + b + h.slice(j);
  log.push('FIX-INV-1 اضافه شد');
}
if (h.indexOf('FIX-INV-4') === -1) {
  const j = h.lastIndexOf('</script>');
  const b = '\n// ===== FIX-INV-4 =====\n' +
    'function invFillFormSelects(){var items=(typeof inventoryData!=="undefined"&&inventoryData&&inventoryData.items)?inventoryData.items:[];var io=\'<option value="">انتخاب کالا…</option>\';items.forEach(function(it){io+=\'<option value="\'+String(it.id)+\'">\'+(it.code||\'\')+\' — \'+(it.name||\'\')+\'</option>\';});[\'irItem\',\'iiItem\',\'itItem\',\'iaItem\'].forEach(function(id){var el=document.getElementById(id);if(!el)return;var pv=el.value;el.innerHTML=io;if(pv){for(var i2=0;i2<el.options.length;i2++){if(el.options[i2].value===pv){el.value=pv;break;}}}});var WH=(typeof INV_WAREHOUSES!=="undefined")?INV_WAREHOUSES:{raw:"مواد خام",product:"محصول",spare:"قطعات یدکی",quarantine:"قرنطینه"};var wo=\'<option value="">انتخاب انبار…</option>\';Object.keys(WH).forEach(function(k){wo+=\'<option value="\'+k+\'">\'+WH[k]+\'</option>\';});[\'irWarehouse\',\'iiWarehouse\',\'itFromWarehouse\',\'itToWarehouse\',\'iaWarehouse\'].forEach(function(id){var el=document.getElementById(id);if(!el)return;var pv=el.value;el.innerHTML=wo;if(pv){for(var i3=0;i3<el.options.length;i3++){if(el.options[i3].value===pv){el.value=pv;break;}}}});}\n' +
    '[\'btnInventoryReceipt\',\'btnInventoryIssue\',\'btnInventoryTransfer\',\'btnInventoryAdjust\'].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener(\'click\',invFillFormSelects);});\n' +
    'if(typeof loaders!=="undefined"&&loaders.warehouse){var __oli=loaders.warehouse;loaders.warehouse=function(){var r=__oli.apply(this,arguments);if(r&&r.then){r.then(function(){invFillFormSelects();});}else{invFillFormSelects();}return r;};}\n' +
    'invFillFormSelects();\n' +
    '// ===== END FIX-INV-4 =====\n';
  h = h.slice(0, j) + b + h.slice(j);
  log.push('FIX-INV-4 اضافه شد');
}
fs.writeFileSync(p, h, 'utf8');
console.log(log.join(' | ') || 'تغییری لازم نبود');
const a = h.lastIndexOf('<script>');
const b2 = h.lastIndexOf('</script>');
try { new vm.Script(h.slice(a + 8, b2)); console.log('سینتکس: سالم'); }
catch (e) { console.log('خطای سینتکس: ' + e.message); }