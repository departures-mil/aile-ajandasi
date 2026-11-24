#!/usr/bin/env node
// Tek sürüm kaynağı: desktop/package.json "version" (semver X.Y.Z) + release-notes.json →
//   www/surum.js (window.APP_RELEASE), kök package.json, android/app/build.gradle (versionName + versionCode).
//   node tools/surum.js            → hepsini desktop/package.json'a göre yeniden yazar
//   node tools/surum.js 5.8.0      → sürümü 5.8.0 yapar, sonra yazar
//   node tools/surum.js --check    → biri güncel değilse hata (npm test)
// versionCode = major*10000 + minor*100 + patch (5.7.0 → 50700; eski APK'lar ≤ 22, yeni hep büyük).
// Eski "5.6 / buildCode 39" ikili düzeni yalnız ESKİ kanal köprüsü için desktop/package.json "buildCode"da kalır.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = (...a) => path.join(ROOT, ...a);
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const R = f => fs.readFileSync(f, 'utf8');

function version() { return JSON.parse(R(P('desktop', 'package.json'))).version; }
function versionCode(v) { const m = SEMVER.exec(v); if (!m || +m[2] > 99 || +m[3] > 99) throw new Error('sürüm X.Y.Z olmalı (Y,Z ≤ 99): ' + v); return +m[1] * 10000 + +m[2] * 100 + +m[3]; }
function notes() {
  const n = JSON.parse(R(P('release-notes.json')));
  for (const l of ['tr', 'en', 'ar']) if (typeof n[l] !== 'string' || !n[l].trim()) throw new Error('release-notes.json: "' + l + '" eksik');
  return n;
}
function surumJs(v) {
  const n = notes();
  return '/* OTOMATİK: node tools/surum.js (kaynak: desktop/package.json + release-notes.json). Elle düzenlemeyin. */\n' +
    'window.APP_RELEASE = ' + JSON.stringify({ version: v, notes: { tr: n.tr, en: n.en, ar: n.ar } }, null, 1) + ';\n';
}
function gradle(v) {
  return R(P('android', 'app', 'build.gradle'))
    .replace(/versionCode\s+\d+/, 'versionCode ' + versionCode(v))
    .replace(/versionName\s+"[^"]*"/, 'versionName "' + v + '"');
}
function rootPkg(v) { const p = JSON.parse(R(P('package.json'))); p.version = v; return JSON.stringify(p, null, 2) + '\n'; }
function targets(v) {
  return [[P('www', 'surum.js'), surumJs(v)], [P('android', 'app', 'build.gradle'), gradle(v)], [P('package.json'), rootPkg(v)]];
}
module.exports = { version, versionCode, surumJs, targets };
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const bad = targets(version()).filter(([f, s]) => !fs.existsSync(f) || R(f) !== s).map(([f]) => path.relative(ROOT, f));
    if (bad.length) { console.error('güncel değil: ' + bad.join(', ') + ' → node tools/surum.js'); process.exit(1); }
    console.log('sürüm dosyaları güncel (' + version() + ')'); process.exit(0);
  }
  if (arg) {
    if (!SEMVER.test(arg)) { console.error('Sürüm X.Y.Z olmalı'); process.exit(1); }
    const f = P('desktop', 'package.json'), p = JSON.parse(R(f)); p.version = arg; fs.writeFileSync(f, JSON.stringify(p, null, 2) + '\n');
  }
  const v = version();
  for (const [f, s] of targets(v)) fs.writeFileSync(f, s);
  console.log('Sürüm ' + v + ' (Android versionCode ' + versionCode(v) + ') → www/surum.js, package.json, build.gradle');
}
