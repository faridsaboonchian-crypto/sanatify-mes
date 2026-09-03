#!/usr/bin/env node
// =====================================================================
//  SEC-15b — مهاجرت رمزهای plaintext به hash (scrypt داخلی Node — بدون npm جدید)
//
//  مصرف:  node tools/migrate-hashes.js
//  کاری که می‌کند:
//    ۱) از web-users.json بکاپ امن می‌گیرد (web-users.json.bak-<timestamp>)
//    ۲) برای هر کاربر بدون password_hash: هش می‌سازد و «password» plaintext را حذف می‌کند
//    ۳) نتیجه را اتمیک می‌نویسد و خلاصهٔ فارسی چاپ می‌کند
//  نکته امنیتی: فایل بکاپ حاوی plaintext است — پس از تأیید ورود همهٔ کاربران،
//  آن را securely حذف کنید (shred/پوشهٔ رمزگذاری‌شده).
// =====================================================================
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../auth');

const ROOT = path.join(__dirname, '..');
const argFile = (process.argv.find((a) => a.startsWith('--file=')) || '').split('=')[1];
const FILE = path.join(ROOT, argFile || 'web-users.json');

if (!fs.existsSync(FILE)) { console.error('✗ فایل یافت نشد:', FILE); process.exit(1); }
let users;
try { users = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { console.error('✗ JSON نامعتبر:', e.message); process.exit(1); }
if (!Array.isArray(users)) { console.error('✗ ساختار مورد انتظار: آرایهٔ کاربران'); process.exit(1); }

// ۱) بکاپ
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const bak = FILE + '.bak-' + stamp;
fs.copyFileSync(FILE, bak);
console.log('✓ بکاپ →', bak);

// ۲) مهاجرت
let migrated = 0, already = 0, nopass = 0;
const out = users.map((u) => {
    if (u.password_hash && String(u.password_hash).indexOf('scrypt$') === 0) { already++; return u; }
    if (u.password != null && u.password !== '') {
        const c = Object.assign({}, u);
        c.password_hash = hashPassword(String(u.password));
        delete c.password;
        migrated++;
        return c;
    }
    nopass++;
    return u;
});

// ۳) نوشتن اتمیک
const tmp = FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf8');
fs.renameSync(tmp, FILE);

console.log('━━━ خلاصهٔ مهاجرت SEC-15b ━━━');
console.log('  کل کاربران: ' + users.length);
console.log('  هش‌شدند (plaintext حذف شد): ' + migrated);
console.log('  از قبل هش بودند: ' + already);
console.log('  بدون رمز قابل مهاجرت: ' + nopass);
if (migrated > 0) console.log('\n  ✔ هیچ رمز plaintextی در فایل باقی نماند — از این پس login فقط با verifyPassword(hash) کار می‌کند.');
console.log('\n  یادآوری: بعد از تأیید ورود همهٔ کاربران، بکاپ حاوی plaintext را حذف امن کنید.');
