const fs = require('fs');
const vm = require('vm');
const SP = 'server.js', HP = 'public/index.html';
let s = fs.readFileSync(SP, 'utf8');
let h = fs.readFileSync(HP, 'utf8');
const log = [];
function rep(src, oldStr, newStr, name, all) {
    if (src.includes(newStr)) { log.push(name + ': already'); return src; }
    if (!src.includes(oldStr)) { log.push(name + ': ANCHOR MISSING'); return src; }
    log.push(name + ': ok');
    return all ? src.split(oldStr).join(newStr) : src.replace(oldStr, newStr);
}
// 1) سرور: ثبت تولید، کد بچ را ذخیره کند
s = rep(s, "machine_id: String(b.machine_id || 'st-pack').trim(),", "machine_id: String(b.machine_id || 'st-pack').trim(), heat_number: String(b.heat_number || '').trim(),", 'S-prod-heat', true);
// 2) سرور: ردیابی، تولیدها و مصرف‌ها را هم برگرداند
s = rep(s, "return { heat_number: h, billets: (d.billets || []).filter((x) => String(x.heat_number) === h), furnace_logs: (d.furnace_logs || []).filter((x) => String(x.heat_number) === h), rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h) };", "return { heat_number: h, billets: (d.billets || []).filter((x) => String(x.heat_number) === h), furnace_logs: (d.furnace_logs || []).filter((x) => String(x.heat_number) === h), rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h), production_logs: (d.production_logs || []).filter((x) => String(x.heat_number || '') === h || (h !== '' && String(x.description || '').indexOf(h) !== -1)), consumed_materials: (d.inventory_issues || []).filter((x) => String(x.heat_number || '') === h || String(x.work_order || '') === h || String(x.destination_ref || '') === h) };", 'S-genealogy', false);
// 3) کلاینت: فیلد کد بچ به فرم تولید
h = rep(h, 'style="width:160px" />', 'style="width:160px" />\n<input type="text" id="fpHeat" placeholder="کد بچ/کویل (مثال: RC-3.2-X)" style="flex:1 1 180px" />', 'H-fpHeat', false);
// 4) کلاینت: ارسال کد بچ هنگام ثبت تولید
h = rep(h, "machine_id: 'st-pack', description:", "machine_id: 'st-pack', heat_number: (document.getElementById('fpHeat') ? document.getElementById('fpHeat').value.trim() : ''), description:", 'H-fpSave', false);
// 5) کلاینت: پاک شدن فیلد بعد از ثبت
h = rep(h, "['fpQty', 'fpPallets', 'fpDesc'].forEach", "['fpQty', 'fpPallets', 'fpDesc', 'fpHeat'].forEach", 'H-clear', false);
// 6) کلاینت: دو بخش جدید در ردیابی بچ
h = rep(h, "html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);", "html += buildMiniTable(g.rebar_bundles, [{ label: 'کد محموله', key: 'bundle_code' }, { label: 'حجم (لیتر)', key: 'rebar_size', f: fa }, { label: 'گرید', key: 'rebar_grade' }, { label: 'تعداد', key: 'branch_count', f: fa }, { label: 'وزن (kg)', key: 'net_weight_kg', f: groupFa }, { label: 'کیفیت', key: 'quality_status', f: qcChip }, { label: 'تولید', key: 'produced_at', f: fmtDate }]);\nhtml += '<h3 style=\"margin:14px 0 6px\">ثبت‌های تولید این بچ (' + fa((g.production_logs || []).length) + ')</h3>';\nhtml += buildMiniTable(g.production_logs || [], [{ label: 'ثبت‌کننده', key: 'operator_id' }, { label: 'محصول', key: 'product_id' }, { label: 'شیفت', key: 'shift_id' }, { label: 'تعداد سالم', key: 'good_quantity', f: groupFa }, { label: 'ایستگاه', key: 'machine_id', f: stationFa }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);\nhtml += '<h3 style=\"margin:14px 0 6px\">مواد مصرف‌شده برای این بچ (' + fa((g.consumed_materials || []).length) + ')</h3>';\nhtml += buildMiniTable(g.consumed_materials || [], [{ label: 'کالا', key: 'item_id', f: invItemName }, { label: 'مقدار', key: 'quantity', f: groupFa }, { label: 'سند خروج', key: 'issue_no' }, { label: 'انبار', key: 'warehouse', f: function (v) { return INV_WAREHOUSES[v] || v || '-'; } }, { label: 'مرجع/مقصد', key: 'destination_ref' }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);", 'H-genealogy-sections', false);
let okS = true, okH = true;
try { new vm.Script(s); } catch (e) { okS = false; log.push('SRV SYNTAX: ' + e.message); }
const i = h.lastIndexOf('<script>'); const j = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(i + 8, j)); } catch (e) { okH = false; log.push('HTML SYNTAX: ' + e.message); }
if (okS) fs.writeFileSync(SP, s, 'utf8'); else log.push('server.js NOT saved');
if (okH) fs.writeFileSync(HP, h, 'utf8'); else log.push('index.html NOT saved');
console.log(log.join('\n'));
console.log(okS && okH ? 'PHASE 3.2 LINK PATCHED + SAVED' : 'CHECK ERRORS');