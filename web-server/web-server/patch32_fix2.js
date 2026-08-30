const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SP = path.join(__dirname, 'server.js');
const HP = path.join(__dirname, 'public', 'index.html');
let s = fs.readFileSync(SP, 'utf8');
let h = fs.readFileSync(HP, 'utf8');
const log = [];
let ok = true;

fs.writeFileSync(SP + '.bak_p32_2', s);
fs.writeFileSync(HP + '.bak_p32_2', h);

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
// SERVER: S3 - اضافه کردن heat_number به GIN در consume endpoint
// ====================================================================
const OLD_CONS = `destination: String(b.destination || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };`;
const NEW_CONS = `destination: String(b.destination || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), heat_number: String(b.heat_number || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };`;
s = replaceAll(s, OLD_CONS, NEW_CONS, 'S3-consume-gin-link');

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
// CLIENT: H6 - نمایش مواد مصرف‌شده در Genealogy
// ====================================================================
const OLD_GENE_UI = `html += '<h3 style="margin:14px 0 6px">بشکه‌های خروجی (' + fa(g.rebar_bundles.length) + ')</h3>';
html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);
box.innerHTML = html;`;
const NEW_GENE_UI = `html += '<h3 style="margin:14px 0 6px">بشکه‌های خروجی (' + fa(g.rebar_bundles.length) + ')</h3>';
html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);
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

fs.writeFileSync(SP, s, 'utf8');
fs.writeFileSync(HP, h, 'utf8');
console.log(log.join('\n'));
console.log('\n✅✅✅ PHASE 3.2 PATCHED + SAVED ✅✅✅');