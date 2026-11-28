'use strict';
/* Ajandam — Electron ana süreç (5.7.0: ortak çekirdek).
   Pencere, tam ekran açılış, sağ üst pencere düğmeleri, GitHub Releases güncellemesi (yama + tam dosya) ve ana süreç hata
   raporu ortak çekirdekten gelir (cekirdek/electron/fc-electron-main.js). Burada uygulamaya özgü köprü (window.Android) kalır.

   Üç kip:
   - kurulu  (NSIS, app.asar)   : veri %APPDATA%\Ajandam\data ; güncelleme kanalı win-app (app.asar yaması / tam dosya)
   - taşınabilir (≤5.6 kurulumu, eski kanal köprüsüyle bu main.js'i almış): veri exe'nin yanındaki data\ (DEĞİŞMEZ);
                                   "Güncelle" kurulum programını (win-setup) indirir, eski veri yerini bildirir, kurar
   - geliştirme (npm start)      : veri desktop/data
   Kurulu sürüm ilk açılışta, taşınabilir sürümün bıraktığı işaretten (eski-konum.json) eski veriyi KOPYALAR (orijinale dokunmaz). */
const { app, BrowserWindow, ipcMain, dialog, nativeImage, Notification, Tray, Menu, shell, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

let fc = null, fcError = '';
try { fc = require('./cekirdek/electron/fc-electron-main'); } catch (e) { fcError = String(e && e.message || e); }

const PKG = require('./package.json');
const VERSION = PKG.version;
const TEST = process.env.AJANDAM_SMOKE ? process.env.AJANDAM_MODE : '';    // yalnız açılış testi kipleri dener
const INSTALLED = TEST ? TEST === 'installed' : app.isPackaged && /\.asar$/i.test(__dirname);
const PORTABLE = TEST ? TEST === 'portable' : app.isPackaged && !INSTALLED;
const MODE = INSTALLED ? 'installed' : PORTABLE ? 'portable' : 'dev';
const HOME = (process.env.AJANDAM_SMOKE && process.env.AJANDAM_HOME) || path.join(app.getPath('appData'), 'Ajandam');   // %APPDATA%\Ajandam
const DATA = (process.env.AJANDAM_SMOKE && process.env.AJANDAM_DATA) || (INSTALLED ? path.join(HOME, 'data') : path.join(PORTABLE ? path.dirname(process.execPath) : __dirname, 'data'));
const POINTER = path.join(HOME, 'eski-konum.json');                        // taşınabilir sürümün veri yeri (kurulu sürüm için)
const PHOTOS = path.join(DATA, 'photos');

/** Kurulu sürümün ilk açılışı: taşınabilir sürümün verisini kopyalar (orijinal yerinde kalır, hiçbir şey silinmez). */
function copyTree(src, dst, skip) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const n of fs.readdirSync(src)) { if (skip && skip(n)) continue; try { copyTree(path.join(src, n), path.join(dst, n), skip); } catch (e) { /* kilitli önbellek dosyası */ } }
  } else if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
}
const SKIP_CACHE = n => /^(Cache|Code Cache|GPUCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|ShaderCache|GrShaderCache|Crashpad|blob_storage|LOCK|lockfile|SingletonLock|SingletonCookie|SingletonSocket)$/i.test(n);
function migrateFrom(oldData, why) {
  if (!oldData || path.resolve(oldData) === path.resolve(DATA) || !fs.existsSync(path.join(oldData, 'data.json'))) return false;
  if (fs.existsSync(path.join(DATA, 'data.json'))) {   // burada zaten veri var: önce yedek (üstüne yazılmaz)
    const bak = path.join(DATA, 'yedek-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(bak, { recursive: true });
    for (const f of ['data.json', 'prefs.json']) { try { fs.renameSync(path.join(DATA, f), path.join(bak, f)); } catch (e) { /* yok */ } }
  }
  copyTree(oldData, DATA, SKIP_CACHE);
  fs.writeFileSync(path.join(DATA, 'tasindi.json'), JSON.stringify({ from: oldData, at: new Date().toISOString(), why }));
  return true;
}
if (INSTALLED && !fs.existsSync(path.join(DATA, 'data.json'))) {
  try { const p = JSON.parse(fs.readFileSync(POINTER, 'utf8')); migrateFrom(p.data, 'portable'); } catch (e) { /* işaret yok: yeni kurulum */ }
}
if (PORTABLE) {   // kurulu sürüm sonradan bu verileri bulabilsin
  try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(POINTER, JSON.stringify({ data: DATA, exe: process.execPath, version: VERSION, at: new Date().toISOString() })); } catch (e) { /* yazılamadı */ }
}
fs.mkdirSync(PHOTOS, { recursive: true });
app.setPath('userData', path.join(DATA, 'electron'));
app.setAppUserModelId('com.aile.uygulamasi.desktop');

const DATA_FILE = path.join(DATA, 'data.json');
const PREFS_FILE = path.join(DATA, 'prefs.json');
const ICON = path.join(__dirname, 'icon.png');

let win = null;
let tray = null;
let quitting = false;
let pendingDoc = '';

/* ---------- eski güncelleme kanalı (raw guncelleme/upd_latest.json, ECDSA imzalı) ----------
   Masaüstü artık GitHub Releases'tan güncellenir (ortak çekirdek). Bu kanal yalnız ESKİ telefon uygulamalarına (APK ≤5.2,
   güncellemeyi ailenin Firebase'inden alanlar) köprü paketini aktarmak için okunur. */
/** Field "data" of families/{fid}/photos/{id}, or null when the document does not exist. */
const GITHUB_RAW = 'https://raw.githubusercontent.com/departures-mil/aile-ajandasi/main/guncelleme/';

/** GET with a live byte count; gives up when nothing arrives for 25 s. Returns { status, buf }. */
async function download(url, onBytes) {
  const ctl = new AbortController();
  let idle = null;
  const kick = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 25000); };
  let got = 0;
  try {
    kick();
    const r = await net.fetch(url, { signal: ctl.signal, cache: 'no-store' });
    const chunks = [];
    const reader = r.body.getReader();
    for (;;) {
      kick();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      got += value.length;
      if (onBytes) onBytes(value.length);
    }
    if (r.status !== 200 && got && onBytes) onBytes(-got);
    return { status: r.status, buf: Buffer.concat(chunks) };
  } catch (e) {
    if (got && onBytes) onBytes(-got); // this try is thrown away; the retry starts the count again
    return { status: 0, buf: Buffer.from(ctl.signal.aborted ? 'timeout' : String(e && e.message || e)) };
  } finally {
    clearTimeout(idle);
  }
}

/** A file from the GitHub update channel, with retries; null when it does not exist. */
async function ghFile(name, onBytes) {
  let r = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    r = await download(GITHUB_RAW + name + (onBytes ? '' : '?t=' + Date.now()), onBytes);
    if (r.status === 200 || r.status === 404) break;
    await new Promise(res => setTimeout(res, 1500 + attempt * 2500));
  }
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(r.status ? 'HTTP ' + r.status : (r.buf.toString() || 'network'));
  return r.buf;
}

async function updateManifest() {
  const b = await ghFile('upd_latest.json');
  return b ? JSON.parse(b.toString('utf8')) : null;
}

async function updateManifest() {
  const b = await ghFile('upd_latest.json');
  return b ? JSON.parse(b.toString('utf8')) : null;
}

/* ---------- telefon güncellemesinin aktarılması (GitHub → ailenin Firebase'i) ----------
 * Telefon uygulaması (APK 4.7) güncellemeyi ailenin Firestore'undaki families/{fid}/photos/upd_* belgelerinden alır.
 * Masaüstü, GitHub'daki imzalı paket ailedekinden yeniyse onu oraya da koyar; böylece tek GitHub yayını telefona da ulaşır.
 * Paket geliştiricinin anahtarıyla imzalıdır, telefon imzayı yine kendisi doğrular (aktaran cihaz paketi değiştiremez). */
const RELAY_PART = 700000;
let relaying = false;
async function relayUpdateToFamily() {
  if (relaying) return;
  relaying = true;
  try {
    const cfg = syncConfig();
    if (!cfg.fid || !cfg.projectId || !cfg.apiKey) return;
    const man = await updateManifest();
    if (!man || !man.code || !man.file || !man.sha || !man.sig) return;
    const tok = await idToken();
    if (!tok) return;
    const base = `${docsBase()}/families/${cfg.fid}/photos`;
    const cur = await http('GET', `${base}/upd_latest`, null, null, tok, 30000);
    let fb = {};
    if (cur.status === 200) { try { fb = JSON.parse(JSON.parse(cur.body).fields.data.stringValue || '{}'); } catch (e) { fb = {}; } }
    else if (cur.status !== 404) return;
    if (Number(fb.code || 0) >= Number(man.code)) return;
    const buf = await ghFile(man.file);
    if (!buf || crypto.createHash('sha256').update(buf).digest('hex') !== man.sha) return;
    const b64 = buf.toString('base64');
    const parts = [];
    for (let i = 0; i < b64.length; i += RELAY_PART) parts.push(b64.slice(i, i + RELAY_PART));
    if (!parts.length) parts.push('');
    const put = async (id, data) => {
      for (let a = 0; a < 4; a++) {
        const r = await http('PATCH', `${base}/${id}`, JSON.stringify({ fields: { data: { stringValue: data } } }), null, tok, 120000);
        if (r.status === 200) return true;
        if (r.status === 403 || r.status === 400) return false;
        await new Promise(res => setTimeout(res, 2000 + a * 3000));
      }
      return false;
    };
    for (let i = 0; i < parts.length; i++) if (!(await put(`upd_b${man.code}_${i}`, parts[i]))) return;
    const out = Object.assign({}, fb, { code: man.code, version: man.version, notes: man.notes || '', parts: parts.length,
      partChars: parts.map(p => p.length), bytes: buf.length, sha: man.sha, sig: man.sig, published: man.published || Date.now() });
    await put('upd_latest', JSON.stringify(out));
  } catch (e) { /* bir sonraki denemede */ } finally { relaying = false; }
}

/* ---------- files ---------- */

function readText(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } }
function writeText(f, s) { const tmp = f + '.tmp'; fs.writeFileSync(tmp, s, 'utf8'); fs.renameSync(tmp, f); }
function prefs() { try { return JSON.parse(readText(PREFS_FILE) || '{}'); } catch (e) { return {}; } }
function setPrefs(p) { writeText(PREFS_FILE, JSON.stringify(p)); }
function photoFile(id) { return path.join(PHOTOS, String(id).replace(/[^A-Za-z0-9_-]/g, '') + '.jpg'); }
function syncConfig() { try { return JSON.parse(prefs().sync || '{}'); } catch (e) { return {}; } }
function docsBase() { return `https://firestore.googleapis.com/v1/projects/${syncConfig().projectId}/databases/(default)/documents`; }

/* ---------- http + auth (same flow as the phone app) ---------- */

async function http(method, url, body, contentType, token, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 60000);
  try {
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = contentType || 'application/json; charset=utf-8';
    // FormSubmit, Referer'sız isteği reddeder; etkinleştirilmiş site gönderilir
    if (/^https:\/\/formsubmit\.co\//.test(url)) { headers.Accept = 'application/json'; headers.Referer = 'https://formsubmit.co/'; headers.Origin = 'https://formsubmit.co'; }
    // FormSubmit isteği Node fetch ile (Chromium ağ katmanı Referer başlığını değiştirebilir)
    const r = await (/^https:\/\/formsubmit\.co\//.test(url) ? fetch : net.fetch)(url, { method, headers, body: body || undefined, signal: ctl.signal });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: ctl.signal.aborted ? 'timeout' : String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

let lastError = '';
async function ensureAccount() {
  const p = prefs();
  if (p.uid && p.refresh) return p.uid;
  const key = syncConfig().apiKey;
  if (!key) return null;
  const r = await http('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(key), '{"returnSecureToken":true}');
  if (r.status !== 200) { lastError = r.body; return null; }
  const j = JSON.parse(r.body);
  Object.assign(p, { uid: j.localId, refresh: j.refreshToken, idToken: j.idToken, idExp: Date.now() + (Number(j.expiresIn || 3600) - 120) * 1000 });
  setPrefs(p);
  return j.localId;
}

async function idToken() {
  if (!(await ensureAccount())) return null;
  const p = prefs();
  if (p.idToken && p.idExp > Date.now()) return p.idToken;
  const key = syncConfig().apiKey;
  const r = await http('POST', 'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(key),
    'grant_type=refresh_token&refresh_token=' + encodeURIComponent(p.refresh), 'application/x-www-form-urlencoded');
  if (r.status !== 200) { lastError = r.body; return null; }
  const j = JSON.parse(r.body);
  Object.assign(p, { idToken: j.id_token, refresh: j.refresh_token, idExp: Date.now() + (Number(j.expires_in || 3600) - 120) * 1000 });
  setPrefs(p);
  return j.id_token;
}

/* ---------- reminders ---------- */

let entries = [];
function rebuildReminders() {
  entries = [];
  try {
    const data = JSON.parse(readText(DATA_FILE) || '{}');
    const onlyMine = !!(data.settings && data.settings.onlyMine);
    const me = (data.me && data.me.id) || '';
    const alx = data.alx || {};
    Object.entries(data.docs || {}).forEach(([id, d]) => {
      if (!d || !d.al || !Array.isArray(d.al.t)) return;
      if (onlyMine && d.by !== me && d.for !== me) return;
      const lx = alx[id] || d.al;
      d.al.t.forEach(t => entries.push({ k: id + ':' + t, t, d: id, ti: lx.ti, b: lx.b }));
    });
  } catch (e) { /* ignore broken file */ }
}

function checkReminders() {
  const now = Date.now();
  const p = prefs();
  const fired = new Set(p.fired || []);
  let changed = false;
  entries.forEach(e => {
    if (e.t <= now && e.t > now - 30 * 60000 && !fired.has(e.k)) {
      fired.add(e.k);
      changed = true;
      if (Notification.isSupported()) {
        const n = new Notification({ title: e.ti || 'Ajandam', body: e.b || '', icon: ICON });
        n.on('click', () => { showWindow(); openDoc(e.d); });
        n.show();
      }
    }
  });
  if (changed) {
    p.fired = [...fired].filter(k => Number(k.split(':').pop()) > now - 2 * 86400000);
    setPrefs(p);
  }
}

function openDoc(id) {
  if (win) win.webContents.executeJavaScript(`window.openDoc && window.openDoc(${JSON.stringify(id)})`).catch(() => {});
  else pendingDoc = id;
}

/* ---------- photos ---------- */

async function pickPhoto() {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic'] }]
  });
  if (r.canceled) return [];
  const ids = [];
  for (const f of r.filePaths) {
    let img = nativeImage.createFromPath(f);
    if (img.isEmpty()) continue;
    const { width, height } = img.getSize();
    const scale = Math.min(1, 1280 / Math.max(width, height));
    if (scale < 1) img = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' });
    const id = 'p' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(photoFile(id), img.toJPEG(72));
    ids.push(id);
  }
  return ids;
}

/* ---------- bridge ---------- */

const syncCalls = {
  restartApp: () => { quitting = true; app.relaunch(); app.exit(0); return true; },
  otaOk: () => true,
  notifyNow: (title, body, docId) => {
    if (!Notification.isSupported()) return false;
    const n = new Notification({ title: title || 'Ajandam', body: body || '', icon: ICON });
    n.on('click', () => { showWindow(); if (docId) openDoc(docId); });
    n.show();
    return true;
  },
  load: () => readText(DATA_FILE) || '',
  save: s => { writeText(DATA_FILE, s); rebuildReminders(); return true; },
  photoUrl: id => { const f = photoFile(id); return fs.existsSync(f) ? 'file:///' + f.replace(/\\/g, '/').replace(/^\//, '') : ''; },
  deletePhotoLocal: id => { try { fs.unlinkSync(photoFile(id)); } catch (e) { /* missing */ } return true; },
  getSync: () => prefs().sync || '{}',
  setSync: s => {
    const p = prefs();
    const o = syncConfig();
    const n = JSON.parse(s);
    if (n.apiKey !== o.apiKey || n.projectId !== o.projectId) { delete p.uid; delete p.refresh; delete p.idToken; delete p.idExp; }
    p.sync = JSON.stringify(n);
    setPrefs(p);
    return true;
  },
  uid: () => prefs().uid || '',
  setLang: l => { const p = prefs(); p.lang = l; setPrefs(p); return true; },
  deviceLang: () => (app.getLocale() || 'tr').slice(0, 2),
  takeOpenDoc: () => { const d = pendingDoc; pendingDoc = ''; return d; },
  openMap: q => { shell.openExternal('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q)); return true; },
  copy: text => { clipboard.writeText(String(text)); return true; },
  paste: () => clipboard.readText(),
  version: () => VERSION,
  // 5.7: kabuk bilgisi (kip, veri yeri, çekirdek yüklendi mi) — arayüz taşınabilir kipte kurulum programına geçişi önerir
  deskInfo: () => JSON.stringify({ mode: MODE, data: DATA, fc: !!fc, fcError, version: VERSION, migrated: readText(path.join(DATA, 'tasindi.json')) || '' }),
  isFullScreen: () => !!(win && win.isFullScreen()),
  toggleFullScreen: () => { if (win) win.setFullScreen(!win.isFullScreen()); return !!(win && win.isFullScreen()); },
  // The in-app exit button: hide to the tray (reminders keep coming) or quit completely.
  closeWindow: () => { setTimeout(() => { if (win) { if (win.isFullScreen()) win.setFullScreen(false); win.close(); } }, 50); return true; },
  quitApp: () => { setTimeout(() => { quitting = true; app.quit(); }, 50); return true; }
};

const asyncCalls = {
  // 5.7: eski taşınabilir Ajandam klasöründen veri al (Ayarlar). Mevcut veri önce yedek klasörüne taşınır, hiçbir şey silinmez.
  importLegacy: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Ajandam' });
    if (r.canceled || !r.filePaths[0]) return { ok: false, error: 'cancel' };
    const dir = r.filePaths[0];
    const cand = [dir, path.join(dir, 'data')].find(d => fs.existsSync(path.join(d, 'data.json')));
    if (!cand) return { ok: false, error: 'notfound' };
    try { migrateFrom(cand, 'manual'); } catch (e) { return { ok: false, error: String(e.message || e) }; }
    setTimeout(() => { quitting = true; app.relaunch(); app.exit(0); }, 600);
    return { ok: true, from: cand };
  },
  http: async (method, url, body, auth) => {
    let tok = null;
    if (auth) { tok = await idToken(); if (!tok) return { status: -1, body: lastError }; }
    return http(method, url, body || null, null, tok);
  },
  httpTok: (method, url, body, token) => http(method, url, body || null, null, token || null),
  signIn: async () => { const uid = await ensureAccount(); return uid ? { status: 200, body: uid } : { status: -1, body: lastError }; },
  pickPhoto: async () => pickPhoto(),
  uploadPhoto: async (id, fid) => {
    const f = photoFile(id);
    if (!fs.existsSync(f)) return { status: 404, body: 'missing' };
    const tok = await idToken();
    if (!tok) return { status: -1, body: lastError };
    const s = syncConfig();
    const name = `projects/${s.projectId}/databases/(default)/documents/families/${fid}/photos/${id}`;
    const body = JSON.stringify({ writes: [{ update: { name, fields: { data: { stringValue: fs.readFileSync(f).toString('base64') } } } }] });
    const r = await http('POST', docsBase() + ':commit', body, null, tok);
    return { status: r.status, body: r.status === 200 ? '' : r.body };
  },
  downloadPhoto: async (id, fid) => {
    const tok = await idToken();
    if (!tok) return { status: -1, body: lastError };
    const r = await http('GET', `${docsBase()}/families/${fid}/photos/${id}`, null, null, tok);
    if (r.status === 200) {
      const b64 = JSON.parse(r.body).fields.data.stringValue;
      fs.writeFileSync(photoFile(id), Buffer.from(b64, 'base64'));
    }
    return { status: r.status, body: '' };
  }
};

/* ---------- yerel ağ eşitleme (internetsiz, aynı Wi‑Fi) ---------- */
// Çevrimdışı yapay zekâ (çeviri) — paketler kullanıcı klasörüne bir kez iner (ortak çekirdek web/yerel-zeka)
try { require('./cekirdek/electron/yerel-zeka/fc-yerel-zeka-main').install({ app, ipcMain }); } catch (e) { console.error('yerel-zeka', e); }
const lan = require('./lan-server');
Object.assign(syncCalls, lan.syncCalls, { hasPhotoLocal: id => fs.existsSync(photoFile(id)) });
Object.assign(asyncCalls, lan.asyncCalls);

ipcMain.on('sync', (e, name, ...args) => {
  try { e.returnValue = syncCalls[name](...args); } catch (err) { e.returnValue = ''; }
});
ipcMain.handle('async', (e, name, ...args) => asyncCalls[name](...args));

/* ---------- window + tray ---------- */

function showWindow() {
  if (!win) createWindow();
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

function createWindow() {
  const base = {
    width: 1100, height: 820, minWidth: 360, minHeight: 560, show: false,
    title: 'Ajandam', icon: ICON, autoHideMenuBar: true, backgroundColor: '#070b14',
    // contextIsolation kapalı (eski köprü window.Android ile aynı); preload fcHost'u doğrudan window'a koyar
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: false, backgroundThrottling: false, spellcheck: false }
  };
  win = new BrowserWindow(fc ? fc.windowOptions(base) : Object.assign(base, { fullscreen: true }));
  win.setMenuBarVisibility(false);
  if (fc) {
    // Kurulu: app.asar yaması / tam dosya. Taşınabilir: kurulum programına geçiş (win-setup) — bkz. portableSetup()
    fc.install(win, { channel: PORTABLE ? 'win-setup' : 'win-app' });
    if (PORTABLE) portableSetup();
  } else {
    win.once('ready-to-show', () => { win.setFullScreen(true); win.show(); });
  }
  win.loadFile(path.join(__dirname, 'www', 'index.html'));
  win.on('page-title-updated', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https:\/\//i.test(url)) shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (input.type === 'keyDown' && input.key === 'Escape') {
      win.webContents.executeJavaScript('window.onBack && window.onBack()').catch(() => {});
    }
  });
  win.on('focus', () => win.webContents.executeJavaScript('window.onResumeApp && window.onResumeApp()').catch(() => {}));
  win.on('close', e => {
    if (quitting) return;
    // Kapat: program bildirim alanında çalışmaya devam eder (hatırlatmalar gelsin). Tamamen çıkış: simgeye sağ tık → Çıkış.
    e.preventDefault();
    if (win.isFullScreen()) win.setFullScreen(false);
    win.hide();
    const p = prefs();
    if (!p.trayHint && Notification.isSupported()) {
      new Notification({ title: 'Ajandam', body: trayText().hint, icon: ICON }).show();
      p.trayHint = true;
      setPrefs(p);
    }
  });
  if (process.env.AJANDAM_SMOKE) smoke();
}

/* ---------- taşınabilir kip: "Güncelle" = kurulum programını indir, çalıştır, çık ----------
   Çekirdek güncelleyici win-setup kanalının tam dosyasını indirir ve SHA-256 ile doğrular; burada exe geçici klasöre yazılır,
   eski veri yeri eski-konum.json'a yazılmıştır (açılışta), kurulum başlatılır ve bu taşınabilir kopya kapanır.
   Kurulum bitince yeni Ajandam açılır ve veriyi kopyalar. Taşınabilir klasör ve içindeki data\ olduğu gibi kalır. */
function portableSetup() {
  const h = (ch, fn) => { ipcMain.removeHandler(ch); ipcMain.handle(ch, fn); };
  h('fc:update:patch', () => ({ ok: false, error: 'PORTABLE_FULL_ONLY' }));
  h('fc:update:full', async (_e, bytes, meta) => {
    try {
      const buf = Buffer.from(bytes);
      if (meta && meta.targetSha256 && crypto.createHash('sha256').update(buf).digest('hex') !== String(meta.targetSha256).toLowerCase()) return { ok: false, error: 'BAD_HASH' };
      const exe = path.join(os.tmpdir(), 'Ajandam-Setup-' + String((meta && meta.version) || 'yeni').replace(/[^\w.-]/g, '') + '.exe');
      fs.writeFileSync(exe, buf);
      if (process.platform !== 'win32') return { ok: false, error: 'NOT_WINDOWS' };
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => { quitting = true; app.exit(0); }, 800);
      return { ok: true, data: 'restarting' };
    } catch (e) { return { ok: false, error: String(e && e.code || e && e.message || e) }; }
  });
}

/* ---------- Electron açılış testi (npm test) ---------- */
function smoke() {
  const out = o => process.stdout.write('AJ_SMOKE ' + JSON.stringify(o) + '\n');
  const consoleErrors = [];
  win.webContents.on('console-message', (e, level, message) => { if (level >= 3) consoleErrors.push(String(message).slice(0, 300)); });
  const fail = setTimeout(() => { out({ ok: false, error: 'timeout' }); app.exit(2); }, 45000);
  win.webContents.on('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(`({
          fc: !!(window.FC && FC.updater && FC.topbar), host: window.FC && FC.host.kind, fcHost: !!window.fcHost, android: !!window.Android,
          version: window.APP_RELEASE && APP_RELEASE.version, scheme: document.documentElement.dataset.scheme,
          topbar: !!document.querySelector('#topbar .topbar-actions'), winBtns: document.querySelectorAll('#topbar .win-controls button').length,
          updateBtn: !!document.querySelector('#topbar .update-act'), tabs: document.querySelectorAll('#app .tab').length,
          channel: window.fcHost && fcHost.update && fcHost.update.channel, docs: typeof S !== 'undefined' ? Object.keys(S.docs).length : -1, arsiv: typeof S !== 'undefined' ? (S.arsiv || []).length : -1, portable: !!(window.Kabuk && Kabuk.portable), migrated: !!(window.Kabuk && Kabuk.info && Kabuk.info.migrated), modal: (document.querySelector('.modal h2') || {}).textContent || '', title: document.title, errors: (window.__ajErrors || []).slice(0, 5)
        })`);
        r.fullscreen = win.isFullScreen(); r.appVersion = app.getVersion(); r.mode = MODE; r.data = DATA;
        r.errors = r.errors.concat(consoleErrors.filter(m => !/net::|Failed to load resource|ERR_/.test(m)));
        clearTimeout(fail);
        out(Object.assign({ ok: r.fc && r.host === 'electron' && r.topbar && r.tabs > 0 && !r.errors.length }, r));
        quitting = true; app.exit(0);
      } catch (e) { out({ ok: false, error: String(e && e.message || e) }); app.exit(3); }
    }, 3000);
  });
}

function trayText() {
  const l = prefs().lang || 'tr';
  if (l === 'ar') return { open: 'فتح', quit: 'خروج', hint: 'يعمل التطبيق في الخلفية لإرسال التذكيرات.' };
  if (l === 'en') return { open: 'Open', quit: 'Quit', hint: 'The app keeps running in the tray so reminders still appear.' };
  return { open: 'Aç', quit: 'Çıkış', hint: 'Hatırlatmalar için uygulama sağ alttaki simgede çalışmaya devam ediyor.' };
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('Ajandam v' + VERSION);
  const menu = () => Menu.buildFromTemplate([
    { label: trayText().open, click: showWindow },
    { type: 'separator' },
    { label: trayText().quit, click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu());
  tray.on('click', showWindow);
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

if (!process.env.AJANDAM_SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    rebuildReminders();
    createWindow();
    if (!process.env.AJANDAM_SMOKE) createTray();
    lan.setup({ appId: 'ajandam', prefsGet: prefs, prefsSet: setPrefs, photoFile, getWindow: () => win });
    setInterval(checkReminders, 20000);
    setTimeout(checkReminders, 3000);
    setTimeout(relayUpdateToFamily, 60000);              // telefon güncellemesini aileye aktar
    setInterval(relayUpdateToFamily, 6 * 3600 * 1000);
  });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* stay in tray */ });
}
