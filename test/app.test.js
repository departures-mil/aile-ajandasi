// Node duman testi (bağımlılıksız): sürüm, gömülü çekirdek, güncelleme planı (win-app / win-setup / android), FCD1,
// eski kanal köprüsü, eşitleme kuralı (hiçbir kayıt silinmez / üstüne yazılmaz), imza şifresi depoda yok, dosya bütünlüğü.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const desk = JSON.parse(R('desktop/package.json'));

test('tek semver sürüm: desktop/package.json = www/surum.js = build.gradle = package.json', () => {
  assert.match(desk.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(desk.name, 'aile-ajandasi', 'name DEĞİŞMEZ (veri yeri)');
  assert.strictEqual(desk.productName, 'Ajandam', 'productName DEĞİŞMEZ');
  const s = require('../tools/surum.js');
  for (const [f, c] of s.targets(desk.version)) assert.strictEqual(fs.readFileSync(f, 'utf8'), c, path.relative(ROOT, f) + ' eski: node tools/surum.js');
  const ctx = { window: {} }; vm.runInNewContext(R('www/surum.js'), ctx);
  assert.strictEqual(ctx.window.APP_RELEASE.version, desk.version);
  for (const l of ['tr', 'en', 'ar']) assert.ok(ctx.window.APP_RELEASE.notes[l].length > 40, 'not: ' + l);
  assert.ok(s.versionCode(desk.version) > 22, 'Android versionCode eski APK\'lardan (≤22) büyük');
  assert.strictEqual(s.versionCode('5.7.0'), 50700);
  assert.ok(desk.buildCode > 39, 'eski kanal köprüsü için buildCode > 39 (5.6)');
});

test('imza şifreleri depoda yok', () => {
  const g = R('android/app/build.gradle');
  assert.ok(!/storePassword\s+"/.test(g) && !/keyPassword\s+"/.test(g), 'build.gradle düz şifre içermemeli');
  assert.match(g, /System\.getenv\("AJANDAM_KS_PASS"\)|AJANDAM_KS_PASS/);
  assert.match(R('.gitignore'), /keystore\.properties/);
  assert.ok(!/ajandam-2026/.test(g + R('tools/apk.py') + R('.github/workflows/release.yml')));
});

test('gömülü ortak çekirdek: sürüm kaydı ve modüller', () => {
  for (const f of ['desktop/cekirdek/VERSION', 'www/cekirdek/VERSION']) assert.match(R(f), /^ortak-cekirdek [0-9a-f]{40}\n/);
  assert.ok(R('desktop/cekirdek/VERSION').startsWith(R('www/cekirdek/VERSION')), 'aynı çekirdek'); assert.match(R('desktop/cekirdek/VERSION'), /ebec004[0-9a-f]*/); assert.match(R('desktop/cekirdek/electron/fc-electron-main.js'), /isSetup\(meta\)/);
  delete globalThis.FC;
  require('../www/cekirdek/fc-core.js');
  const FC = globalThis.FC;
  for (const m of ['updater', 'topbar', 'settings', 'contact', 'crash', 'look', 'onboarding', 'whatsnew', 'announcements', 'progress', 'host', 'usage', 'lanMerge']) assert.ok(FC[m], 'FC.' + m);
  const H = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const man = { schema: 1, app: 'aile-ajandasi', version: '5.8.0', minVersion: '1.0.0', assets: {
    'win-app': { file: 'Ajandam-5.8.0-win-app.asar', size: 100, sha256: H('a'), patches: { '5.7.0': { file: 'Ajandam-win-app.patch-from-5.7.0.bin', size: 10, sha256: H('b') } } },
    'win-setup': { file: 'Ajandam-5.8.0-win-setup.exe', size: 200, sha256: H('c') },
    android: { file: 'Ajandam-5.8.0-android.apk', size: 300, sha256: H('d'), patches: { '5.7.0': { file: 'Ajandam-android.patch-from-5.7.0.bin', size: 30, sha256: H('e') } } } } };
  const o = { repo: 'aile-ajandasi', app: 'aile-ajandasi', version: '5.7.0', setupChannel: 'win-setup' };
  assert.strictEqual(FC.updater.plan(man, Object.assign({ channel: 'win-app' }, o)).mode, 'patch');
  assert.strictEqual(FC.updater.plan(man, Object.assign({ channel: 'android' }, o)).url, 'https://github.com/departures-mil/aile-ajandasi/releases/download/v5.8.0/Ajandam-android.patch-from-5.7.0.bin');
  // taşınabilir kip: sürüm "0.0.0" sayılır → kurulum programı (tam dosya)
  const pp = FC.updater.plan(man, { repo: 'aile-ajandasi', app: 'aile-ajandasi', version: '0.0.0', channel: 'win-setup' });
  assert.strictEqual(pp.mode, 'full'); assert.strictEqual(pp.channel, 'win-setup');
  assert.strictEqual(FC.updater.plan(man, Object.assign({ channel: 'win-app' }, o, { version: '5.8.0' })), null);
});

test('FCD1 yama uygulayıcı (Electron) — FORMAT.md test vektörü', () => {
  const { applyFcd1 } = require('../desktop/cekirdek/electron/fcd1.js');
  const zlib = require('zlib');
  const sha = (b) => crypto.createHash('sha256').update(b).digest();
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const src = Buffer.alloc(0), dst = Buffer.from('abc');
  const patch = Buffer.concat([Buffer.from('FCD1'), Buffer.from([1]), u64(0), sha(src), u64(3), sha(dst), zlib.deflateSync(Buffer.from([2, 3, 0x61, 0x62, 0x63, 0]))]);
  assert.strictEqual(applyFcd1(src, patch).toString(), 'abc');
  assert.throws(() => applyFcd1(Buffer.from('x'), patch));
});

test('Wi-Fi birleştirme: çakışmada eski hal yedeğe, uzak silme arşive (kalıcı silme yok)', () => {
  const ctx = { window: {}, document: { addEventListener() {}, createElement: () => ({ style: {} }), head: { appendChild() {} } }, console };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(R('www/lan.js'), ctx);
  const L = ctx.LanCore;
  const a = { docs: { x: { id: 'x', t: 'eski', ua: 1 }, y: { id: 'y', t: 'kalır', ua: 1 } }, dels: {} };
  const b = { docs: { x: { id: 'x', t: 'yeni', ua: 2 } }, dels: { y: 5 } };
  const m = L.merge(a, b);
  assert.strictEqual(m.docs.x.t, 'yeni');
  assert.strictEqual(m.conflicts.length, 1); assert.strictEqual(m.conflicts[0].t, 'eski');
  assert.ok(!m.docs.y, 'karşıda silinen');
  const app = R('www/app.js');
  // uygulama: birleştirmede düşen kayıt arşivlenir, çakışma yedeklenir (sınırsız), bulut çekişinde fotoğraf dosyası silinmez
  const lanApply = app.slice(app.indexOf('function lanApply'), app.indexOf('LanCore.init('));
  assert.match(lanApply, /archiveDoc\(before\[id\], 'lan'\)/);
  assert.match(lanApply, /S\.lanBackup = merged\.conflicts\.map/);
  assert.ok(!/slice\(0, 300\)/.test(lanApply), 'yedekler kesilmez');
  const sync = app.slice(app.indexOf('async function syncNow'), app.indexOf('async function ensureSignedIn'));
  assert.match(sync, /archiveDoc\(S\.docs\[id\], 'cloud'\)/);
  assert.match(sync, /backupDoc\((mine|theirs), 'cloud'\)/);
  assert.ok(!/deletePhotoLocal/.test(sync), 'eşitleme fotoğraf dosyası silmez');
  assert.match(app, /function restoreFrom/);
});

test('eski kanal köprüsü: paket yeni arayüz + yeni main.js içerir, eski güncelleyicilerle uyumlu', () => {
  const out = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aj-kopru-'));
  const r = spawnSync('python3', [path.join(ROOT, 'tools/kopru.py'), '--dry-run', '--out', out], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const man = JSON.parse(fs.readFileSync(path.join(out, 'upd_latest.json'), 'utf8'));
  assert.ok(man.code > 39, 'eski karşılaştırma (code > 39) yeni sürümü görür');
  const b = JSON.parse(require('zlib').gunzipSync(fs.readFileSync(path.join(out, man.file))).toString('utf8'));
  assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, man.file))).digest('hex'), man.sha);
  const files = Object.keys(b.files);
  assert.ok(files.every((f) => /^(www|desktop)\//.test(f) && !f.includes('..')), 'eski güncelleyiciler yalnız www/ ve desktop/ yazar');
  for (const need of ['www/index.html', 'www/kabuk.js', 'www/app.js', 'www/surum.js', 'www/cekirdek/fc-core.js', 'www/cekirdek/css/core.css', 'desktop/main.js', 'desktop/preload.js', 'desktop/lan-server.js', 'desktop/package.json', 'desktop/cekirdek/electron/fc-electron-main.js', 'desktop/cekirdek/electron/fc-preload.js', 'desktop/cekirdek/electron/fcd1.js']) assert.ok(files.includes(need), need);
  assert.ok(!files.some((f) => /\.(woff2|png|jpg|svg|exe)$/.test(f)), 'ikili dosya yok (eski güncelleyici metin yazar)');
  assert.ok(!files.some((f) => f.startsWith('desktop/www/')), 'desktop/www kopyası pakette yok');
});

test('tüm arayüz, ana süreç ve araç dosyaları sözdizimi olarak geçerli; eski kopya modüller kaldırıldı', () => {
  const files = ['desktop/main.js', 'desktop/preload.js', 'desktop/lan-server.js', 'tools/surum.js', 'tools/hazirla.js', 'tools/ekran.js']
    .concat(fs.readdirSync(path.join(ROOT, 'www')).filter((f) => f.endsWith('.js')).map((f) => 'www/' + f));
  for (const f of files) assert.doesNotThrow(() => new vm.Script(R(f), { filename: f }), f);
  for (const old of ['www/kullanim.js', 'www/kullanim-baslat.js', 'www/duyuru.js', 'www/duyuru-baslat.js']) assert.ok(!fs.existsSync(path.join(ROOT, old)), old + ' çekirdekle değişti');
  const main = R('desktop/main.js');
  assert.ok(!/async function doApply|updateApply: \(\) =>/.test(main), 'eski raw güncelleyici (masaüstü) kaldırıldı');
  assert.match(main, /fc\.install\(win, \{ channel: PORTABLE \? 'win-setup' : 'win-app' \}\)/);
  const app = R('www/app.js');
  assert.ok(!/function checkUpdate|function doUpdate|function sendContact/.test(app), 'eski güncelleme / iletişim kodu kaldırıldı');
  assert.match(R('android/app/src/main/java/com/ajandam/app/MainActivity.java'), /new FcBridge\(this\), "AndroidBridge"/);
  assert.match(R('android/app/src/main/java/com/ajandam/app/Updater.java'), /BUILTIN_WWW_CODE = 1000/);
});

test('index.html: başvurulan her dosya var, sıra doğru; Ayarlar\'da iletişim en sonda', () => {
  const html = R('www/index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  for (const r of refs) assert.ok(fs.existsSync(path.join(ROOT, 'www', r)), 'eksik: ' + r);
  const pos = (s) => html.indexOf(s);
  assert.ok(pos('cekirdek/css/tokens.css') < pos('cekirdek/css/core.css') && pos('cekirdek/css/core.css') < pos('style.css'));
  assert.ok(pos('cekirdek/fc-core.js') < pos('kabuk.js') && pos('kabuk.js') < pos('app.js'));
  const app = R('www/app.js');
  const st = app.slice(app.indexOf('function renderSettings'), app.indexOf('/* 5.7: "Admin ile iletişim"'));
  assert.ok(st.trim().endsWith('}') && /<div id="fcAyarlar"><\/div>`;\s*}\s*$/.test(st), 'çekirdek kartları (iletişim en sonda) Ayarlar\'ın sonunda');
  const k = R('www/kabuk.js');
  assert.match(k, /registerScheme\('klasik'/);
  assert.match(k, /firebase: true, ai: false/);
  assert.match(k, /HER AİLE KENDİ/);
});
