const fs = require('fs');
const vm = require('vm');

let html = fs.readFileSync('public/index.html', 'utf8');
let i = html.indexOf('<script>');
let j = html.lastIndexOf('</script>');
let js = html.slice(i + 8, j);

let open = 0, close = 0;
for (const c of js) {
  if (c === '{') open++;
  else if (c === '}') close++;
}

const diff = open - close;
console.log('Open braces: ' + open);
console.log('Close braces: ' + close);
console.log('Difference: ' + diff);

if (diff > 0) {
  console.log('Missing ' + diff + ' closing braces - adding them...');
  const fix = '\n' + '}'.repeat(diff) + '\n';
  js = js + fix;
  html = html.slice(0, i + 8) + js + html.slice(j);
  fs.writeFileSync('public/index.html', html, 'utf8');
  console.log('FIXED: Added ' + diff + ' closing braces');
} else if (diff < 0) {
  console.log('Extra ' + (-diff) + ' closing braces - removing them...');
  const removeCount = -diff;
  let newJs = js;
  for (let k = 0; k < removeCount; k++) {
    const lastClose = newJs.lastIndexOf('}');
    if (lastClose !== -1) {
      newJs = newJs.slice(0, lastClose) + newJs.slice(lastClose + 1);
    }
  }
  html = html.slice(0, i + 8) + newJs + html.slice(j);
  fs.writeFileSync('public/index.html', html, 'utf8');
  console.log('FIXED: Removed ' + removeCount + ' extra closing braces');
} else {
  console.log('Braces are balanced - no fix needed');
}

try {
  new vm.Script(html.slice(i + 8, j));
  console.log('SYNTAX OK');
} catch (e) {
  console.log('SYNTAX ERROR: ' + e.message);
}
