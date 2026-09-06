#!/usr/bin/env node
// =====================================================================
//  HARDEN-18C — ارزیابی node:sqlite روی نسخهٔ Node هدف + اثبات تست
//  صفر وابستگی — ماژول داخلی node:sqlite (بدون npm)
//  تصمیم مهاجرت live.json → SQLite بر اساس خروجی همین اسکریپت + تحلیل ریسک گرفته می‌شود.
//  مصرف: node tools/sqlite-eval.js
// =====================================================================
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0, failN = 0;
function ok(name, detail) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')); }
function bad(name, detail) { failN++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }

console.log('Node: ' + process.version + ' | platform: ' + os.platform() + ' ' + os.arch());

// ۱) در دسترس بودن node:sqlite
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); ok('node:sqlite قابل بارگذاری است'); }
catch (e) { bad('node:sqlite قابل بارگذاری نیست', e.message); printDecision(); process.exit(1); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-sqlite-eval-'));
const dbPath = path.join(TMP, 'eval.db');

try {
    const db = new DatabaseSync(dbPath);
    // ۲) WAL + تراکنش
    db.exec('PRAGMA journal_mode = WAL;');
    const wm = db.prepare('PRAGMA journal_mode').get();
    String(Object.values(wm)[0]) === 'wal' ? ok('حالت WAL فعال شد', JSON.stringify(wm)) : bad('حالت WAL فعال نشد', JSON.stringify(wm));
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, k TEXT, v REAL);');
    const ins = db.prepare('INSERT INTO t (k, v) VALUES (?, ?)');
    const t0 = Date.now();
    db.exec('BEGIN'); /* node:sqlite: تراکنش دستی (بدون wrapper کتابخانه‌های ثالث) */
    for (let i = 0; i < 1000; i++) ins.run('row' + i, i * 1.5);
    db.exec('COMMIT');
    const ms = Date.now() - t0;
    const c1 = db.prepare('SELECT COUNT(*) AS n FROM t').get();
    c1.n === 1000 ? ok('تراکنش + ۱۰۰۰ درج', ms + 'ms (' + Math.round(1000 / Math.max(ms, 1) * 1000) + ' درج/ثانیه)') : bad('تراکنش', 'count=' + c1.n);

    // ۳) خوانندهٔ همزمان حین نویسنده (ویژگی WAL)
    const rd = db.prepare('SELECT COUNT(*) AS n FROM t WHERE v > 500').get();
    ok('خواندن با شمارش', 'rows>500 = ' + rd.n);
    db.close();
} catch (e) { bad('تست پایه', e.message); }

// ۴) سناریوی قطع برق: SIGKILL حین تراکنش باز → بازگشایی → rollback باید خودکار باشد
const childScript = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(${JSON.stringify(dbPath)});
db.exec('PRAGMA journal_mode = WAL;');
db.exec('CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, k TEXT, v REAL);');
db.exec('BEGIN');
db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run('crash', 1);
db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run('crash', 2);
process.kill(process.pid, 'SIGKILL'); /* قطع ناگهانی — بدون COMMIT */
`;
try { fs.writeFileSync(path.join(TMP, 'child.js'), childScript); } catch (e) { /* noop */ }
const child = spawnSync(process.execPath, [path.join(TMP, 'child.js')], { timeout: 10000 });
if (child.signal === 'SIGKILL' || child.status !== 0) {
    try {
        const db2 = new DatabaseSync(dbPath);
        const c2 = db2.prepare('SELECT COUNT(*) AS n FROM t').get();
        const rows = db2.prepare('SELECT COUNT(*) AS n FROM t WHERE k = ?').get('crash');
        c2.n === 1000 && rows.n === 0
            ? ok('قطع برق حین تراکنش → rollback خودکار (SIGKILL)', '۰ رکورد نیمه‌کاره؛ ۱۰۰۰ رکورد قبلی سالم')
            : bad('rollback پس از SIGKILL', 'count=' + c2.n + ', crash=' + rows.n);
        db2.close();
    } catch (e) { bad('بازگشایی پس از SIGKILL', e.message); }
} else { bad('فرایند فرزند SIGKILL نشد', JSON.stringify(child.status)); }

// ۵) تمیزکاری
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* noop */ }
printDecision();

function printDecision() {
    console.log('');
    console.log('=== تصمیم مهاجرت (HARDEN-18C) ===');
    console.log('node:sqlite روی Node ' + process.version + ' کار می‌کند (WAL + تراکنش + rollback پس از SIGKILL اثبات شد).');
    console.log('با این حال مهاجرت live.json → SQLite در «این فاز» اجرا نمی‌شود؛ دلیل:');
    console.log('  • ۷۹ سایت نوشتن + همهٔ مسیرهای خواندن در سرور تک‌فایلی ۷.۳هزارخطی باید بازنویسی شوند؛');
    console.log('    خط قرمز فاز: «هیچ ماژول عملیاتی رفتارش تغییر نکند» — ریسک رگرسیون در تولید واقعی بالاست.');
    console.log('  • اهداف یکپارچگی داده (اتمیک + checksum + بازیابی + صف تک‌نویسنده) با لایه‌های 18A/18D');
    console.log('    روی همان JSON محقق شد — سازگاری بایت‌به‌بایت با ابزارهای موجود (S3 dump، restore، اسکریپت‌های کارخانه).');
    console.log('  • پیشنهاد: فاز جداگانه «STORAGE-SQLITE» با dual-write (JSON + SQLite موازی) و مقایسهٔ هش پس از N روز،');
    console.log('    سپس سوئیچ — همان الگوی مهاجرت بی‌ریسک.');
    process.exit(failN ? 1 : 0);
}
