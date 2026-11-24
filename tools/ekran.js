#!/usr/bin/env node
// Arayüz ekran görüntüleri (başsız Chromium, sahte kabuk): node tools/ekran.js <çıktı-klasörü>
// PLAYWRIGHT_CORE=/yol/playwright-core ve PLAYWRIGHT_BROWSERS_PATH ortamdan alınır. Ağ istekleri engellenir.
'use strict';
const path = require('path');
const fs = require('fs');
const pw = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const OUT = path.resolve(process.argv[2] || 'ekran');
require('./hazirla.js').run();   // desktop/www = www + twemoji
const URL0 = 'file://' + path.join(__dirname, '..', 'desktop', 'www', 'index.html');
fs.mkdirSync(OUT, { recursive: true });

function sample(lang) {
  const now = Date.now(), H = 3600000, D = 24 * H;
  const at = (d, h) => { const x = new Date(now + d * D); x.setHours(h, 0, 0, 0); return x.getTime(); };
  const docs = {};
  const add = (o) => { o.ca = o.ca || now - 5 * D; o.ua = o.ua || now - D; o.by = 'dme'; o.rem = o.rem || []; o.photos = o.photos || []; docs[o.id] = o; };
  add({ id: 'a1', kind: 'appt', sub: 'doctor', title: 'Diş kontrolü', when: at(0, 15), rem: [60] });
  add({ id: 'a2', kind: 'visit', title: 'Teyzemlere ziyaret', when: at(1, 19), rem: [60] });
  add({ id: 'a3', kind: 'appt', sub: 'lab', title: 'Kan tahlili', when: at(3, 9) });
  add({ id: 't1', kind: 'task', title: 'Faturaları öde', tcat: '', rem: [0] });
  add({ id: 't2', kind: 'task', title: 'Kombi bakımını ara', tcat: '', done: true });
  add({ id: 's1', kind: 'shop', title: 'Süt', qty: '2', cat: 'cat_market' });
  add({ id: 's2', kind: 'shop', title: 'Ekmek', cat: 'cat_bakery' });
  add({ id: 's3', kind: 'shop', title: 'Ağrı kesici', cat: 'cat_pharmacy' });
  [['pharmacy', '💊'], ['market', '🛒'], ['bakery', '🍞'], ['other', '📦']].forEach(([k, ic], i) => { docs['cat_' + k] = { id: 'cat_' + k, kind: 'lst', list: 'cat', key: k, icon: ic, name: '', order: i, def: true, ca: now, ua: now }; });
  return {
    docs, dirty: {}, delQ: [], photoUp: [], photoDel: [], tx: {}, alx: {},
    me: { id: 'dme', name: 'Deniz' }, settings: { lang, onlyMine: false, showDone: false },
    sync: { enabled: true, apiKey: 'AIzaSyDEMO', projectId: 'aile-demo', fid: 'ABCDE23456', familyName: 'Ailemiz', adminUid: 'u1', uid: 'u1', members: [{ uid: 'u1', name: 'Deniz' }, { uid: 'u2', name: 'Annem' }], lastSync: now - 120000, lastError: '' },
    arsiv: [{ at: now - 2 * H, src: 'lan', d: { id: 'x1', kind: 'task', title: 'Eski görev (başka cihazda silindi)', ua: now - 3 * D } }],
    lanBackup: [{ at: now - 5 * H, src: 'cloud', d: { id: 't1', kind: 'task', title: 'Faturaları öde (eski hal)', ua: now - 4 * D } }]
  };
}
const shots = [
  { name: 'tr-falcon-dark', lang: 'tr', theme: 'dark', scheme: 'falcon' },
  { name: 'ar-falcon-light', lang: 'ar', theme: 'light', scheme: 'falcon' },
  { name: 'tr-klasik', lang: 'tr', theme: 'light', scheme: 'klasik' },
  { name: 'tr-klasik-dark', lang: 'tr', theme: 'dark', scheme: 'klasik' },
  { name: 'tr-falcon-dark-ayarlar', lang: 'tr', theme: 'dark', scheme: 'falcon', page: 'settings', h: 3000 },
  { name: 'ar-falcon-light-ayarlar', lang: 'ar', theme: 'light', scheme: 'falcon', page: 'settings', h: 3000 },
  { name: 'tr-klasik-ayarlar', lang: 'tr', theme: 'light', scheme: 'klasik', page: 'settings', h: 3000 },
  { name: 'tr-falcon-dark-alisveris', lang: 'tr', theme: 'dark', scheme: 'falcon', tab: 'shop' },
  { name: 'tr-telefon-falcon-dark', lang: 'tr', theme: 'dark', scheme: 'falcon', phone: true },
  { name: 'ar-telefon-klasik', lang: 'ar', theme: 'light', scheme: 'klasik', phone: true },
  { name: 'tr-tasinabilir-kopru', lang: 'tr', theme: 'dark', scheme: 'falcon', mode: 'portable' },
  { name: 'tr-eski-telefon-kopru', lang: 'tr', theme: 'light', scheme: 'falcon', phone: true, legacyAndroid: true },
  { name: 'tr-ilk-acilis-firebase', lang: 'tr', theme: 'dark', scheme: 'falcon', onboarding: true }
];
(async () => {
  const browser = await pw.chromium.launch();
  const errors = [];
  for (const s of shots) {
    const vp = s.phone ? { width: 412, height: 900 } : { width: 1440, height: s.h || 900 };
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: s.phone ? 2 : 1 });
    await ctx.route(/^https?:/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(s.name + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) errors.push(s.name + ' console: ' + m.text()); });
    await page.addInitScript(({ s, data }) => {
      const set = (k, v) => localStorage.setItem('fc.' + k, JSON.stringify(v));
      set('lang', s.lang); set('theme', s.theme); set('scheme', s.scheme);
      if (!s.onboarding) { set('onboarding.done', true); set('whatsnew.seen', '5.7.0'); }
      const json = s.onboarding ? '' : JSON.stringify(data);
      const cb = (id, v) => setTimeout(() => window.__cb(id, JSON.stringify(v)), 20);
      const A = {
        load: () => json, save: () => true, photoUrl: () => '', deletePhotoLocal: () => true, pickPhoto: (id) => cb(id, []),
        http: (id) => cb(id, { status: 0, body: 'offline' }), httpTok: (id) => cb(id, { status: 0, body: 'offline' }), signIn: (id) => cb(id, { status: -1, body: '' }),
        uploadPhoto: (id) => cb(id, { status: 0 }), downloadPhoto: (id) => cb(id, { status: 0 }), getSync: () => '{}', setSync: () => true, uid: () => 'u1',
        setLang: () => true, deviceLang: () => s.lang, takeOpenDoc: () => '', share: () => {}, openMap: () => {}, dial: () => {}, copy: () => true, paste: () => '',
        toast: () => {}, setBarColor: () => {}, version: () => (s.legacyAndroid ? '5.2' : '5.7.0'), otaOk: () => true,
        lanIps: () => '[]', hasPhotoLocal: () => false, lanFind: (id) => cb(id, { ok: false }), lanHttp: (id) => cb(id, { status: 0 })
      };
      if (!s.phone) Object.assign(A, { platform: () => 'desktop', deskInfo: () => JSON.stringify({ mode: s.mode || 'installed', data: 'C:\\Users\\aile\\Masaüstü\\Ajandam\\data', fc: true, version: '5.7.0' }), importLegacy: (id) => cb(id, { ok: false, error: 'cancel' }), isFullScreen: () => true, toggleFullScreen: () => true, notifyNow: () => true });
      window.Android = A;
      if (s.phone && !s.legacyAndroid) window.AndroidBridge = { moveTaskToBack: () => {}, openExternal: () => {}, appVersion: () => '5.7.0', updateBegin: () => true, updateChunk: () => true, updateFinish: () => '{"ok":true}' };
      if (!s.phone) {
        const st = { fullscreen: true, half: false };
        window.fcHost = { kind: 'electron', platform: 'win32', version: '5.7.0', window: { minimize: async () => {}, half: async () => {}, toggleFullscreen: async () => {}, close: async () => {}, getState: async () => st, onState: () => () => {} }, update: { channel: s.mode === 'portable' ? 'win-setup' : 'win-app', applyPatch: async () => 'restarting', installFull: async () => 'restarting' } };
      }
    }, { s, data: sample(s.lang) });
    await page.goto(URL0);
    await page.waitForTimeout(1600);
    if (s.page === 'settings') { await page.evaluate(() => push({ type: 'settings' })); await page.waitForTimeout(600); }
    if (s.tab) { await page.evaluate((t) => { document.querySelector('[data-tab="' + t + '"]').click(); }, s.tab); await page.waitForTimeout(400); }
    if (s.onboarding) { await page.waitForTimeout(800); for (let i = 0; i < 2; i++) { await page.click('.fc-onboarding .modal-footer .btn.primary'); await page.waitForTimeout(250); } }
    await page.screenshot({ path: path.join(OUT, s.name + '.png'), fullPage: !!s.page });
    await ctx.close();
    console.log('✓', s.name);
  }
  await browser.close();
  if (errors.length) { console.error('HATALAR:\n' + errors.join('\n')); process.exitCode = 1; }
})();
