const fs = require('fs');

// ===== ردیاب مرگ سرور =====
fs.appendFileSync('death.log', '\n=== START ' + new Date().toISOString() + ' ===\n');

process.on('exit', (code) => {
  const msg = '[EXIT] code=' + code + ' at ' + new Date().toISOString();
  console.error(msg);
  fs.appendFileSync('death.log', msg + '\n');
});

process.on('uncaughtException', (err) => {
  const msg = '[UNCAUGHT] ' + err.stack;
  console.error(msg);
  fs.appendFileSync('death.log', msg + '\n');
});

process.on('unhandledRejection', (reason) => {
  const msg = '[UNHANDLED] ' + (reason && reason.stack ? reason.stack : reason);
  console.error(msg);
  fs.appendFileSync('death.log', msg + '\n');
});

process.on('SIGINT', () => {
  fs.appendFileSync('death.log', '[SIGINT] Ctrl+C received\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  fs.appendFileSync('death.log', '[SIGTERM] kill signal received\n');
  process.exit(0);
});

// ===== لود سرور اصلی =====
require('./server.js');
