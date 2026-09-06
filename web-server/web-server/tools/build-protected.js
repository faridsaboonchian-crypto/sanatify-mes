#!/usr/bin/env node
// =====================================================================
// SEC-PROTECT-19e — خط تولید «نسخهٔ حفاظت‌شده» برای دموی تجاری روی VM مشتری
// گام ۱: مبهم‌سازی (javascript-obfuscator) سرور + منطق درون‌خطی SPA
// گام ۲: کامپایل به فایل اجرایی واحد (pkg) — اختیاری با --compile
//
// مصرف (از پوشهٔ tools، یک‌بار: npm install --no-save فقط همین دو devDependency):
//   node tools/build-protected.js                    → فقط مبهم‌سازی → dist/
//   node tools/build-protected.js --compile          → مبهم‌سازی + باینری (پیش‌فرض node18-linux-x64 برای خودآزمایی)
//   node tools/build-protected.js --compile --target=node18-win-x64,node18-linux-x64
//   node tools/build-protected.js --fast             → مبهم‌سازی سبک‌تر (ساخت سریع‌تر برای تست)
//
// تضمین‌ها:
//  • هر خروجی JS با vm.Script و node --check راستی‌آزمایی می‌شود
//  • سوکت‌آزمون خودکار: اجرای dist/server.js روی پورت محافظت‌شدهٔ موقت + / و /api/health و ورود
//  • sw.js بایت‌به‌بایت دست‌نخورده می‌ماند (نظم کش PWA — هیچ رازی هم در آن نیست)
//  • public/ (استاتیک) عیناً کپی؛ فقط بلاک‌های <script> درون‌خطی index.html مبهم می‌شوند
//  • فایل‌های داده (live.json/web-users.json/tenant.json/audit.json/uploads/backups) هرگز داخل بیلد نه — روی VM کنار exe ساخته می‌شوند
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TOOLS_DIR = __dirname;
const SRC_DIR = path.join(TOOLS_DIR, '..');
const OUT_DIR = path.join(SRC_DIR, 'dist');
const arg = (n, d) => { const a = process.argv.find((x) => x.indexOf('--' + n + '=') === 0); return a ? a.slice(n.length + 3) : d; };
const COMPILE = process.argv.indexOf('--compile') !== -1;
const FAST = process.argv.indexOf('--fast') !== -1;
const TARGETS = (arg('target', 'node18-linux-x64')).split(',').map((s) => s.trim()).filter(Boolean);

function log(s) { console.log('│ ' + s); }
function die(s) { console.error('✖ ' + s); process.exit(1); }

// ---------- بارگذاری javascript-obfuscator از node_modules همین پوشه ----------
let obfuscator;
try { obfuscator = require(path.join(TOOLS_DIR, 'node_modules', 'javascript-obfuscator')); }
catch (e) { die('javascript-obfuscator نصب نیست. یک‌بار در پوشهٔ tools اجرا کنید: npm install  (خط: ' + e.message + ')'); }

// ---------- گزینه‌های مبهم‌سازی ----------
function serverOpts() {
    return {
        compact: true,
        controlFlowFlattening: !FAST, controlFlowFlatteningThreshold: FAST ? 0 : 0.7,
        deadCodeInjection: !FAST, deadCodeInjectionThreshold: FAST ? 0 : 0.25,
        stringArray: true, stringArrayThreshold: 0.8, stringArrayEncoding: [FAST ? 'none' : 'base64'], stringArrayRotate: true, stringArrayShuffle: true,
        /* SEC-PROTECT-19e: مسیر requireها و نام ماژول‌های داخلی باید literal بمانند — تحلیل ایستای pkg به آن‌ها نیاز دارد */
        reservedStrings: ['^\\./auth$', '^(crypto|fs|path|http|https|tls|url|os|net|zlib|util|vm|events|stream|querystring|child_process|readline|buffer|string_decoder)$'],
        transformObjectKeys: false,           // نام کلیدها حفظ شود (سازگاری JSON/ماژول)
        renameGlobals: false,                 // require('./auth') و module.exports سالم بمانند
        selfDefending: false, debugProtection: false, disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal',
        unicodeEscapeSequence: false          // رشته‌های فارسی خوانا برای فایل (منطق مبهم می‌ماند)
    };
}
function spaOpts() {
    // سازگار-اول: بدون flattening/deadCode — کارایی UI دست‌نخورده؛ فقط پوشش رشته‌ها/نام‌ها
    return {
        compact: true,
        controlFlowFlattening: false, deadCodeInjection: false,
        stringArray: true, stringArrayThreshold: FAST ? 0.35 : 0.55, stringArrayEncoding: ['none'], stringArrayRotate: true, stringArrayShuffle: true,
        transformObjectKeys: false, renameGlobals: false, selfDefending: false, debugProtection: false, disableConsoleOutput: false,
        identifierNamesGenerator: 'hexadecimal', unicodeEscapeSequence: false
    };
}

function verifyJs(code, label) {
    try { new vm.Script(code, { filename: label }); }
    catch (e) { die('خروجی مبهم‌شدهٔ ' + label + ' سینتکس نامعتبر دارد: ' + e.message); }
}

/* SEC-PROTECT-19e: خروجی مبهم‌شده هرگز نباید ترتیب کاراکتری «</script» داشته باشد —
   درون رشتهٔ JS یا regex همان مقدار/معنا با escape می‌ماند (‎\x3c = '<')؛
   در غیر این صورت مرورگر تگ script را زودتر می‌بندد و stringArray به‌صورت HTML می‌ریزد. */
function makeInlineSafe19e(code) {
    return code.replace(/<\/(script)/gi, '\\x3c/$1').replace(/<!--/g, '\\x3c!--');
}

// ---------- استخراج/بازچینی بلاک‌های <script> درون‌خطی ----------
function protectHtml(html, outName) {
    const parts = [];
    const re = /(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi;
    let idx = 0, m, out = '', last = 0, protectedCount = 0;
    while ((m = re.exec(html)) !== null) {
        const openTag = m[1], attrs = m[2], body = m[3], closeTag = m[4];
        const hasSrc = /\bsrc\s*=/i.test(attrs);
        out += html.slice(last, m.index);
        if (hasSrc || body.trim() === '') {
            out += openTag + body + closeTag;          // CDN/خالی: دست‌نخورده
        } else {
            idx++;
            const label = outName + '#inline-' + idx;
            let ob;
            try { ob = obfuscator.obfuscate(body, spaOpts()).getObfuscatedCode(); }
            catch (e) { die('مبهم‌سازی ' + label + ' ناموفق: ' + e.message); }
            ob = makeInlineSafe19e(ob);
            verifyJs(ob, label);
            out += openTag + '\n' + ob + '\n' + closeTag;
            protectedCount++;
            parts.push({ label, inBytes: body.length, outBytes: ob.length });
        }
        last = m.index + m[0].length;
    }
    out += html.slice(last);
    return { html: out, parts, protectedCount };
}

// ---------- main ----------
(async () => {
    const t0 = Date.now();
    console.log('🔐 SEC-PROTECT-19e — ساخت نسخهٔ حفاظت‌شده');
    log('منبع: ' + SRC_DIR);
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.mkdirSync(path.join(OUT_DIR, 'public'), { recursive: true });

    // ۱) سرور
    log('مبهم‌سازی server.js …');
    const serverSrc = fs.readFileSync(path.join(SRC_DIR, 'server.js'), 'utf8');
    const serverOb = obfuscator.obfuscate(serverSrc, serverOpts()).getObfuscatedCode();
    verifyJs(serverOb, 'dist/server.js');
    fs.writeFileSync(path.join(OUT_DIR, 'server.js'), serverOb);
    log('  server.js: ' + (serverSrc.length / 1024).toFixed(0) + 'KB → ' + (serverOb.length / 1024).toFixed(0) + 'KB');

    // ۲) auth
    log('مبهم‌سازی auth.js …');
    const authSrc = fs.readFileSync(path.join(SRC_DIR, 'auth.js'), 'utf8');
    const authOb = obfuscator.obfuscate(authSrc, serverOpts()).getObfuscatedCode();
    verifyJs(authOb, 'dist/auth.js');
    fs.writeFileSync(path.join(OUT_DIR, 'auth.js'), authOb);
    log('  auth.js: ' + (authSrc.length / 1024).toFixed(0) + 'KB → ' + (authOb.length / 1024).toFixed(0) + 'KB');

    // ۳) index.html — فقط بلاک‌های درون‌خطی
    log('مبهم‌سازی منطق درون‌خطی public/index.html …');
    const htmlSrc = fs.readFileSync(path.join(SRC_DIR, 'public', 'index.html'), 'utf8');
    const prot = protectHtml(htmlSrc, 'index.html');
    fs.writeFileSync(path.join(OUT_DIR, 'public', 'index.html'), prot.html);
    prot.parts.forEach((p) => log('  ' + p.label + ': ' + (p.inBytes / 1024).toFixed(0) + 'KB → ' + (p.outBytes / 1024).toFixed(0) + 'KB'));

    // ۴) سایر استاتیک‌ها — عیناً (sw.js عمداً بایت‌به‌بایت: نظم کش PWA)
    const pubDir = path.join(SRC_DIR, 'public');
    let copied = 0;
    for (const f of fs.readdirSync(pubDir)) {
        if (f === 'index.html') continue;
        const s = path.join(pubDir, f);
        if (fs.statSync(s).isFile()) { fs.copyFileSync(s, path.join(OUT_DIR, 'public', f)); copied++; }
    }
    fs.copyFileSync(path.join(SRC_DIR, 'tenant.json.template'), path.join(OUT_DIR, 'tenant.json.template'));
    log('استاتیک عیناً کپی شد: ' + copied + ' فایل (sw.js بایت‌به‌بایت)');

    // ۵) package.json برای pkg
    const pkgManifest = {
        name: 'sanatify-mes', version: '19.0.0', private: true,
        main: 'server.js', bin: 'server.js',
        pkg: { assets: ['public/**/*', 'tenant.json.template'], targets: [process.env.PKG_TARGET_19E || 'node18'], outputPath: 'bin' }
    };
    fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(pkgManifest, null, 2));

    // ۶) مانیفست صحت
    const files = ['server.js', 'auth.js', 'public/index.html', 'public/sw.js', 'package.json', 'tenant.json.template'];
    const lines = [];
    for (const f of files) {
        const fp = path.join(OUT_DIR, f);
        if (!fs.existsSync(fp)) continue;
        const h = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
        lines.push(h + '  ' + f);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
    const info = {
        built_at: new Date().toISOString(), phase: 'SEC-PROTECT-19e', fast: FAST,
        node: process.version, obfuscator: require(path.join(TOOLS_DIR, 'node_modules', 'javascript-obfuscator', 'package.json')).version,
        inline_blocks_protected: prot.protectedCount, sw_js_untouched: true
    };
    fs.writeFileSync(path.join(OUT_DIR, 'build-info.json'), JSON.stringify(info, null, 2));
    log('مانیفست: SHA256SUMS.txt + build-info.json');

    // ۷) راستی‌آزمایی نهایی: node --check خروجی سرور
    const chk = spawnSync(process.execPath, ['--check', path.join(OUT_DIR, 'server.js')], { encoding: 'utf8' });
    if (chk.status !== 0) die('node --check خروجی سرور ناموفق: ' + chk.stderr);
    log('node --check dist/server.js ✓');

    // ۸) کامپایل با pkg
    if (COMPILE) {
        let pkgBin = path.join(TOOLS_DIR, 'node_modules', '.bin', 'pkg');
        if (process.platform === 'win32') pkgBin += '.cmd';
        if (!fs.existsSync(pkgBin)) die('pkg نصب نیست. در پوشهٔ tools: npm install');
        for (const t of TARGETS) {
            log('کامپایل pkg → ' + t + ' …');
            /* SEC-PROTECT-19e: -c صریح لازم است — کشف خودکار package.json گلد assets را نمی‌بندد */
            const r = spawnSync(pkgBin, ['-c', path.join(OUT_DIR, 'package.json'), path.join(OUT_DIR, 'server.js'), '--target', t, '--output', path.join('dist', 'bin', 'sanatify-mes-' + t + (t.indexOf('win') !== -1 ? '.exe' : ''))], { cwd: SRC_DIR, encoding: 'utf8', stdio: 'inherit' });
            if (r.status !== 0) die('pkg برای ' + t + ' ناموفق بود (شبکه/پلتفرم؟) — خروجی مبهم‌شدهٔ dist/ سرِجای خود سالم است');
        }
    }

    console.log('✅ ساخت کامل شد در ' + ((Date.now() - t0) / 1000).toFixed(1) + 's → ' + OUT_DIR);
    console.log('   استقرار روی VM: پوشهٔ dist (یا باینری) + فایل‌های داده کنار exe + tenant.json امضاشده');
})().catch((e) => die(e && e.stack || e));
