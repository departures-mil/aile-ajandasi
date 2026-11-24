// Electron açılış testleri: gerçek ana süreç + preload + arayüz (xvfb, --no-sandbox). Electron yoksa atlanır.
//  1) geliştirme kipi: çekirdek başlar, tam ekran, 4 pencere düğmesi, Güncelle düğmesi, kanal win-app
//  2) kurulu kip: taşınabilir sürümün bıraktığı eski-konum.json'dan veri KOPYALANIR (orijinal yerinde kalır)
//  3) taşınabilir kip: veri yeri değişmez, kanal win-setup, eski-konum.json yazılır, "Yeni kurulum gerekli" penceresi
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let electron = null;
try { electron = require('electron'); } catch (e) { }
const needX = process.platform === 'linux' && !process.env.DISPLAY;
const hasXvfb = !needX || spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0;
const skip = !electron || typeof electron !== 'string' ? 'electron yok' : !hasXvfb ? 'xvfb-run yok' : false;

function run(env) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-ud-'));
  const args = [path.join(ROOT, 'desktop'), '--no-sandbox', '--disable-gpu', '--user-data-dir=' + userData];
  const cmd = needX ? 'xvfb-run' : electron;
  const full = needX ? ['-a', '-s', '-screen 0 1600x1000x24', electron].concat(args) : args;
  const r = spawnSync(cmd, full, { encoding: 'utf8', timeout: 100000, env: Object.assign({}, process.env, { AJANDAM_SMOKE: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }, env) });
  const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('AJ_SMOKE '));
  assert.ok(line, 'çıktı yok: ' + (r.stdout || '') + (r.stderr || '').slice(-2000));
  const o = JSON.parse(line.slice(9));
  console.log(o);
  return o;
}
const oldData = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-eski-'));
  const now = Date.now();
  fs.writeFileSync(path.join(d, 'data.json'), JSON.stringify({ docs: { a1: { id: 'a1', kind: 'task', title: 'Eski görev', ua: now, ca: now }, a2: { id: 'a2', kind: 'shop', title: 'Süt', ua: now, ca: now } }, me: { id: 'dx', name: 'Test' }, settings: { lang: 'tr' }, sync: { enabled: false }, arsiv: [] }));
  fs.writeFileSync(path.join(d, 'prefs.json'), JSON.stringify({ lang: 'tr', lanKey: 'ABCDEFGH' }));
  fs.mkdirSync(path.join(d, 'photos')); fs.writeFileSync(path.join(d, 'photos', 'p1.jpg'), 'jpg');
  return d;
};

test('Electron (geliştirme kipi): pencere, çekirdek, tam ekran, üst çubuk', { skip, timeout: 120000 }, () => {
  const o = run({ AJANDAM_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'aj-data-')) });
  assert.deepStrictEqual(o.errors, []);
  assert.strictEqual(o.fc, true, 'FC çekirdeği yüklü');
  assert.strictEqual(o.host, 'electron', 'fcHost tanındı (contextIsolation kapalıyken de)');
  assert.strictEqual(o.android, true, 'uygulama köprüsü window.Android');
  assert.strictEqual(o.version, require('../desktop/package.json').version);
  assert.strictEqual(o.appVersion, require('../desktop/package.json').version);
  assert.strictEqual(o.topbar, true);
  assert.strictEqual(o.winBtns, 4, 'Küçült · Orta · Tam ekran · Kapat');
  assert.strictEqual(o.updateBtn, true, 'Güncelle düğmesi her zaman görünür');
  assert.strictEqual(o.tabs, 8);
  assert.strictEqual(o.scheme, 'falcon');
  assert.strictEqual(o.channel, 'win-app');
  assert.strictEqual(o.fullscreen, true, 'her açılışta tam ekran');
  assert.strictEqual(o.ok, true);
});

test('Electron (kurulu kip): taşınabilir sürümün verisi kopyalanır, orijinal kalır', { skip, timeout: 120000 }, () => {
  const old = oldData();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-home-'));
  fs.writeFileSync(path.join(home, 'eski-konum.json'), JSON.stringify({ data: old }));
  const o = run({ AJANDAM_MODE: 'installed', AJANDAM_HOME: home });
  assert.strictEqual(o.mode, 'installed');
  assert.strictEqual(o.data, path.join(home, 'data'));
  assert.ok(o.docs >= 2, 'eski kayıtlar yüklendi');
  assert.strictEqual(o.migrated, true);
  assert.ok(fs.existsSync(path.join(home, 'data', 'photos', 'p1.jpg')), 'fotoğraflar kopyalandı');
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, 'data', 'prefs.json'), 'utf8')).lanKey, 'ABCDEFGH', 'Wi-Fi anahtarı / aile bağlantısı (prefs) kopyalandı');
  assert.ok(fs.existsSync(path.join(old, 'data.json')) && fs.existsSync(path.join(old, 'photos', 'p1.jpg')), 'orijinal veri yerinde');
  assert.deepStrictEqual(o.errors, []);
});

test('Electron (taşınabilir kip): veri yeri aynı, kanal win-setup, eski-konum.json, köprü penceresi', { skip, timeout: 120000 }, () => {
  const old = oldData();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-home-'));
  const o = run({ AJANDAM_MODE: 'portable', AJANDAM_HOME: home, AJANDAM_DATA: old });
  assert.strictEqual(o.mode, 'portable');
  assert.strictEqual(o.data, old);
  assert.strictEqual(o.channel, 'win-setup');
  assert.strictEqual(o.portable, true);
  assert.ok(o.docs >= 2);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(home, 'eski-konum.json'), 'utf8')).data, old);
  assert.match(o.modal, /Yeni kurulum gerekli|New installer|مثبّت/);
  assert.deepStrictEqual(o.errors, []);
});
