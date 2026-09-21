#!/usr/bin/env node
/* =====================================================================
   PURGE-36 — برگرداندن داده‌های پیش از ریست از backups/pre-reset-<ts>/
   ---------------------------------------------------------------------
   مصرف:  node tools/restore-live.js --from=<ts>
   مثال:  node tools/restore-live.js --from=2026-03-15T10-30-00

   رفتار:
     • محتوای پوشهٔ backups/pre-reset-<ts>/ به ریشهٔ برنامه منتقل می‌شود.
     • فایل‌های فعلیِ هم‌نام اول به backups/pre-restore-<ts-الان>/ منتقل می‌شوند
       (هیچ‌گاه بی‌بکاپ بازنویسی نمی‌کنیم).
     • .enc کنار فایل فعلی حذف می‌شود تا نسخهٔ برگشتی واقعاً مصرف شود
       (اولویت خواندن سرور با .enc است — SEC-ANTI-19g).
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'backups');

const args = {};
process.argv.slice(2).forEach((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (!m) { console.error('✗ آرگومان نامعتبر: ' + a); process.exit(1); }
    args[m[1].toLowerCase()] = m[2] === undefined ? true : m[2];
});
const from = String(args.from || '').trim();
if (!from || /[\/\\]/.test(from)) { console.error('✗ --from=<ts> الزامی است (مثال: --from=2026-03-15T10-30-00) — بدون مسیر.'); process.exit(1); }

const srcDir = path.join(BACKUPS, 'pre-reset-' + from);
if (!fs.existsSync(srcDir)) {
    console.error('✗ پوشهٔ بکاپ یافت نشد: backups/pre-reset-' + from);
    const avail = fs.existsSync(BACKUPS) ? fs.readdirSync(BACKUPS).filter((d) => d.indexOf('pre-reset-') === 0) : [];
    if (avail.length) { console.error('  نسخه‌های موجود:'); avail.forEach((d) => console.error('   - ' + d.slice('pre-reset-'.length))); }
    process.exit(1);
}

const fa = (n) => String(n).replace(/[0-9]/g, (d) => String.fromCharCode(1776 + Number(d)));
const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const safetyDir = path.join(BACKUPS, 'pre-restore-' + now);

const files = fs.readdirSync(srcDir).filter((f) => f !== '.' && f !== '..');
if (!files.length) { console.error('✗ پوشهٔ بکاپ خالی است.'); process.exit(1); }

fs.mkdirSync(safetyDir, { recursive: true });
let restored = 0, safety = 0;
files.forEach((f) => {
    const dst = path.join(ROOT, f);
    if (fs.existsSync(dst)) { /* بکاپ ایمنی از وضعیت فعلی */
        fs.renameSync(dst, path.join(safetyDir, f));
        safety++;
    }
    if (fs.existsSync(dst + '.enc')) { try { fs.unlinkSync(dst + '.enc'); } catch (e) { /* noop */ } } /* نسخهٔ رمز کهنه نباید اولویت بگیرد */
    fs.renameSync(path.join(srcDir, f), dst);
    restored++;
});

console.log('✓ برگرداندن انجام شد: ' + fa(restored) + ' فایل از backups/pre-reset-' + from);
console.log('  بکاپ ایمنی از وضعیت قبلی: backups/pre-restore-' + now + ' (' + fa(safety) + ' فایل)');
console.log('  اکنون سرویس را ری‌استارت کنید تا دادهٔ برگشتی مصرف شود.');
