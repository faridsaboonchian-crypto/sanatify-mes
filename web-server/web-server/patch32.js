const fs = require('fs');
const path = require('path');
const vm = require('vm');
const base = process.cwd();
const SP = path.join(base, 'server.js');
const HP = path.join(base, 'public', 'index.html');
let s = fs.readFileSync(SP, 'utf8').replace(/\r\n/g, '\n');
let h = fs.readFileSync(HP, 'utf8').replace(/\r\n/g, '\n');
const log = [];
function rep(src, oldStr, newStr, name) {
    if (src.includes(newStr)) { log.push(name + ': already'); return src; }
    if (!src.includes(oldStr)) { log.push(name + ': ANCHOR MISSING'); throw new Error('ANCHOR MISSING: ' + name); }
    log.push(name + ': applied');
    return src.split(oldStr).join(newStr);
}
try {
    // ===== SERVER =====
    s = rep(s,
        "machine_id: String(b.machine_id || 'st-pack').trim(),\ndescription: String(b.description || '').slice(0, 500),\nsource: 'manual',",
        "machine_id: String(b.machine_id || 'st-pack').trim(),\nheat_number: String(b.heat_number || '').trim(),\nbatch_number: String(b.batch_number || '').trim(),\ndescription: String(b.description || '').slice(0, 500),\nsource: 'manual',",
        'S1-production-optional-heat');
    s = rep(s,
        "destination: String(b.destination || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };",
        "destination: String(b.destination || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || b.production_id || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), production_id: String(b.production_id || '').trim(), heat_number: String(b.heat_number || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };",
        'S2-consume-gin-link');
    s = rep(s,
        "live.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف رزرو'), timestamp: new Date().toISOString() });",
        "live.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف رزرو'), production_id: String(b.production_id || '').trim(), heat_number: String(b.heat_number || '').trim(), timestamp: new Date().toISOString() });",
        'S3-consume-log-link');
    s = rep(s,
        "return { heat_number: h, billets: (d.billets || []).filter((x) => String(x.heat_number) === h), furnace_logs: (d.furnace_logs || []).filter((x) => String(x.heat_number) === h), rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h) };",
        "return { heat_number: h, billets: (d.billets || []).filter((x) => String(x.heat_number) === h), furnace_logs: (d.furnace_logs || []).filter((x) => String(x.heat_number) === h), rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h), production_logs: (d.production_logs || []).filter((x) => h !== '' && String(x.heat_number || '') === h), consumed_materials: (d.inventory_issues || []).filter((x) => h !== '' && (String(x.heat_number || '') === h || String(x.work_order || '') === h || String(x.destination_ref || '') === h)) };",
        'S4-genealogy-links');
    // ===== CLIENT =====
    h = rep(h,
        '<input type="number" id="fpPallets" min="0" placeholder="تعداد پالت (اختیاری)"\nstyle="width:160px" />',
        '<input type="number" id="fpPallets" min="0" placeholder="تعداد پالت (اختیاری)"\nstyle="width:160px" />\n<input type="text" id="fpHeat" placeholder="کد بچ/کویل (Heat Number — اختیاری)" style="flex:1 1 160px" />',
        'H1-prod-heat-input');
    h = rep(h,
        "pallet_count: Number(document.getElementById('fpPallets').value) || 0, machine_id: 'st-pack', description: document.getElementById('fpDesc').value.trim() };",
        "pallet_count: Number(document.getElementById('fpPallets').value) || 0, machine_id: 'st-pack', heat_number: document.getElementById('fpHeat').value.trim(), description: document.getElementById('fpDesc').value.trim() };",
        'H2-prod-send-heat');
    h = rep(h,
        "['fpQty', 'fpPallets', 'fpDesc'].forEach((id) => { document.getElementById(id).value = ''; });",
        "['fpQty', 'fpPallets', 'fpDesc', 'fpHeat'].forEach((id) => { document.getElementById(id).value = ''; });",
        'H3-prod-clear-heat');
    h = rep(h,
        "html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);\nbox.innerHTML = html;",
        "html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);\nhtml += '<h3 style=\"margin:14px 0 6px\">تولید این بچ (' + fa((g.production_logs || []).length) + ')</h3>';\nhtml += buildMiniTable(g.production_logs || [], [{ label: 'ثبت‌کننده', key: 'operator_id' }, { label: 'محصول', key: 'product_id' }, { label: 'شیفت', key: 'shift_id' }, { label: 'تعداد سالم', key: 'good_quantity', f: groupFa }, { label: 'ایستگاه', key: 'machine_id', f: stationFa }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);\nhtml += '<h3 style=\"margin:14px 0 6px\">مواد مصرف‌شده (' + fa((g.consumed_materials || []).length) + ')</h3>';\nhtml += buildMiniTable(g.consumed_materials || [], [{ label: 'کالا', key: 'item_id', f: invItemName }, { label: 'مقدار', key: 'quantity', f: groupFa }, { label: 'سند خروج', key: 'issue_no' }, { label: 'انبار', key: 'warehouse', f: function (v) { return INV_WAREHOUSES[v] || v || '-'; } }, { label: 'مرجع تولید', key: 'work_order' }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);\nbox.innerHTML = html;",
        'H4-genealogy-sections');
    h = rep(h,
        "var ref = prompt('ارجاع تولید / دستور کار (اختیاری):', '');\nif (ref === null) ref = '';",
        "var ref = prompt('ارجاع تولید / دستور کار (اختیاری):', '');\nif (ref === null) ref = '';\nvar heat = prompt('کد بچ/کویل (Heat Number — اختیاری):', '');\nif (heat === null) heat = '';",
        'H5-consume-heat-prompt');
    h = rep(h,
        "body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: ref, destination_ref: ref, description: ref, request_id: invNewRequestId('web-consume') }) })",
        "body: JSON.stringify({ reservation_id: id, quantity: qty, work_order: ref, destination_ref: ref, heat_number: heat, description: ref, request_id: invNewRequestId('web-consume') }) })",
        'H6-consume-send-heat');
} catch (e) {
    console.log(log.join('\n'));
    console.log('ABORT: ' + e.message + ' — هیچ فایلی نوشته نشد.');
    process.exit(1);
}
// اعتبارسنجی سینتکس قبل از نوشتن
try { new vm.Script(s); } catch (e) { console.log(log.join('\n')); console.log('ABORT server syntax: ' + e.message); process.exit(1); }
const i = h.lastIndexOf('<script>'); const j = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(i + 8, j)); } catch (e) { console.log(log.join('\n')); console.log('ABORT html syntax: ' + e.message); process.exit(1); }
fs.writeFileSync(SP, s, 'utf8');
fs.writeFileSync(HP, h, 'utf8');
console.log(log.join('\n'));
console.log('PHASE 3.2 PATCHED + SAVED');