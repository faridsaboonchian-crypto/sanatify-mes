const fs = require('fs');
const vm = require('vm');
const HP = 'public/index.html';
let h = fs.readFileSync(HP, 'utf8');
const bak = HP + '.bak_dup';
fs.writeFileSync(bak, h);
const log = [];

const startMark = "html += '<h3 style=\"margin:14px 0 6px\">تولید این بچ (";
const consMark = "html += buildMiniTable(g.consumed_materials";
const i = h.indexOf(startMark);
if (i === -1) { log.push('duplicate block NOT found - nothing changed'); }
else {
    const j = h.indexOf(consMark, i);
    if (j === -1) { log.push('consumed table not found after marker - nothing changed'); }
    else {
        const k = h.indexOf(";\n", j);
        if (k === -1) { log.push('end of statement not found - nothing changed'); }
        else {
            h = h.slice(0, i) + h.slice(k + 2);
            log.push('duplicate production+consumed block REMOVED');
        }
    }
}

// اعتبارسنجی سینتکس قبل از ذخیره
const a = h.lastIndexOf('<script>'); const b = h.lastIndexOf('</' + 'script>');
let ok = true;
try { new vm.Script(h.slice(a + 8, b)); } catch (e) { ok = false; log.push('SYNTAX ERROR: ' + e.message); }
if (ok) { fs.writeFileSync(HP, h, 'utf8'); log.push('saved OK'); } else { log.push('NOT saved (syntax guard)'); }
console.log(log.join('\n'));