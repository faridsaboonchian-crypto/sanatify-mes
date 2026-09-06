#!/usr/bin/env node
// =====================================================================
//  HARDEN-18B — اسکریپت «تست بازیابی» (restore drill) — صفر وابستگی
//  صحت بکاپ رمزنگاری‌شده را اثبات می‌کند: رمزگشایی + gunzip + sha256 + اسکیما
//  هرگز live.json را تغییر نمی‌دهد؛ با --out=<path> فقط خروجی رمزگشایی‌شده می‌نویسد.
//
//  مصرف:
//    node tools/restore-drill.js                → تست بازیابی جدیدترین بکاپ
//    node tools/restore-drill.js --list         → فهرست بکاپ‌ها
//    node tools/restore-drill.js --file=live_YYYYMMDD_HHMM_ms.snbak
//    node tools/restore-drill.js --out=restored.json   (خروجی رمزگشایی‌شده برای بازگردانی دستی)
//    node tools/restore-drill.js --key=<passphrase>    (کلید env: SANATIFY_BACKUP_KEY یا backups/.backup-key-18b)
// =====================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const ENC_DIR = path.join(ROOT, 'backups', 'encrypted');
const MAGIC = 'SNBK1';
const TABLES = ['production_logs', 'waste_logs', 'downtime_logs', 'quality_inspections', 'billets', 'furnace_logs', 'rebar_bundles'];

function fail(msg) { console.error('✗ FAIL: ' + msg); process.exit(1); }
function getArg(name) {
    const a = process.argv.find((x) => x.indexOf('--' + name + '=') === 0);
    return a ? a.slice(name.length + 3) : null;
}

function loadKeyMaterial(kdf) {
    const argKey = getArg('key');
    if (argKey) return { kind: 'pass', pass: argKey };
    const envKey = String(process.env.SANATIFY_BACKUP_KEY || '').trim();
    if (envKey) return { kind: 'pass', pass: envKey };
    const kf = path.join(ROOT, 'backups', '.backup-key-18b');
    if (fs.existsSync(kf)) {
        const raw = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'hex');
        if (raw.length === 32) return { kind: 'raw', key: raw };
    }
    return null;
}

function deriveKey(km, salt) { return km.kind === 'raw' ? km.key : crypto.scryptSync(km.pass, salt, 32, { N: 16384, r: 8, p: 1 }); }

function listBackups() {
    if (!fs.existsSync(ENC_DIR)) return [];
    return fs.readdirSync(ENC_DIR).filter((f) => f.endsWith('.snbak')).sort().reverse();
}

function drill(file) {
    const fp = path.join(ENC_DIR, file);
    if (!fs.existsSync(fp)) fail('فایل بکاپ یافت نشد: ' + file);
    const buf = fs.readFileSync(fp);
    if (buf.slice(0, 6).toString('utf8') !== MAGIC + String.fromCharCode(10)) fail('امضای فایل بکاپ معتبر نیست (SNBK1)');
    const nl1 = buf.indexOf(10, 6);
    if (nl1 < 0) fail('هدر بکاپ ناقص است');
    let hdr;
    try { hdr = JSON.parse(buf.slice(6, nl1).toString('utf8')); } catch (e) { fail('هدر JSON نامعتبر: ' + e.message); }
    if (hdr.algo !== 'aes-256-gcm') fail('الگوریتم پشتیبانی نمی‌شود: ' + hdr.algo);
    const km = loadKeyMaterial(hdr.kdf);
    if (!km) fail('کلید در دسترس نیست (env SANATIFY_BACKUP_KEY یا backups/.backup-key-18b یا --key)');
    const salt = Buffer.from(hdr.salt || '', 'base64');
    const key = deriveKey(km, salt);
    let gz;
    try {
        const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(hdr.iv, 'base64'));
        d.setAuthTag(Buffer.from(hdr.tag, 'base64'));
        gz = Buffer.concat([d.update(buf.slice(nl1 + 1)), d.final()]); /* tag غلط ⇒ خطا = فایل دستکاری‌شده */
    } catch (e) { fail('رمزگشایی ناموفق (کلید غلط یا فایل دستکاری‌شده): ' + e.message); }
    const plain = zlib.gunzipSync(gz);
    const sha = crypto.createHash('sha256').update(plain).digest('hex');
    if (sha !== hdr.sha256) fail('checksum متن اصلی مطابقت ندارد (' + sha.slice(0, 12) + '… ≠ ' + String(hdr.sha256).slice(0, 12) + '…)');
    let data;
    try { data = JSON.parse(plain.toString('utf8')); } catch (e) { fail('JSON رمزگشایی‌شده نامعتبر است'); }
    const tables = TABLES.filter((t) => Array.isArray(data[t])).length;
    const recs = TABLES.reduce((s, t) => s + (Array.isArray(data[t]) ? data[t].length : 0), 0);
    const out = getArg('out');
    if (out) { fs.writeFileSync(path.resolve(out), plain); console.log('→ خروجی رمزگشایی‌شده: ' + path.resolve(out)); }
    console.log('✓ PASS — بکاپ سالم است:');
    console.log('  فایل        : ' + file);
    console.log('  زمان        : ' + hdr.at);
    console.log('  کدگذاری     : ' + hdr.kdf + ' + AES-256-GCM + gzip');
    console.log('  حجم اصلی    : ' + Math.round(hdr.size / 1024) + 'KB | sha256: ' + sha.slice(0, 16) + '…');
    console.log('  اسکیما      : ' + tables + '/' + TABLES.length + ' جدول، ' + recs + ' رکورد' + (data.generated_at ? '، generated_at: ' + data.generated_at : ''));
}

const cmd = process.argv[2] || '';
if (cmd === '--list') {
    const all = listBackups();
    if (!all.length) { console.log('هیچ بکاپ رمزنگاری‌شده‌ای یافت نشد: ' + ENC_DIR); process.exit(0); }
    console.log('بکاپ‌های رمزنگاری‌شده (' + all.length + '):');
    all.forEach((f) => {
        try {
            const buf = fs.readFileSync(path.join(ENC_DIR, f));
            const nl = buf.indexOf(10, 6);
            const hdr = JSON.parse(buf.slice(6, nl).toString('utf8'));
            console.log('  ' + f + '  ← ' + hdr.at + '  ' + Math.round(hdr.size / 1024) + 'KB');
        } catch (e) { console.log('  ' + f + '  (هدر خوانده نشد)'); }
    });
} else {
    const files = listBackups();
    if (!files.length) fail('هیچ بکاپ رمزنگاری‌شده‌ای یافت نشد — بکاپ 18B هنوز اجرا نشده است');
    const want = getArg('file');
    drill(want && files.indexOf(want) !== -1 ? want : files[0]);
}
