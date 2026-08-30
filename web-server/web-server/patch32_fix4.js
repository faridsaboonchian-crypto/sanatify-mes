const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SP = path.join(__dirname, 'server.js');
const HP = path.join(__dirname, 'public', 'index.html');
let s = fs.readFileSync(SP, 'utf8');
let h = fs.readFileSync(HP, 'utf8');
const log = [];
let ok = true;

fs.writeFileSync(SP + '.bak_p32_4', s);
fs.writeFileSync(HP + '.bak_p32_4', h);

// ================================================================
// S1: اضافه کردن heat_number به رکورد تولید (همه occurrenceها)
// ================================================================
if (s.includes('heat_number: String(b.heat_number')) {
    log.push('S1-production-heat: already');
} else {
    const r1 = /machine_id: String\(b\.machine_id \|\| 'st-pack'\)\.trim\(\),\s*description: String\(b\.description \|\| ''\)\.slice\(0, 500\),\s*source: 'manual',/g;
    if (!r1.test(s)) { log.push('S1-production-heat: ANCHOR MISSING'); ok = false; }
    else {
        const cnt = (s.match(r1) || []).length;
        s = s.replace(r1, "machine_id: String(b.machine_id || 'st-pack').trim(),\nheat_number: String(b.heat_number || '').trim(),\ndescription: String(b.description || '').slice(0, 500),\nsource: 'manual',");
        log.push('S1-production-heat: replaced ' + cnt + ' occurrences');
    }
}

// ================================================================
// H1: اضافه کردن input heat number به فرم تولید
// ================================================================
if (h.includes('id="fpHeat"')) {
    log.push('H1-prod-heat-input: already');
} else {
    const r2 = /style="width:160px" \/>\s*<\/div>\s*<div class="frow" style="margin-top:8px">\s*<span class="flbl">ایستگاه نهایی: <b>تست و بسته‌بندی \(دروازهٔ پایان خط\)<\/b><\/span>/;
    if (!r2.test(h)) { log.push('H1-prod-heat-input: ANCHOR MISSING'); ok = false; }
    else {
        h = h.replace(r2, 'style="width:160px" />\n<input type="text" id="fpHeat" placeholder="کد بچ / Heat Number (اختیاری)" style="flex:1 1 180px" />\n</div>\n<div class="frow" style="margin-top:8px">\n<span class="flbl">ایستگاه نهایی: <b>تست و بسته‌بندی (دروازهٔ پایان خط)</b></span>');
        log.push('H1-prod-heat-input: replaced');
    }
}

// ================================================================
// H6: نمایش مواد مصرف‌شده در Genealogy
// ================================================================
if (h.includes('consumed_materials') && h.includes('g.consumed_materials.length')) {
    log.push('H6-genealogy-sections: already');
} else {
    const r3 = /key: 'produced_at', f: fmtDate \}\]\);\s*box\.innerHTML = html;/;
    if (!r3.test(h)) { log.push('H6-genealogy-sections: ANCHOR MISSING'); ok = false; }
    else {
        const NEW_H6 = "key: 'produced_at', f: fmtDate }]);\n" +
            "if (g.production_logs && g.production_logs.length > 0) {\n" +
            "html += '<h3 style=\"margin:14px 0 6px\">تولید این بچ (' + fa(g.production_logs.length) + ')</h3>';\n" +
            "html += buildMiniTable(g.production_logs, [{ label: 'ثبت‌کننده', key: 'operator_id' }, { label: 'محصول', key: 'product_id' }, { label: 'شیفت', key: 'shift_id' }, { label: 'تعداد سالم', key: 'good_quantity', f: groupFa }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);\n" +
            "}\n" +
            "if (g.consumed_materials && g.consumed_materials.length > 0) {\n" +
            "html += '<h3 style=\"margin:14px 0 6px\">مواد مصرف‌شده برای این بچ (' + fa(g.consumed_materials.length) + ')</h3>';\n" +
            "html += buildMiniTable(g.consumed_materials, [{ label: 'کالا', key: 'item_id', f: invItemName }, { label: 'مقدار', key: 'quantity', f: groupFa }, { label: 'سند خروج', key: 'issue_no' }, { label: 'انبار', key: 'warehouse', f: function(v) { return INV_WAREHOUSES[v] || v || '-'; } }, { label: 'مرجع تولید', key: 'work_order' }, { label: 'زمان', key: 'timestamp', f: fmtDate }]);\n" +
            "}\n" +
            "box.innerHTML = html;";
        h = h.replace(r3, NEW_H6);
        log.push('H6-genealogy-sections: replaced');
    }
}

// ================================================================
// اعتبارسنجی سینتکس
// ================================================================
if (!ok) {
    console.log(log.join('\n'));
    console.log('❌ ABORT: هیچ فایلی نوشته نشد.');
    process.exit(1);
}
try { new vm.Script(s); log.push('✅ server.js syntax OK'); } catch (e) { console.log('❌ server.js syntax ERROR: ' + e.message); process.exit(1); }
const i = h.lastIndexOf('<script>'); const j = h.lastIndexOf('</' + 'script>');
try { new vm.Script(h.slice(i + 8, j)); log.push('✅ index.html syntax OK'); } catch (e) { console.log('❌ index.html syntax ERROR: ' + e.message); process.exit(1); }

fs.writeFileSync(SP, s, 'utf8');
fs.writeFileSync(HP, h, 'utf8');
console.log(log.join('\n'));
console.log('\n✅✅✅ PHASE 3.2 PATCHED + SAVED ✅✅✅');