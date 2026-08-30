const { spawn } = require('child_process');
const path = require('path');

// 1. آدرس دقیق پوشه نود
const NODE_PATH = 'C:\\Program Files\\nodejs';
const NODE_EXE = path.join(NODE_PATH, 'node.exe');

// 2. آدرس فایل اصلی EAS
const EAS_SCRIPT = path.join(__dirname, 'node_modules', 'eas-cli', 'bin', 'run');

// 3. اصلاح محیط سیستم (تزریق مسیر نود به حافظه)
const env = { 
    ...process.env, 
    PATH: `${NODE_PATH};${process.env.PATH}`, // مسیر نود را به اولویت اول می‌آورد
    EAS_NO_VCS: '1' // حذف نیاز به گیت
};

console.log("========================================");
console.log("   STARTING JS BUILDER (SAFE MODE)      ");
console.log("========================================");

// 4. اجرای دستور ساخت (بدون Shell برای حل مشکل فاصله)
const child = spawn(NODE_EXE, [EAS_SCRIPT, 'build', '-p', 'android', '--profile', 'preview'], {
    env: env,
    stdio: 'inherit', // نمایش لاگ‌ها
    // shell: true <-- این خط را حذف کردیم چون باعث ارور C:\Program می‌شد
});

child.on('error', (err) => {
    console.error('CRITICAL ERROR:', err);
});

child.on('close', (code) => {
    console.log(`\n=== PROCESS FINISHED (Code: ${code}) ===`);
    console.log("If successful, download link is above.");
});