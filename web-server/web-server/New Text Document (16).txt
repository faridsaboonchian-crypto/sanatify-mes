const fs = require('fs');
const p = 'public/index.html';
let h = fs.readFileSync(p, 'utf8');
if (h.indexOf('FIX-INV-1') !== -1) {
  console.log('already applied');
  process.exit(0);
}
const i = h.lastIndexOf('</script>');
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
  'function maintenanceLogsInRange(){return cache.mntLogs||[];}\n';
h = h.slice(0, i) + b + h.slice(i);
fs.writeFileSync(p, h, 'utf8');
console.log('OK: fix_inv applied');