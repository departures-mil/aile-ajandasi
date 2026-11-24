#!/usr/bin/env node
// Derlemeden önce ortak arayüzü (www/) kabuklara kopyalar:
//   www/ → desktop/www/                         (Electron; electron-builder app.asar'a koyar)
//   www/ → android/app/src/main/assets/www/     (Android; twemoji/ klasörü yerinde kalır)
// Kopyalar depoda tutulmaz (.gitignore). Önce sürüm dosyaları denetlenir.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'www');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n), d = path.join(dst, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function clean(dir, keep) {
  if (!fs.existsSync(dir)) return;
  for (const n of fs.readdirSync(dir)) if (!keep.includes(n)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
}
function run() {
  const desk = path.join(ROOT, 'desktop', 'www');
  fs.rmSync(desk, { recursive: true, force: true });
  copyDir(SRC, desk);
  const tw = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www', 'twemoji');   // emoji simgeleri (tek kopya)
  if (fs.existsSync(tw)) copyDir(tw, path.join(desk, 'twemoji'));
  const andr = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'www');
  clean(andr, ['twemoji']);
  copyDir(SRC, andr);
}
module.exports = { run, copyDir };
if (require.main === module) {
  const s = require('./surum.js');
  const bad = s.targets(s.version()).filter(([f, c]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== c);
  if (bad.length) { console.error('Sürüm dosyaları güncel değil → node tools/surum.js'); process.exit(1); }
  run();
  console.log('www → desktop/www, android/app/src/main/assets/www');
}
