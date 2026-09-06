#!/usr/bin/env node
// =====================================================================
// SEC-BIND-19f — ابزار تولید Hardware ID (صفر وابستگی)
//
// هدف: نسخهٔ دموی تجاری فقط روی VM مشتریِ دارای لایسنس اجرا شود.
//  ۱) این ابزار را روی ماشین مشتری اجرا کنید → HWKEY ماشین چاپ می‌شود
//  ۲) HWKEY را به پشتیبانی بفرستید → tenant.json امضاشده با همان HWKEY می‌گیرید
//     node tools/license.js --hwkey=HW-XXXX-XXXX-XXXX --sign --sign-ed
//  ۳) سرور روی ماشین دیگر بالا نمی‌آید (گیت بوت SEC-BIND-19f در server.js)
//
// مصرف:
//   node tools/generate-hwkey.js             → HW-XXXX-XXXX-XXXX
//   node tools/generate-hwkey.js --details   → عوامل سخت‌افزاری خام
//   node tools/generate-hwkey.js --json      → خروجی ماشین‌خواندنی
//
// ⚠ الگوریتم عیناً با SEC-BIND-19f در server.js یکی است — هر تغییری باید
//   هم‌زمان در هر دو فایل اعمال شود وگرنه لایسنس صادرشده تطبیق نمی‌کند.
// ⚠ نکتهٔ exe: نسخهٔ کامپایل‌شده (SEC-PROTECT-19e) هم HWKEY ماشین را هنگام
//   بوت روی کنسول چاپ می‌کند — روی VM بدون Node هم کافی است همان را بفرستید.
// =====================================================================
'use strict';
const fs = require('fs');
const crypto = require('crypto');

function hwFactors19f() {
    /* عیناً با hwFactors19f در server.js — MachineGuid ویندوز / machine-id لینوکس / IOPlatformUUID مک */
    let machineId = '';
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const o19f = { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
            /* ۱) MachineGuid — هنگام نصب ویندوز ساخته می‌شود، در ری‌استارت/کپونینگ پایدار است */
            try {
                const m19f = String(execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', o19f)).match(/REG_SZ\s+([^\r\n\s]+)/);
                machineId = m19f ? m19f[1] : '';
            } catch (e19f) { machineId = ''; }
            /* ۲) UUID مادربورد/BIOS از PowerShell (wmic در ویندوزهای جدید حذف شده) */
            if (!machineId) { try { machineId = String(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', o19f)).trim(); } catch (e19f) { machineId = ''; } }
            /* ۳) wmic — مسیر قدیمی */
            if (!machineId) { try { const lines19f = String(execSync('wmic csproduct get uuid', o19f)).split(/\r?\n/).filter((l) => l.trim() && l.indexOf('UUID') === -1); machineId = (lines19f[0] || '').trim(); } catch (e19f) { machineId = ''; } }
        } else if (process.platform === 'linux') {
            try { machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e19f) { machineId = ''; }
            if (!machineId) { try { machineId = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim(); } catch (e19f) { machineId = ''; } }
        } else if (process.platform === 'darwin') {
            try {
                const { execSync } = require('child_process');
                const m19f = String(execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
                machineId = m19f ? m19f[1] : '';
            } catch (e19f) { machineId = ''; }
        }
    } catch (e19f) { machineId = ''; }
    let mac19f = '';
    try {
        const os19f = require('os');
        const ifs19f = os19f.networkInterfaces();
        const names19f = Object.keys(ifs19f);
        for (let i = 0; i < names19f.length && !mac19f; i++) {
            const arr19f = ifs19f[names19f[i]] || [];
            for (let j = 0; j < arr19f.length; j++) {
                const it19f = arr19f[j];
                if (it19f && !it19f.internal && it19f.mac && it19f.mac !== '00:00:00:00:00:00') { mac19f = it19f.mac; break; }
            }
        }
    } catch (e19f) { mac19f = ''; }
    const os19c = require('os');
    return {
        machine_id: machineId || '', hostname: os19c.hostname() || '', platform: process.platform,
        cpu_model: (os19c.cpus()[0] && os19c.cpus()[0].model) || '', cpu_count: os19c.cpus().length,
        mem_total: os19c.totalmem(), mac: mac19f,
    };
}

function hwCore19f(f19f) {
    /* عیناً با hwCore19f در server.js — machine_id پایدار تنها ملاک؛ در نبودش ترکیب پایدارهای os */
    return f19f.machine_id
        ? JSON.stringify({ mid: f19f.machine_id, salt: 'sanatify-mes-hw-v1' })
        : JSON.stringify({ h: f19f.hostname, p: f19f.platform, c: f19f.cpu_model, n: f19f.cpu_count, m: f19f.mem_total, mac: f19f.mac, salt: 'sanatify-mes-hw-v1' });
}

function computeHwkey19f() {
    const f19f = hwFactors19f();
    const hex19f = crypto.createHash('sha256').update(hwCore19f(f19f)).digest('hex').slice(0, 12).toUpperCase();
    return 'HW-' + hex19f.slice(0, 4) + '-' + hex19f.slice(4, 8) + '-' + hex19f.slice(8, 12);
}

// ---------- آرگومان‌ها ----------
const argv19f = process.argv.slice(2);
const showDetails = argv19f.indexOf('--details') !== -1;
const showJson = argv19f.indexOf('--json') !== -1;

const f19f = hwFactors19f();
const hwkey19f = computeHwkey19f();

if (showJson) {
    console.log(JSON.stringify({
        hwkey: hwkey19f,
        machine_id_present: !!f19f.machine_id,
        machine_id_source: f19f.machine_id ? (process.platform === 'win32' ? 'win-MachineGuid/csproduct-UUID' : (process.platform === 'linux' ? 'linux-machine-id' : 'mac-IOPlatformUUID')) : null,
        fallback_factors_used: !f19f.machine_id,
        hostname: f19f.hostname, platform: f19f.platform,
        cpu_model: f19f.cpu_model, cpu_count: f19f.cpu_count, mac: f19f.mac,
        algorithm: 'sha256(canonical).slice(0,12) — salt: sanatify-mes-hw-v1',
    }, null, 2));
    process.exit(0);
}

if (showDetails) {
    console.log('━━━ عوامل سخت‌افزاری خام (SEC-BIND-19f) ━━━');
    console.log('  machine_id : ' + (f19f.machine_id || '(موجود نیست — ترکیب fallback استفاده می‌شود)'));
    console.log('  hostname   : ' + f19f.hostname);
    console.log('  platform   : ' + f19f.platform);
    console.log('  cpu        : ' + f19f.cpu_model + ' × ' + f19f.cpu_count);
    console.log('  mem_total  : ' + Math.round(f19f.mem_total / (1024 * 1024)) + ' MB');
    console.log('  mac اول    : ' + (f19f.mac || '—'));
    console.log('━━━');
}

console.log(hwkey19f);
if (!showJson && !showDetails) {
    console.error('  (این HWKEY را برای صدور لایسنس نزد فروشنده بفرستید — جزئیات: --details)');
}
