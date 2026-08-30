const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules', 'expo-modules-autolinking', 'scripts', 'android', 'autolinking_implementation.gradle');

console.log(`Checking file: ${filePath}`);

if (!fs.existsSync(filePath)) {
    console.error('[ERROR] File not found!');
    process.exit(1);
}

try {
    let content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let patched = false;

    const newLines = lines.map((line, index) => {
        // Look for the specific problematic line.
        // Based on logs, it's around line 333 and contains "com.android.library"
        if (line.includes('com.android.library') && !line.trim().startsWith('//')) {
            console.log(`[PATCHING] Line ${index + 1}: ${line.trim()}`);
            patched = true;
            return `// ${line}`; // Comment out the line
        }
        return line;
    });

    if (patched) {
        fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
        console.log('[SUCCESS] File patched successfully.');
    } else {
        console.log('[INFO] No matching lines found or file already patched.');
    }

} catch (err) {
    console.error('[CRITICAL ERROR] Failed to patch file:', err);
    process.exit(1);
}
