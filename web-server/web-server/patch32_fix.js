const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SP = path.join(__dirname, 'server.js');
const HP = path.join(__dirname, 'public', 'index.html');
let s = fs.readFileSync(SP, 'utf8');
let h = fs.readFileSync(HP, 'utf8');
const log = [];
let ok = true;

// Backup قبل از تغییر
fs.writeFileSync(SP + '.bak_p32', s);
fs.writeFileSync(HP + '.bak_p32', h);

function replaceAll(src, oldStr, newStr, name) {
    if (src.includes(newStr)) { log.push(name + ': already'); return src; }
    if (!src.includes(oldStr)) { log.push(name + ': ANCHOR MISSING'); ok = false; return src; }
    const count = src.split(oldStr).length - 1;
    log.push(name + ': replaced ' + count + ' occurrences');
    return src.split(oldStr).join(newStr);
}

function replaceFirst(src, oldStr, newStr, name) {
    if (src.includes(newStr)) { log.push(name + ': already'); return src; }
    const idx = src.indexOf(oldStr);
    if (idx === -1) { log.push(name + ': ANCHOR MISSING'); ok = false; return src; }
    log.push(name + ': replaced at position ' + idx);
    return src.slice(0, idx) + newStr + src.slice(idx + oldStr.length);
}

// ====================================================================
// SERVER: S1 - اضافه کردن heat_number به production (همه occurrenceها)
// ====================================================================
const OLD_PROD = `machine_id: String(b.machine_id || 'st-pack').trim(),
description: String(b.description || '').slice(0, 500),
source: 'manual',
timestamp: new Date().toISOString(),`;
const NEW_PROD = `machine_id: String(b.machine_id || 'st-pack').trim(),
heat_number: String(b.heat_number || '').trim(),
description: String(b.description || '').slice(0, 500),
source: 'manual',
timestamp: new Date().toISOString(),`;
s = replaceAll(s, OLD_PROD, NEW_PROD, 'S1-production-heat');

// ====================================================================
// SERVER: S2 - توسعه buildGenealogy برای نمایش production_logs و consumed_materials
// ====================================================================
const OLD_GENE = `return { heat_number: h, billets: (d.billets || []).filter((x) => String(x.heat_number) === h), furnace_logs: (d.furnace_logs || []).filter((x) => String(x.heat_number) === h), rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h) };`;
const NEW_GENE = `return { heat_number: h, billets: (d.billets || []).filter((x) => String(x.heat_number) === h), furnace_logs: (d.furnace_logs || []).filter((x) => String(x.heat_number) === h), rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h), production_logs: (d.production_logs || []).filter((x) => h !== '' && String(x.heat_number || '') === h), consumed_materials: (d.inventory_issues || []).filter((x) => h !== '' && (String(x.heat_number || '') === h || String(x.work_order || '') === h || String(x.destination_ref || '') === h)) };`;
s = replaceAll(s, OLD_GENE, NEW_GENE, 'S2-genealogy-extended');

// ====================================================================
// SERVER: S3 - اضافه کردن heat_number به GIN در consume endpoint
// ====================================================================
const OLD_CONS = `destination: String(b.destination || rec.reason || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };`;
const NEW_CONS = `destination: String(b.destination || rec.reason || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), production_id: String(b.production_id || '').trim(), heat_number: String(b.heat_number || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };`;
s = replaceAll(s, OLD_CONS, NEW_CONS, 'S3-consume-gin-link');

// ====================================================================
// SERVER: S4 - اضافه کردن heat_number به reservation_log در consume
// ====================================================================
const OLD_LOG = `live.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف رزرو'), timestamp: new Date().toISOString() });`;
const NEW_LOG = `live.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف رزرو'), production_id: String(b.production_id || '').trim(), heat_number: String(b.heat_number || '').trim(), timestamp: new Date().toISOString() });`;
s = replaceAll(s, OLD_LOG, NEW_LOG, 'S4-consume-log-link');

// ====================================================================
// CLIENT: H1 - اضافه کردن input heat number به فرم تولید
// ====================================================================
const OLD_FORM = `<input type="number" id="fpPallets" min="0" placeholder="تعداد پالت (اختیاری)"
style="width:160px" />
</div>
<div class="frow" style="margin-top:8px">
<span class="flbl">ایستگاه نهایی: <b>تست و بسته‌بندی (دروازهٔ پایان خط)</b></span>`;
const NEW_FORM = `<input type="number" id="fpPallets" min="0" placeholder="تعداد پالت (اختیاری)"
style="width:160px" />
<input type="text" id="fpHeat" placeholder="کد بچ / Heat Number (اختیاری)" style="flex:1 1 180px" />
</div>
<div class="frow" style="margin-top:8px">
<span class="flbl">ایستگاه نهایی: <b>تست و بسته‌بندی (دروازهٔ پایان خط)</b></span>`;
h = replaceFirst(h, OLD_FORM, NEW_FORM, 'H1-prod-heat-input');

// ====================================================================
// CLIENT: H2 - ارسال heat_number در body تولید
// ====================================================================
const OLD_BODY = `const body = { operator_id: WEB_USER ? (WEB_USER.username || WEB_USER.name || '') : '', product_id: document.getElementById('fpProduct').value, shift_id: document.getElementById('fpShift').value, good_quantity: Number(document.getElementById('fpQty').value), pallet_count: Number(document.getElementById('fpPallets').value) || 0, machine_id: 'st-pack', description: document.getElementById('fpDesc').value.trim() };`;
const NEW_BODY = `const body = { operator_id: WEB_USER ? (WEB_USER.username || WEB_USER.name || '') : '', product_id: document.getElementById('fpProduct').value, shift_id: document.getElementById('fpShift').value, good_quantity: Number(document.getElementById('fpQty').value), pallet_count: Number(document.getElementById('fpPallets').value) || 0, machine_id: 'st-pack', heat_number: document.getElementById('fpHeat').value.trim(), description: document.getElementById('fpDesc').value.trim() };`;
h = replaceAll(h, OLD_BODY, NEW_BODY, 'H2-prod-send-heat');

// ====================================================================
// CLIENT: H3 - پاک کردن input heat بعد از ثبت موفق
// ====================================================================
const OLD_CLEAR = `['fpQty', 'fpPallets', 'fpDesc'].forEach((id) => { document.getElementById(id).value = ''; });`;
const NEW_CLEAR = `['fpQty', 'fpPallets', 'fpDesc', 'fpHeat'].forEach((id) => { document.getElementById(id).value = ''; });`;
h = replaceAll(h, OLD_CLEAR, NEW_CLEAR, 'H3-prod-clear-heat');

// ====================================================================
// CLIENT: H4 - اضافه کردن prompt heat در consume handler
// ====================================================================
const OLD_PROMPT = `var ref = prompt('ارجاع تولید / دستور کار (اختیاری):', '');
if (ref === null) ref = '';
if (!confirm('مصرف ' + qty + ' از رزرو انجام شود؟')) return;`;
const NEW_PROMPT = `var ref = prompt('ارجاع تولید / دستور کار (اختیاری):', '');
if (ref === null) ref = '';
var heat = prompt('کد بچ / Heat Number برای این مصرف (اختیاری):', '');
if (heat === null) heat = '';
if (!confirm('مصرف ' + qty + ' از رزرو انجام شود؟')) return;`;
h = replaceFirst(h, OLD_PROMPT, NEW_PROMPT, 'H4-consume-heat-prompt');

// ====================================================================
// CLIENT: H5 - ارسال heat_number در fetch consume
// ====================================================================
const OLD_FETCH = `body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: ref, destination_ref: ref, description: ref, request_id: invNewRequestId('web-consume') }) })`;
const NEW_FETCH = `body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: ref, destination_ref: ref, heat_number: heat, description: ref, request_id: invNewRequestId('web-consume') }) })`;
h = replaceFirst(h, OLD_FETCH, NEW_FETCH, 'H5-consume-send-heat');

// ====================================================================
// CLIENT: H6 - نمایش مواد مصرف‌شده در Genealogy
// ====================================================================
const OLD_GENE_UI = `html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);
box.innerHTML = html;`;
const NEW_GENE_UI = `html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);
if (g.production_logs && g.production_logs.length > 0) {
html += '<h3 style="margin:14px 0 6px">تولید این بچ (' + fa(g.production_logs.length) + ')</h3>';
html += buildMiniTable(g.production_logs, [{ label: 'ثبت‌کننده', key: 'operator_id' }, { label: 'محصول', key: 'product_id' }, { label: 'شیفت', key: 'shift_id' }, { label: 'تعداد سالم', key: 'good_quantity', f: groupFa }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);
}
if (g.consumed_materials && g.consumed_materials.length > 0) {
html += '<h3 style="margin:14px 0 6px">مواد مصرف‌شده برای این بچ (' + fa(g.consumed_materials.length) + ')</h3>';
html += buildMiniTable(g.consumed_materials, [{ label: 'کالا', key: 'item_id', f: invItemName }, { label: 'مقدار', key: 'quantity', f: groupFa }, { label: 'سند خروج', key: 'issue_no' }, { label: 'انبار', key: 'warehouse', f: function(v) { return INV_WAREHOUSES[v] || v || '-'; } }, { label: 'مرجع تولید', key: 'work_order' }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);
}
box.innerHTML = html;`;
h = replaceFirst(h, OLD_GENE_UI, NEW_GENE_UI, 'H6-genealogy-sections');

// ====================================================================
// اعتبارسنجی سینتکس
// ====================================================================
if (!ok) {
    console.log(log.join('\n'));
    console.log('❌ ABORT: هیچ فایلی نوشته نشد. Anchor های گمشده را بررسی کنید.');
    process.exit(1);
}
try { new vm.Script(s); log.push('✅ server.js syntax OK'); } catch (e) { console.log('❌ server.js syntax ERROR: ' + e.message); process.exit(1); }
const i = h.lastIndexOf('<script>'); const j = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(i + 8, j)); log.push('✅ index.html syntax OK'); } catch (e) { console.log('❌ index.html syntax ERROR: ' + e.message); process.exit(1); }

// ذخیره تغییرات
fs.writeFileSync(SP, s, 'utf8');
fs.writeFileSync(HP, h, 'utf8');
console.log(log.join('\n'));
console.log('\n✅✅✅ PHASE 3.2 PATCHED + SAVED ✅✅✅');