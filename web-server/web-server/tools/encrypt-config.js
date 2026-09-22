#!/usr/bin/env node
// =====================================================================
// SEC-ANTI-19g — رمزنگاری پیکربندی (اختیاری): tenant.json / web-users.json
// AES-256-GCM — کلید = scrypt(SANATIFY_LIC_KEY | HWKEY) — صفر وابستگی
//
// قالب .enc عیناً با server.js (CFG_MAGIC_19G) و auth.js یکی است.
// plaintext همچنان پشتیبانی می‌شود (سازگاری کامل) — .enc اولویت دارد.
//
// مصرف (روی هر ماشینی که node دارد — معمولاً ماشین سازنده):
//   node tools/encrypt-config.js --file=tenant.json            # رمز + حذف plaintext
//   node tools/encrypt-config.js --file=web-users.json --keep-plain
//   node tools/encrypt-config.js --all                         # هر دو فایل
//   node tools/encrypt-config.js --file=tenant.json --decrypt  # بازگشت به plaintext (اورژانس/امضای مجدد)
//   node tools/encrypt-config.js --file=... --hwkey=HW-...     # رمز برای ماشین دیگر (کلید از HWKEY مشتری)
//
// ⚠ قواعد مهم:
//  • رمزنگاری فقط وقتی معنا دارد که license به hwkey همان ماشین بسته شده باشد —
//    بدون بستن، هر کس فایل را به همان ماشین ببرد می‌تواند بازش کند (با exe).
//  • کلید به HWKEY ماشین مقصد وابسته است ⇒ برای رمزکردن روی ماشین سازنده و استقرار
//    روی VM مشتری، HWKEY مشتری را با --hwkey= بدهید (از کنسول exe یا --print-hwkey).
//  • SANATIFY_LIC_KEY باید بین ماشین رمزکننده و سرور یکسان باشد (پیش‌فرض: هر دو بدون env = کلید پیش‌فرض کد).
//  • اگر سرور فایل را به‌روزرسانی کند (تغییر کاربر/لایسنس از پنل)، .enc حذف می‌شود
//    وplaintext می‌ماند — برای رمز دوباره این ابزار را دوباره اجرا کنید.
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CFG_MAGIC = 'sanatify-cfg-19g';
const DEFAULT_LIC_KEY = 'Sanatify-Lic-Verify::v1::1405'; /* عین LIC_VERIFY_KEY_24 در server.js */

function fail(msg) { console.error('✗ خطا: ' + msg); process.exit(1); }

// ---------- آرگومان‌ها ----------
const args = {};
process.argv.slice(2).forEach((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (!m) fail('آرگومان نامعتبر: ' + a);
    args[m[1].toLowerCase()] = m[2] === undefined ? true : m[2];
});
const KEEP_PLAIN = !!args['keep-plain'];
const DECRYPT = !!args.decrypt;
const FORCE = !!args.force;

/* HWKEY — عیناً با SEC-BIND-19f در server.js یکی است */
function hwkeyOfThisMachine() {
    let machineId = '';
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const o = { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
            try { const m = String(execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', o)).match(/REG_SZ\s+([^\r\n\s]+)/); machineId = m ? m[1] : ''; } catch (e) { machineId = ''; }
            if (!machineId) { try { machineId = String(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', o)).trim(); } catch (e) { machineId = ''; } }
            if (!machineId) { try { const lines = String(execSync('wmic csproduct get uuid', o)).split(/\r?\n/).filter((l) => l.trim() && l.indexOf('UUID') === -1); machineId = (lines[0] || '').trim(); } catch (e) { machineId = ''; } }
        } else if (process.platform === 'linux') {
            try { machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e) { machineId = ''; }
            if (!machineId) { try { machineId = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim(); } catch (e) { machineId = ''; } }
        } else if (process.platform === 'darwin') {
            try { const { execSync } = require('child_process'); const m = String(execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/); machineId = m ? m[1] : ''; } catch (e) { machineId = ''; }
        }
    } catch (e) { machineId = ''; }
    const core = machineId ? JSON.stringify({ mid: machineId, salt: 'sanatify-mes-hw-v1' }) : (() => {
        const os = require('os');
        let mac = '';
        try { const ifs = os.networkInterfaces(); for (const nm of Object.keys(ifs)) { const arr = ifs[nm] || []; for (const it of arr) { if (it && !it.internal && it.mac && it.mac !== '00:00:00:00:00:00') { mac = it.mac; break; } } if (mac) break; } } catch (e) { /* بی‌ضرر */ }
        return JSON.stringify({ h: os.hostname(), p: process.platform, c: (os.cpus()[0] && os.cpus()[0].model) || '', n: os.cpus().length, m: os.totalmem(), mac: mac, salt: 'sanatify-mes-hw-v1' });
    })();
    const hex = crypto.createHash('sha256').update(core).digest('hex').slice(0, 12).toUpperCase();
    return 'HW-' + hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12);
}

const HWKEY_USED = String(args.hwkey || '').trim().toUpperCase() || hwkeyOfThisMachine();
if (args.hwkey && !/^HW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(HWKEY_USED) && HWKEY_USED !== 'HW-UNKNOWN') {
    fail('فرمت --hwkey نامعتبر است (نمونه: HW-3F2A-91BC-04DE): ' + HWKEY_USED);
}

function deriveKey(salt) {
    const secret = String(process.env.SANATIFY_LIC_KEY || DEFAULT_LIC_KEY) + '|' + HWKEY_USED;
    return crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
}

function encryptFile(file) {
    if (!fs.existsSync(file)) { console.warn('  ⚠ ' + path.basename(file) + ' موجود نیست — رد شد.'); return; }
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail('خواندن ' + file + ': ' + e.message); }
    JSON.parse(text); /* اعتبارسنجی — فایل خراب رمز نمی‌شود */
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = deriveKey(salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
    const box = { enc: CFG_MAGIC, alg: 'aes-256-gcm', hwkey_target: HWKEY_USED, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    const encPath = file + '.enc';
    fs.writeFileSync(encPath, JSON.stringify(box, null, 2) + String.fromCharCode(10), { mode: 0o600 });
    console.log('✓ ' + path.basename(file) + ' → ' + path.basename(encPath) + ' (AES-256-GCM، هدف: ' + HWKEY_USED + ')');
    if (KEEP_PLAIN) console.log('  plaintext حفظ شد (--keep-plain) — توجه: تا وقتی plaintext هست، حفاظت واقعی نیست.');
    else { fs.unlinkSync(file); console.log('  plaintext حذف شد — نسخهٔ پشتیبان امن نزد خودتان نگه دارید.'); }
}

function decryptFile(file) {
    const encPath = file + '.enc';
    if (!fs.existsSync(encPath)) { console.warn('  ⚠ ' + path.basename(encPath) + ' موجود نیست — رد شد.'); return; }
    const box = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    if (!box || box.enc !== CFG_MAGIC) fail('قالب ' + path.basename(encPath) + ' شناخته نشد.');
    const key = deriveKey(Buffer.from(String(box.salt), 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(box.iv), 'base64'));
    d.setAuthTag(Buffer.from(String(box.tag), 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(String(box.data), 'base64')), d.final()]).toString('utf8');
    JSON.parse(out); /* اعتبارسنجی پیش از نوشتن */
    fs.writeFileSync(file, out, 'utf8');
    fs.unlinkSync(encPath);
    console.log('✓ ' + path.basename(encPath) + ' → ' + path.basename(file) + ' (plaintext بازگردانده شد — .enc حذف شد)');
}

const targets = [];
if (args.all) { targets.push(path.join(ROOT, 'tenant.json'), path.join(ROOT, 'web-users.json')); }
else if (args.file) {
    const f = String(args.file);
    targets.push(path.isAbsolute(f) ? f : path.join(ROOT, f));
} else fail('مشخص کنید چه چیزی: --file=tenant.json | --file=web-users.json | --all');

/* هشدار بستن hwkey — رمزنگاری بدون لایسنس بسته حفاظت واقعی نیست */
if (!DECRYPT && !FORCE) {
    let bound = '';
    try { bound = String((JSON.parse(fs.readFileSync(path.join(ROOT, 'tenant.json'), 'utf8')).hwkey) || '').trim().toUpperCase(); } catch (e) { bound = ''; }
    if (!bound) {
        console.warn('⚠ tenant.json فاقد قفل سخت‌افزاری (hwkey) است — رمزنگاری پیکربندی بدون قفل، حفاظت کامل نیست');
        console.warn('  (اول با tools/license.js --hwkey=... امضا کنید، یا --force بزنید.)');
        if (!args['no-warn'] ) { /* پیش‌فرض ادامه ولی با هشدار واضح */ }
    }
}

console.log('━━━ SEC-ANTI-19g — encrypt-config ━━━');
console.log('  HWKEY هدف : ' + HWKEY_USED + (args.hwkey ? ' (دستی)' : ' (این ماشین)'));
console.log('  کلید      : scrypt(SANATIFY_LIC_KEY' + (process.env.SANATIFY_LIC_KEY ? '[env]' : '[پیش‌فرض کد]') + ' | ' + HWKEY_USED + ')');
for (const t of targets) { if (DECRYPT) decryptFile(t); else encryptFile(t); }
console.log('━━━ انجام شد ━━━');
