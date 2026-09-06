#!/usr/bin/env node
/* ===== HARDEN-18M: ابزار تأیید زنجیرهٔ هش audit — ضد دستکاری لاگ =====
   استفاده:
     node tools/audit-verify.js                (پوشهٔ جاری = ROOT سرور)
     node tools/audit-verify.js /path/to/root
   خروجی: PASS/FAIL + محل دقیق اولین شکستگی زنجیره
   صفر وابستگی — فقط ماژول‌های داخلی Node */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.argv[2] || process.cwd());
function canonical18M(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj === undefined ? null : obj);
    if (Array.isArray(obj)) return '[' + obj.map(canonical18M).join(',') + ']';
    const keys = Object.keys(obj).filter((k) => k !== '__h18m').sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical18M(obj[k])).join(',') + '}';
}
function hash18M(obj) { return crypto.createHash('sha256').update(canonical18M(obj), 'utf8').digest('hex'); }

/* فایل‌های audit به ترتیب زمانی: فایل‌های چرخیده audit-YYYY-MM.json قدیم→جدید، سپس audit.json جاری */
let files = [];
try {
    files = fs.readdirSync(ROOT).filter((f) => /^audit-\d{4}-\d{2}\.json$/.test(f)).sort().map((f) => ({ name: f, path: path.join(ROOT, f) }));
} catch (e) { /* بدون فایل چرخیده */ }
files.push({ name: 'audit.json', path: path.join(ROOT, 'audit.json') });

let prev = 'GENESIS';
let total = 0, chained = 0, legacy = 0, failures = 0;
let started = false; /* اولین رکورد زنجیردار دیده شد؟ — رکوردهای قبل از آن legacy (دورهٔ قبل از 18M) */
for (const f of files) {
    let arr;
    try {
        if (!fs.existsSync(f.path)) continue;
        arr = JSON.parse(fs.readFileSync(f.path, 'utf8'));
    } catch (e) { console.log('FAIL — فایل «' + f.name + '» قابل خواندن/تجزیه نیست: ' + e.message); failures++; continue; }
    if (!Array.isArray(arr)) { console.log('FAIL — فایل «' + f.name + '» آرایه نیست.'); failures++; continue; }
    for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        total++;
        if (!r || typeof r !== 'object') { console.log('FAIL — ' + f.name + '[' + i + '] رکورد نامعتبر.'); failures++; continue; }
        if (typeof r.__h18m !== 'string' || r.__h18m.length !== 64) {
            if (!started) { legacy++; continue; } /* رکوردهای دوران قبل از 18M — طبیعی */
            console.log('FAIL — ' + f.name + '[' + i + '] رکورد زنجیردار وسط زنجیره بدون هش (حذف/جایگزینی رکورد؟).');
            failures++; continue;
        }
        started = true; chained++;
        const expect = hash18M(r);
        if (r.__h18m !== expect) { console.log('FAIL — ' + f.name + '[' + i + '] هش رکورد با محتوا نمی‌خواند (محتوا دست‌کاری شده).'); console.log('       انتظار: ' + expect); console.log('       موجود: ' + r.__h18m); failures++; continue; }
        if (r.__pc18m !== prev) { console.log('FAIL — ' + f.name + '[' + i + '] پیوند زنجیره شکسته (رکورد قبلی حذف/جایگزین شده).'); console.log('       انتظار __pc18m: ' + prev); console.log('       موجود __pc18m: ' + r.__pc18m); failures++; continue; }
        prev = r.__h18m;
    }
}
console.log('──────────────────────────────────────────');
console.log('مجموع رکوردها: ' + total + ' | زنجیردار: ' + chained + ' | legacy (پیش از 18M): ' + legacy + ' | فایل‌ها: ' + files.filter((f) => fs.existsSync(f.path)).length);
if (failures === 0) { console.log('✓ PASS — زنجیرهٔ audit سالم است (هیچ دستکاری/حذفی وسط زنجیره یافت نشد).'); process.exit(0); }
console.log('✗ FAIL — ' + failures + ' ناسازگاری در زنجیرهٔ audit یافت شد — لاگ دست‌کاری/خراب شده است.'); process.exit(1);
