'use strict';

/* ================= Native bridge ================= */

const N = window.Android || makeMock();
let cbSeq = 0;
const cbs = {};
window.__cb = (id, res) => { const f = cbs[id]; delete cbs[id]; if (f) f(res); };
function nat(fn, ...args) {
  return new Promise(resolve => {
    const id = 'c' + (++cbSeq);
    cbs[id] = s => { try { resolve(JSON.parse(s)); } catch (e) { resolve(s); } };
    N[fn](id, ...args);
  });
}

function makeMock() {
  // Browser preview only: lets the UI run outside Android.
  const photos = {};
  return {
    load: () => localStorage.getItem('aile-data') || '',
    save: s => { localStorage.setItem('aile-data', s); return true; },
    photoUrl: id => photos[id] || '',
    deletePhotoLocal: id => { delete photos[id]; },
    pickPhoto: (cb, src) => {
      const id = 'p' + Date.now().toString(36);
      const c = document.createElement('canvas'); c.width = 320; c.height = 240;
      const g = c.getContext('2d'); g.fillStyle = src === 'camera' ? '#c97' : '#7ac'; g.fillRect(0, 0, 320, 240);
      g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('📷 ' + id.slice(-4), 30, 130);
      photos[id] = c.toDataURL();
      setTimeout(() => window.__cb(cb, JSON.stringify([id])), 50);
    },
    http: (cb) => setTimeout(() => window.__cb(cb, JSON.stringify({ status: 0, body: 'offline preview' })), 50),
    httpTok: (cb) => setTimeout(() => window.__cb(cb, JSON.stringify({ status: 0, body: 'offline preview' })), 50),
    uploadPhoto: (cb) => setTimeout(() => window.__cb(cb, JSON.stringify({ status: 0, body: '' })), 50),
    downloadPhoto: (cb) => setTimeout(() => window.__cb(cb, JSON.stringify({ status: 0, body: '' })), 50),
    getSync: () => localStorage.getItem('aile-sync') || '{}',
    setSync: s => localStorage.setItem('aile-sync', s),
    signIn: (cb) => setTimeout(() => window.__cb(cb, JSON.stringify({ status: 200, body: 'mockuid' })), 50),
    uid: () => 'mockuid',
    setLang: () => {},
    deviceLang: () => (navigator.language || 'tr').slice(0, 2),
    takeOpenDoc: () => '',
    share: t => console.log('SHARE', t),
    openMap: q => console.log('MAP', q),
    dial: p => console.log('DIAL', p),
    copy: t => console.log('COPY', t),
    paste: () => '',
    toast: s => console.log('TOAST', s),
    setBarColor: () => {},
    version: () => 'preview'
  };
}

/* ================= State ================= */

const REM_OPTIONS = [0, 15, 60, 180, 1440, 2880, 10080];
const KINDS = {
  appt: { icon: '🩺', tab: 'health' },
  visit: { icon: '🏠', tab: 'visits' },
  shop: { icon: '🛒', tab: 'shop' },
  task: { icon: '✅', tab: 'tasks' }
};
const LISTS = ['cat', 'tcat', 'place', 'doctor', 'person'];
const LOGO_LISTS = ['cat', 'tcat', 'place', 'doctor'];
const DEFAULT_TCATS = [['general', '📋'], ['house', '🧹'], ['repair', '🛠️'], ['laptop', '💻'], ['claude', '🤖']];
const DEFAULT_CATS = [
  ['pharmacy', '💊'], ['market', '🛒'], ['greengrocer', '🥬'], ['hardware', '🔧'], ['mall', '🛍️'],
  ['tailor', '🧵'], ['bakery', '🍞'], ['butcher', '🥩'], ['stationery', '✏️'], ['other', '📦']
];

let S = {
  docs: {}, dirty: {}, delQ: [], photoUp: [], photoDel: [], tx: {}, alx: {},
  me: { id: '', name: '' },
  settings: { lang: '', onlyMine: false, showDone: false },
  sync: { enabled: false, apiKey: '', projectId: '', fid: '', familyName: '', adminUid: '', uid: '', members: [], lastSync: 0, lastError: '' }
};
let ui = { tab: 'agenda', shopCat: '', taskCat: '', stack: [], syncing: false, histOpen: {}, q: '' };

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function load() {
  try {
    const s = N.load();
    if (s) {
      const d = JSON.parse(s);
      S = Object.assign(S, d);
      S.settings = Object.assign({ lang: '', onlyMine: false, showDone: false }, d.settings || {});
      S.sync = Object.assign({ members: [] }, d.sync || {});
      S.tx = d.tx || {};
    }
  } catch (e) { console.error(e); }
  if (!S.me.id) S.me.id = 'd' + uid();
  if (!S.settings.lang) {
    const dl = (N.deviceLang() || 'tr').toLowerCase();
    S.settings.lang = dl === 'ar' ? 'ar' : dl === 'en' ? 'en' : 'tr';
  }
  if (!Object.values(S.docs).some(d => d.kind === 'lst')) seedDefaults();
  if (!S.sync.enabled) seedTaskClasses();
}

function seedDefaults() {
  DEFAULT_CATS.forEach(([key, icon], i) => {
    const id = 'cat_' + key;
    S.docs[id] = { id, kind: 'lst', list: 'cat', key, icon, name: '', info: '', order: i, def: true, ca: Date.now(), ua: Date.now(), by: S.me.id };
  });
}

let saveTimer = null;
let savePending = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}
function saveNow() {
  clearTimeout(saveTimer);
  // Reminder texts in this device's language; the phone/desktop scheduler prefers these.
  S.alx = {};
  Object.values(S.docs).forEach(d => { if (d.kind !== 'lst') { const a = computeAl(d); S.alx[d.id] = { ti: a.ti, b: a.b }; } });
  // During a sync the phone may be busy signing in; saving then waits for it and the screen would freeze.
  if (ui.syncing) { savePending = true; return; }
  savePending = false;
  N.save(JSON.stringify(S));
  txPrefetchAll();
}

function isDesktop() { return !!(N.platform && N.platform() === 'desktop'); }

function winModeBtn() {
  if (!isDesktop()) return '';
  const full = N.isFullScreen();
  return `<button class="winmode" data-act="winmode">${full ? '🗗 ' + esc(t('window_view')) : '⛶ ' + esc(t('full_screen'))}</button>`;
}
window.onWindowMode = () => { if (!$('#modal')) render(); };

function isAdmin() { return !S.sync.enabled || !!(S.sync.uid && (S.sync.adminUid === S.sync.uid || (S.sync.admins || []).includes(S.sync.uid))); }
/** Devices the main phone gave full rights (deleting) to, besides itself. */
function isCoAdmin(uid) { return (S.sync.admins || []).includes(uid); }

/* ================= i18n helpers ================= */

function t(k, vars) {
  const L = I18N[S.settings.lang] || I18N.tr;
  let s = L[k] !== undefined ? L[k] : (I18N.tr[k] !== undefined ? I18N.tr[k] : k);
  if (vars) Object.keys(vars).forEach(v => { s = s.split('{' + v + '}').join(vars[v]); });
  return s;
}
function locale() { return S.settings.lang === 'ar' ? 'ar-u-nu-latn' : S.settings.lang === 'en' ? 'en-GB' : 'tr-TR'; }
function fmtDate(ms, opts) { return new Intl.DateTimeFormat(locale(), opts).format(new Date(ms)); }
function fmtWhen(ms) {
  if (!ms) return '';
  return fmtDate(ms, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + fmtDate(ms, { hour: '2-digit', minute: '2-digit' });
}
function fmtTime(ms) { return fmtDate(ms, { hour: '2-digit', minute: '2-digit' }); }
function toInput(ms) {
  if (!ms) return '';
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromInput(v) { if (!v) return null; const ms = new Date(v).getTime(); return isNaN(ms) ? null : ms; }
function remLabel(m) {
  if (m === 0) return t('rem_at_time');
  if (m < 60) return t('rem_min', { n: m });
  if (m < 1440) return t('rem_hour', { n: m / 60 });
  if (m < 10080) return t('rem_day', { n: m / 1440 });
  return t('rem_week');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ================= Docs ================= */

function docs(kind) { return Object.values(S.docs).filter(d => d.kind === kind); }
function listItems(list) {
  return docs('lst').filter(d => d.list === list).sort((a, b) => (a.order || 0) - (b.order || 0) || lstName(a).localeCompare(lstName(b), locale()));
}
function lstName(d) { return d ? (d.name ? tx(d.name) : (d.key ? t((d.list === 'tcat' ? 'tc_' : 'c_') + d.key) : '')) : ''; }
function lst(id) { return id ? S.docs[id] : null; }
function catIcon(c) {
  const icon = (c && c.icon) || (c && c.list === 'place' ? '🏥' : c && c.list === 'doctor' ? '🧑‍⚕️' : '📦');
  const logo = c && c.logo ? c.logo : (twemojiFor(icon) ? 'tw:' + twemojiFor(icon) : '');
  if (logo.startsWith('plain:')) return plainLogoHtml(logo, lstName(c));
  return logo ? `<img class="cicon" src="${esc(logoSrc(logo))}" alt="">` : esc(icon);
}

function docTitle(d) {
  if (d.kind === 'net') return d.name || t('tab_net');
  if (d.kind === 'elec') return d.name || t('tab_elec');
  if (d.title) return tx(d.title);
  if (d.kind === 'appt') {
    const parts = [lstName(lst(d.doctor)), lstName(lst(d.place))].filter(Boolean);
    return parts.join(' · ') || t('sub_' + (d.sub || 'doctor'));
  }
  return t('untitled');
}
function docPlace(d) {
  if (d.kind === 'appt') return lstName(lst(d.place));
  if (d.kind === 'visit') return tx(d.address) || '';
  if (d.kind === 'shop') { const c = lst(d.cat); return c ? lstName(c) : ''; }
  return '';
}

function computeAl(d) {
  if (d.kind === 'lst') return undefined;
  if (d.kind === 'net') return netAl(d);
  if (d.kind === 'elec') return elecAl(d);
  const times = [];
  if (!d.done) {
    if (d.when) (d.rem || []).forEach(m => times.push(d.when - m * 60000));
    if (d.remAt) times.push(d.remAt);
  }
  const icon = d.kind === 'appt' && d.sub === 'hospital' ? '🏥' : KINDS[d.kind].icon;
  const person = lstName(lst(d.for));
  const body = [d.when ? fmtWhen(d.when) : '', docPlace(d), person, tx(d.qty) || ''].filter(Boolean).join(' · ');
  return { t: [...new Set(times)].sort(), ti: icon + ' ' + docTitle(d), b: body || t('reminder') };
}

function setDone(d, done) {
  d.done = done;
  if (done) { d.doneBy = S.me.name || t('member'); d.doneAt = Date.now(); }
  else { delete d.doneBy; delete d.doneAt; }
}

function putDoc(d) {
  const now = Date.now();
  if (!d.id) { d.id = uid(); d.ca = now; d.by = S.me.id; d.byName = S.me.name; }
  d.ua = now; d.uby = S.me.name; d.ubid = S.me.id;
  d.al = computeAl(d);
  S.docs[d.id] = d;
  S.dirty[d.id] = 1;
  save();
  scheduleSync();
  return d;
}

function deleteDoc(id) {
  if (!isAdmin()) { N.toast(t('only_admin')); return; }
  const d = S.docs[id];
  if (!d) return;
  (d.photos || []).forEach(p => { N.deletePhotoLocal(p); S.photoUp = S.photoUp.filter(x => x !== p); S.photoDel.push(p); });
  delete S.docs[id];
  delete S.dirty[id];
  S.lanDel = S.lanDel || {};
  S.lanDel[id] = Date.now(); // Wi‑Fi eşitlemesinde öbür cihazdan geri gelmesin
  if (S.sync.enabled && S.sync.adminUid !== S.sync.uid) {
    // A device with full rights marks the item deleted; the main phone then removes it for good.
    // (Works whether or not the family's Firebase rules already allow these devices to delete.)
    S.tomb = S.tomb || {};
    S.tomb[id] = Object.assign({}, d, { del: true, delBy: S.sync.uid, ua: Date.now() });
    delete S.tomb[id].al; // no reminders from a deleted item on phones that have not synced yet
    S.photoDel = S.photoDel.filter(p => !(d.photos || []).includes(p));
  } else {
    S.delQ.push(id);
  }
  save();
  scheduleSync();
}

/** An item marked deleted by the main phone or a device with full rights. */
function isTomb(d) { return !!(d && d.del && (d.delBy === S.sync.adminUid || (S.sync.admins || []).includes(d.delBy))); }

/* ================= Sync (Firestore REST) ================= */

function fsBase() { return `https://firestore.googleapis.com/v1/projects/${S.sync.projectId}/databases/(default)/documents`; }
function fsName(path) { return `projects/${S.sync.projectId}/databases/(default)/documents/${path}`; }
function famPath(sub) { return 'families/' + S.sync.fid + (sub ? '/' + sub : ''); }
function errText(r) {
  if (!r) return 'error';
  if (r.status === 0 || r.status === -1) {
    const b = String(r.body || '');
    if (b.includes('ADMIN_ONLY_OPERATION') || b.includes('OPERATION_NOT_ALLOWED')) return t('err_anon');
    if (b.includes('API_KEY_INVALID') || b.includes('API key not valid')) return t('err_key');
    // Low-level connection messages (stream ended, timeout, reset) mean the same thing to people: no connection.
    if (!b || /end of stream|timeout|timed out|reset|refused|unreachable|Unable to resolve|failed to connect|offline|ERR_/i.test(b)) return t('err_net');
    return t('err_net') + ' (' + b.slice(0, 120) + ')';
  }
  try { const j = JSON.parse(r.body); if (j.error && j.error.message) return r.status + ': ' + j.error.message; } catch (e) {}
  if (r.status === 403) return t('err_perm');
  return 'HTTP ' + r.status;
}
async function fsCommit(writes) {
  return nat('http', 'POST', fsBase() + ':commit', JSON.stringify({ writes }), true);
}
function docWrite(d) {
  return { update: { name: fsName(famPath('docs/' + d.id)), fields: {
    json: { stringValue: JSON.stringify(d) }, kind: { stringValue: d.kind }, ua: { integerValue: String(d.ua || 0) }
  } } };
}
async function fsListAll(path) {
  const out = [];
  let tok = '';
  do {
    const r = await nat('http', 'GET', fsBase() + '/' + path + '?pageSize=300' + (tok ? '&pageToken=' + encodeURIComponent(tok) : ''), '', true);
    if (r.status !== 200) throw new Error(errText(r));
    const j = JSON.parse(r.body || '{}');
    (j.documents || []).forEach(x => out.push(x));
    tok = j.nextPageToken || '';
  } while (tok);
  return out;
}
function idOf(name) { return name.slice(name.lastIndexOf('/') + 1); }

let syncTimer = null;
function scheduleSync() {
  if (!S.sync.enabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 1200);
}

async function syncNow() {
  if (!S.sync.enabled || ui.syncing) return;
  ui.syncing = true;
  renderSyncDot();
  try {
    S.sync.uid = N.uid() || S.sync.uid;
    // 1. push changes
    const ids = Object.keys(S.dirty).filter(id => S.docs[id]);
    const snap = {};
    ids.forEach(id => { snap[id] = S.docs[id].ua; });
    const dels = S.delQ.slice();
    const pdels = S.photoDel.slice();
    const tombs = Object.keys(S.tomb || {});
    const writes = ids.map(id => docWrite(S.docs[id])).concat(tombs.map(id => docWrite(S.tomb[id])))
      .concat(dels.map(id => ({ delete: fsName(famPath('docs/' + id)) })))
      .concat(pdels.map(id => ({ delete: fsName(famPath('photos/' + id)) })));
    for (let i = 0; i < writes.length; i += 200) {
      const r = await fsCommit(writes.slice(i, i + 200));
      if (r.status !== 200) throw new Error(errText(r));
    }
    ids.forEach(id => { if (S.docs[id] && S.docs[id].ua === snap[id]) delete S.dirty[id]; });
    Object.keys(S.dirty).forEach(id => { if (!S.docs[id]) delete S.dirty[id]; });
    S.delQ = S.delQ.filter(x => !dels.includes(x));
    tombs.forEach(id => { delete S.tomb[id]; });
    S.photoDel = S.photoDel.filter(x => !pdels.includes(x));

    // 2. upload photos
    for (const pid of S.photoUp.slice()) {
      const r = await nat('uploadPhoto', pid, S.sync.fid);
      if (r.status === 200 || r.status === 404) S.photoUp = S.photoUp.filter(x => x !== pid);
      else throw new Error(errText(r));
    }

    // 3. pull everything
    const remote = await fsListAll(famPath('docs'));
    const next = {};
    const tombsSeen = [];
    remote.forEach(x => {
      try { const d = JSON.parse(x.fields.json.stringValue); if (d.del) tombsSeen.push(d); else next[idOf(x.name)] = d; } catch (e) {}
    });
    Object.keys(S.dirty).forEach(id => { if (S.docs[id]) next[id] = S.docs[id]; });
    Object.keys(S.docs).forEach(id => {
      if (!next[id]) {
        (S.docs[id].photos || []).forEach(p => N.deletePhotoLocal(p));
        S.lanDel = S.lanDel || {};
        S.lanDel[id] = Date.now(); // başka cihazda silinmiş: Wi‑Fi eşitlemesi geri getirmesin
      }
    });
    S.docs = next;
    seedTaskClasses();

    // 4. family info and members
    const fr = await nat('http', 'GET', fsBase() + '/' + famPath(), '', true);
    if (fr.status === 200) {
      const f = JSON.parse(fr.body).fields || {};
      S.sync.adminUid = (f.adminUid || {}).stringValue || '';
      S.sync.admins = (((f.admins || {}).arrayValue || {}).values || []).map(v => v.stringValue).filter(Boolean);
      S.sync.familyName = (f.name || {}).stringValue || S.sync.familyName;
    }
    try {
      const ms = await fsListAll(famPath('members'));
      S.sync.members = ms.map(m => ({ uid: idOf(m.name), name: ((m.fields || {}).name || {}).stringValue || '?', pf: ((m.fields || {}).pf || {}).stringValue || '' }));
    } catch (e) {}
    // Unknown deletion marks (not from the main phone or a device with full rights) are ignored: the item stays.
    tombsSeen.forEach(d => { if (!isTomb(d) && !S.docs[d.id]) { const c = Object.assign({}, d); delete c.del; delete c.delBy; S.docs[d.id] = c; } });
    if (S.sync.adminUid === S.sync.uid) {
      // The main phone finishes deletions made on devices with full rights, and restores rejected marks.
      tombsSeen.forEach(d => {
        if (isTomb(d)) { if (!S.delQ.includes(d.id)) S.delQ.push(d.id); (d.photos || []).forEach(p => { if (!S.photoDel.includes(p)) S.photoDel.push(p); N.deletePhotoLocal(p); }); }
        else if (S.docs[d.id]) S.dirty[d.id] = 1;
      });
      await autoFullRights();
    }
    if (S.sync.pfSent !== 2) {
      // Tell the family which kind of device this is (phone or computer), once.
      const r = await fsCommit([memberWrite(S.sync.uid)]);
      if (r.status === 200) S.sync.pfSent = 2;
    }

    // 5. fetch missing photos
    let fetched = 0;
    for (const d of Object.values(S.docs)) {
      for (const p of (d.photos || [])) {
        if (fetched >= 20) break;
        if (!N.photoUrl(p) && !S.photoUp.includes(p)) {
          fetched++;
          await nat('downloadPhoto', p, S.sync.fid);
        }
      }
    }
    S.sync.lastSync = Date.now();
    S.sync.lastError = '';
  } catch (e) {
    S.sync.lastError = String(e.message || e);
  }
  ui.syncing = false;
  saveNow();
  checkNotify();
  const top = ui.stack[ui.stack.length - 1];
  if ((top && top.type === 'edit') || $('#modal')) renderSyncDot(); else render();
}

async function ensureSignedIn() {
  const r = await nat('signIn');
  if (r.status !== 200) throw new Error(errText(r));
  S.sync.uid = r.body;
  return r.body;
}

function parseFirebaseConfig(text) {
  const key = (text.match(/apiKey["']?\s*[:=]\s*["']([^"']+)["']/) || [])[1];
  const pid = (text.match(/projectId["']?\s*[:=]\s*["']([^"']+)["']/) || [])[1];
  return { apiKey: key, projectId: pid };
}

async function createFamily(apiKey, projectId, name) {
  S.sync = Object.assign(S.sync, { apiKey, projectId, fid: genCode(), familyName: name, enabled: false });
  N.setSync(JSON.stringify({ apiKey, projectId, fid: S.sync.fid, enabled: false }));
  const myUid = await ensureSignedIn();
  let r = await fsCommit([{
    update: { name: fsName(famPath()), fields: { adminUid: { stringValue: myUid }, name: { stringValue: name }, ca: { integerValue: String(Date.now()) } } },
    currentDocument: { exists: false }
  }]);
  if (r.status !== 200) throw new Error(errText(r));
  r = await fsCommit([memberWrite(myUid)]);
  if (r.status !== 200) throw new Error(errText(r));
  S.sync.adminUid = myUid;
  enableSync();
  Object.keys(S.docs).forEach(id => { S.dirty[id] = 1; });
  Object.values(S.docs).forEach(d => (d.photos || []).forEach(p => { if (!S.photoUp.includes(p)) S.photoUp.push(p); }));
}

function memberWrite(myUid) {
  return { update: { name: fsName(famPath('members/' + myUid)), fields: {
    name: { stringValue: S.me.name || t('member') }, dev: { stringValue: S.me.id }, ca: { integerValue: String(Date.now()) },
    pf: { stringValue: isDesktop() ? 'desktop' : 'phone' }
  } } };
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genCode() {
  const a = new Uint32Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, x => CODE_CHARS[x % CODE_CHARS.length]).join('');
}
function hasBuiltin() { return !!(BUILTIN_FB.apiKey && BUILTIN_FB.projectId); }
function isShortCode(fid) { return /^[A-Z2-9]{10}$/.test(fid || ''); }
function showCode(fid) { return isShortCode(fid) ? fid.slice(0, 5) + '-' + fid.slice(5) : fid; }
/** Short codes work on phones whose app has the same Firebase project built in. */
function shortCodeUsable() {
  return isShortCode(S.sync.fid) && hasBuiltin() && BUILTIN_FB.apiKey === S.sync.apiKey && BUILTIN_FB.projectId === S.sync.projectId;
}

function makeInvite() {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ k: S.sync.apiKey, p: S.sync.projectId, f: S.sync.fid, n: S.sync.familyName }))));
  return 'AILE:' + payload;
}

function parseInvite(text) {
  const m = String(text || '').match(/AILE:([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  try { const j = JSON.parse(decodeURIComponent(escape(atob(m[1])))); return j.k && j.p && j.f ? j : null; } catch (e) { return null; }
}

async function joinFamily(inv) {
  S.sync = Object.assign(S.sync, { apiKey: inv.k, projectId: inv.p, fid: inv.f, familyName: inv.n || '', enabled: false });
  N.setSync(JSON.stringify({ apiKey: inv.k, projectId: inv.p, fid: inv.f, enabled: false }));
  const myUid = await ensureSignedIn();
  const fr = await nat('http', 'GET', fsBase() + '/' + famPath(), '', true);
  if (fr.status === 404) throw new Error(t('err_nofamily'));
  if (fr.status !== 200) throw new Error(errText(fr));
  const r = await fsCommit([memberWrite(myUid)]);
  if (r.status !== 200) throw new Error(errText(r));
  // Drop this phone's untouched default lists; the family's own lists come with the first sync.
  Object.values(S.docs).forEach(d => { if (d.def) { delete S.docs[d.id]; delete S.dirty[d.id]; } });
  Object.keys(S.docs).forEach(id => { S.dirty[id] = 1; });
  Object.values(S.docs).forEach(d => (d.photos || []).forEach(p => { if (!S.photoUp.includes(p)) S.photoUp.push(p); }));
  enableSync();
}

function enableSync() {
  S.sync.enabled = true;
  S.sync.lastError = '';
  N.setSync(JSON.stringify({ apiKey: S.sync.apiKey, projectId: S.sync.projectId, fid: S.sync.fid, enabled: true }));
  saveNow();
}

function leaveFamily() {
  S.sync.enabled = false;
  N.setSync(JSON.stringify({ apiKey: S.sync.apiKey, projectId: S.sync.projectId, fid: '', enabled: false }));
  S.sync.fid = ''; S.sync.adminUid = ''; S.sync.admins = []; S.sync.members = []; S.sync.familyName = '';
  S.dirty = {}; S.delQ = []; S.photoUp = []; S.photoDel = [];
  saveNow();
}

async function makeAdmin(memberUid) {
  const r = await fsCommit([{
    update: { name: fsName(famPath()), fields: { adminUid: { stringValue: memberUid } } },
    updateMask: { fieldPaths: ['adminUid'] }
  }]);
  if (r.status !== 200) throw new Error(errText(r));
  S.sync.adminUid = memberUid;
  saveNow();
}

/** The user's own other devices get full rights automatically: their computers and devices with the main phone's name. */
async function autoFullRights() {
  const mine = foldText((S.sync.members.find(m => m.uid === S.sync.uid) || {}).name || S.me.name);
  const want = S.sync.members.filter(m => m.uid !== S.sync.uid && !(S.sync.admins || []).includes(m.uid) && !(S.sync.notAdmins || []).includes(m.uid)
    && (m.pf === 'desktop' || (mine && foldText(m.name) === mine)));
  for (const m of want) { try { await setFullRights(m.uid, true); } catch (e) { /* next sync tries again */ } }
}

async function setFullRights(memberUid, on) {
  // Rights taken away by hand are not given back automatically.
  S.sync.notAdmins = (S.sync.notAdmins || []).filter(u => u !== memberUid).concat(on ? [] : [memberUid]);
  const list = (S.sync.admins || []).filter(u => u !== memberUid).concat(on ? [memberUid] : []);
  const r = await fsCommit([{
    update: { name: fsName(famPath()), fields: { admins: { arrayValue: { values: list.map(u => ({ stringValue: u })) } } } },
    updateMask: { fieldPaths: ['admins'] }
  }]);
  if (r.status !== 200) throw new Error(errText(r));
  S.sync.admins = list;
  saveNow();
}

async function removeMember(memberUid) {
  const r = await fsCommit([{ delete: fsName(famPath('members/' + memberUid)) }]);
  if (r.status !== 200) throw new Error(errText(r));
  S.sync.members = S.sync.members.filter(m => m.uid !== memberUid);
  saveNow();
}

/* ================= Rendering ================= */

const $ = sel => document.querySelector(sel);
const app = () => $('#app');

function applyLang() {
  document.documentElement.lang = S.settings.lang;
  document.documentElement.dir = S.settings.lang === 'ar' ? 'rtl' : 'ltr';
  N.setLang(S.settings.lang);
}

function render() {
  const top = ui.stack[ui.stack.length - 1];
  if (top) { renderScreen(top); return; }
  const tabs = [
    ['agenda', '📅', t('tab_agenda')], ['health', '🩺', t('tab_health')], ['visits', '🏠', t('tab_visits')],
    ['shop', '🛒', t('tab_shop')], ['tasks', '✅', t('tab_tasks')], ['net', '📶', t('tab_net')], ['elec', '⚡', t('tab_elec')]
  ];
  const qFocus = document.activeElement && document.activeElement.id === 'q' ? document.activeElement.selectionStart : null;
  app().innerHTML = `
    <header class="bar">
      <h1>${esc(t('app_name'))} <span class="ver">v${esc(N.version())}</span></h1>
      <span id="syncdot"></span>
      <button class="icon-btn" data-act="lan" title="${esc(t('lan_title'))}" aria-label="${esc(t('lan_title'))}">📶</button>
      ${winModeBtn()}
      <button class="icon-btn" data-act="settings" aria-label="${esc(t('settings'))}">⚙️</button>
      ${isDesktop() && typeof N.quitApp === 'function' ? `<button class="exitbtn" data-act="exitapp" title="${esc(t('exit_app'))}">✕ ${esc(t('exit_app'))}</button>` : ''}
    </header>
    <main class="content" id="main">${updateBanner()}${renderTab()}</main>
    <button class="fab" data-act="add" aria-label="${esc(t('add'))}">＋</button>
    <nav class="tabs">${tabs.map(([k, ic, l]) => `<button class="tab ${ui.tab === k ? 'on' : ''}" data-tab="${k}"><span>${ic}</span><small>${esc(l)}</small></button>`).join('')}</nav>`;
  renderSyncDot();
  const q = $('#q');
  if (q && qFocus !== null) { q.focus(); try { q.setSelectionRange(qFocus, qFocus); } catch (e) { /* ignore */ } }
}

function renderSyncDot() {
  const el = $('#syncdot');
  if (!el) return;
  if (!S.sync.enabled) { el.innerHTML = ''; return; }
  const cls = ui.syncing ? 'busy' : S.sync.lastError ? 'err' : 'ok';
  const txt = ui.syncing ? t('syncing') : S.sync.lastError ? t('sync_error') : t('synced');
  el.innerHTML = `<button class="sync ${cls}" data-act="syncnow">☁ ${esc(txt)}</button>`;
}

function itemRow(d, opts = {}) {
  const medLogo = d.kind === 'appt' ? [lst(d.doctor), lst(d.place)].find(l => l && l.logo) : null;
  const icon = medLogo ? catIcon(medLogo) : d.kind === 'appt' && d.sub === 'hospital' ? '🏥' : d.kind === 'appt' && d.sub === 'test' ? '🧪' : KINDS[d.kind].icon;
  const person = lstName(lst(d.for));
  const meta = [opts.timeOnly && d.when ? fmtTime(d.when) : (d.when ? fmtWhen(d.when) : ''), docPlace(d), person].filter(Boolean);
  if (d.done && d.doneBy) meta.push('✓ ' + tx(d.doneBy));
  else if (d.byName && d.by !== S.me.id) meta.push('✎ ' + tx(d.byName));
  const thumbId = coverOf(d);
  const thumb = thumbId ? N.photoUrl(thumbId) : '';
  const overdue = d.when && d.when < Date.now() && !d.done;
  const bell = d.al && d.al.t && d.al.t.some(x => x > Date.now()) ? '<span class="bell">🔔</span>' : '';
  const trash = isAdmin() && isFinished(d) ? `<button class="trash" data-trash="${d.id}" aria-label="${esc(t('delete'))}">🗑</button>` : '';
  return `<div class="row ${d.done ? 'done' : ''} ${overdue ? 'overdue' : ''}" data-open="${d.id}">
    <button class="check ${d.done ? 'on' : ''}" data-toggle="${d.id}" aria-label="${esc(t('done'))}">${d.done ? '✓' : ''}</button>
    <div class="rtext">
      <div class="rtitle"><span class="ricon">${icon}</span> <span class="rname">${esc(docTitle(d))}</span>${d.qty ? ` <span class="qty">× ${esc(tx(d.qty))}</span>` : ''} ${bell}</div>
      ${meta.length ? `<div class="rmeta">${esc(meta.join(' · '))}</div>` : ''}
    </div>
    ${thumb ? `<img class="thumb" src="${esc(thumb)}" data-view="${esc(thumbId)}" data-of="${d.id}" alt="">` : (d.photos && d.photos.length ? '<span class="thumb ph">🖼️</span>' : '')}
    ${trash}
  </div>`;
}

/** Done, and its time (if it has one) has passed: the main phone gets a quick delete button. */
function isFinished(d) { return !!d.done && (!d.when || d.when < Date.now()); }

function dayKey(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

const TAB_KINDS = { agenda: null, health: ['appt'], visits: ['visit'], shop: ['shop'], tasks: ['task'], net: ['net'], elec: ['elec'] };

/** Every tab starts with a search box; while something is typed the tab shows what matches instead. */
function renderTab() {
  if (ui.tab === 'net') return `<div id="agbody">${netBody()}</div>`;
  if (ui.tab === 'elec') return `<div id="agbody">${elecBody()}</div>`;
  return searchBox() + (ui.tab === 'agenda' ? clearDoneBtn() : '') + `<div id="agbody">${tabContent()}</div>`;
}

function tabContent() { return ui.q.trim() ? searchResults(TAB_KINDS[ui.tab]) : tabBody(); }

function tabBody() {
  switch (ui.tab) {
    case 'agenda': return agendaBody();
    case 'health': return renderDated('appt', t('empty_health')) + renderDirectory();
    case 'visits': return renderDated('visit', t('empty_visits'));
    case 'shop': return renderShop();
    case 'tasks': return renderTasks();
    case 'net': return netBody();
    case 'elec': return elecBody();
  }
  return '';
}

function card(list, opts) { return `<div class="card">${list.map(d => itemRow(d, opts)).join('')}</div>`; }
// Open items first, finished (struck-through) ones after them.
function openFirst(a, b) { return (a.done - b.done) || ((a.when || 9e15) - (b.when || 9e15)); }

/* ---------- Search (main screen) ---------- */

function foldText(s) {
  return String(s || '').toLocaleLowerCase(locale()).normalize('NFD').replace(/[\u0300-\u036f\u064b-\u0652]/g, '').replace(/ı/g, 'i');
}

/** Every text an item can be found by: what was typed and its translation, plus its people, places and categories. */
function searchText(d) {
  const out = [];
  ['title', 'notes', 'qty', 'dept', 'address', 'byName', 'doneBy'].forEach(f => { if (d[f]) out.push(d[f], tx(d[f])); });
  ['for', 'cat', 'tcat', 'doctor', 'place'].forEach(f => { const l = lst(d[f]); if (l) out.push(l.name || '', lstName(l)); });
  out.push(docTitle(d), t('tab_' + ({ appt: 'health', visit: 'visits', shop: 'shop', task: 'tasks' }[d.kind] || 'agenda')));
  if (d.when) out.push(fmtWhen(d.when));
  return foldText(out.join(' \n '));
}

function searchResults(kinds) {
  const words = foldText(ui.q).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const match = h => words.every(w => h.includes(w));
  const hits = Object.values(S.docs).filter(d => d.kind !== 'lst' && KINDS[d.kind] && (!kinds || kinds.includes(d.kind))).filter(d => match(searchText(d)))
    .sort((a, b) => (a.done - b.done) || ((b.when || b.ua || 0) - (a.when || a.ua || 0)));
  // Hospitals and doctors are found by their name, address and phone too.
  const dir = !kinds || kinds.includes('appt') ? dirItems().filter(l => match(foldText([l.name, lstName(l), l.info, tx(l.info), l.spec, tx(l.spec), l.address, tx(l.address), l.phone, l.email].filter(Boolean).join(' \n ')))) : [];
  if (!hits.length && !dir.length) return `<p class="muted center">${esc(t('search_none'))}</p>`;
  return `<h3 class="day">${esc(t('search_n', { n: hits.length + dir.length }))}</h3>${hits.length ? card(hits) : ''}${dir.length ? `<div class="card">${dir.map(dirRow).join('')}</div>` : ''}`;
}

function searchBox() {
  return `<div class="searchbar"><span class="sicon">🔍</span><input id="q" type="search" value="${esc(ui.q)}" placeholder="${esc(ui.tab === 'agenda' ? t('search_ph') : t('search_tab', { tab: t('tab_' + ui.tab) }))}" autocomplete="off" spellcheck="false" enterkeyhint="search">${ui.q ? `<button class="sclear" data-act="clearq" aria-label="✕">✕</button>` : ''}</div>`;
}

/** Done tasks and bought shopping items: the main screen's clean-up button removes them all at once. */
function doneToClear() { return Object.values(S.docs).filter(d => (d.kind === 'task' || d.kind === 'shop') && d.done); }

function clearDoneBtn() {
  const n = doneToClear().length;
  return `<button class="btn small cleardone${n ? '' : ' off'}" data-act="cleardone">🧹 ${esc(t('clear_done'))} (${n})</button>`;
}

function agendaBody() {
  const now = Date.now();
  const today = dayKey(now);
  const items = Object.values(S.docs).filter(d => d.kind !== 'lst' && d.when && d.when >= today)
    .sort((a, b) => a.when - b.when);
  const overdue = Object.values(S.docs).filter(d => d.kind !== 'lst' && d.kind !== 'shop' && d.when && d.when < today && !d.done)
    .sort((a, b) => a.when - b.when);
  const groups = {};
  items.forEach(d => { const k = dayKey(d.when); (groups[k] = groups[k] || []).push(d); });
  const shopOpen = docs('shop').filter(d => !d.done);
  const undated = docs('task').filter(d => !d.when).sort(openFirst);
  let html = netAgendaCard() + elecAgendaCard();
  if (shopOpen.length) {
    const byCat = {};
    shopOpen.forEach(d => { byCat[d.cat || ''] = (byCat[d.cat || ''] || 0) + 1; });
    html += `<div class="card summary" data-tab="shop"><div class="stitle">🛒 ${esc(t('to_buy', { n: shopOpen.length }))}</div>
      <div class="chips">${Object.keys(byCat).map(c => `<span class="chip">${catIcon(lst(c))} ${esc(lstName(lst(c)) || t('no_cat'))} ${byCat[c]}</span>`).join('')}</div></div>`;
  }
  if (!items.length && !overdue.length && !shopOpen.length && !undated.length) return html + emptyState('📅', t('empty_agenda'));
  if (overdue.length) html += `<h3 class="day late">${esc(t('overdue'))}</h3>${card(overdue)}`;
  Object.keys(groups).sort((a, b) => a - b).forEach(k => {
    const ms = +k;
    const diff = Math.round((ms - today) / 86400000);
    const label = diff === 0 ? t('today') : diff === 1 ? t('tomorrow') : fmtDate(ms, { weekday: 'long', day: 'numeric', month: 'long' });
    html += `<h3 class="day ${diff === 0 ? 'today' : ''}">${esc(label)}</h3>${card(groups[k], { timeOnly: true })}`;
  });
  if (undated.length) html += `<h3 class="day">${esc(t('undated_tasks'))}</h3>${card(undated)}`;
  return html;
}

function emptyState(icon, text) {
  return `<div class="empty"><div class="eicon">${icon}</div><p>${esc(text)}</p><button class="btn primary" data-act="add">＋ ${esc(t('add'))}</button></div>`;
}

function renderDated(kind, emptyText) {
  const all = docs(kind);
  if (!all.length) return emptyState(KINDS[kind].icon, emptyText);
  const now = Date.now();
  const isPast = d => d.when && d.when < now - 3600000;
  const upcoming = all.filter(d => !isPast(d)).sort(openFirst);
  const past = all.filter(isPast).sort((a, b) => (a.done - b.done) || (b.when - a.when));
  let html = upcoming.length ? card(upcoming) : `<p class="muted center">${esc(t('nothing_upcoming'))}</p>`;
  if (past.length) html += `<h3 class="day">${esc(t('past'))}</h3>${card(past)}`;
  return html;
}

function renderShop() {
  const all = docs('shop');
  const cats = listItems('cat');
  const open = all.filter(d => !d.done);
  const visible = all.filter(d => !ui.shopCat || (d.cat || '') === ui.shopCat);
  let html = `<div class="chips catgrid">
    <button class="chip ${!ui.shopCat ? 'on' : ''}" data-cat="">${esc(t('all'))} ${open.length}</button>
    ${cats.map(c => { const n = open.filter(d => d.cat === c.id).length; return `<button class="chip ${ui.shopCat === c.id ? 'on' : ''}" data-cat="${c.id}">${catIcon(c)} ${esc(lstName(c))}${n ? ' <b>' + n + '</b>' : ''}</button>`; }).join('')}
  </div>`;
  if (!all.length) return html + emptyState('🛒', t('empty_shop'));
  const groups = {};
  visible.forEach(d => { (groups[d.cat || ''] = groups[d.cat || ''] || []).push(d); });
  const order = cats.map(c => c.id).concat(['']).concat(Object.keys(groups).filter(k => k && !lst(k)));
  order.forEach(k => {
    const g = groups[k];
    if (!g || !g.length) return;
    const c = lst(k);
    g.sort((a, b) => (a.done - b.done) || (b.ua - a.ua));
    html += `<h3 class="day">${catIcon(c)} ${esc(lstName(c) || t('no_cat'))} <span class="muted">${g.filter(d => !d.done).length}</span></h3>${card(g)}`;
  });
  if (!visible.length) html += `<p class="muted center">${esc(t('all_bought'))}</p>`;
  const doneCount = all.filter(d => d.done).length;
  if (isAdmin() && doneCount) {
    html += `<div class="foot-actions"><button class="btn danger small" data-act="clearbought">🗑 ${esc(t('clear_bought'))} (${doneCount})</button></div>`;
  }
  return html;
}

function renderTasks() {
  const all = docs('task');
  const classes = listItems('tcat');
  const open = all.filter(d => !d.done);
  let html = `<div class="chips catgrid">
    <button class="chip ${!ui.taskCat ? 'on' : ''}" data-tcat="">${esc(t('all'))} ${open.length}</button>
    ${classes.map(c => { const n = open.filter(d => d.tcat === c.id).length; return `<button class="chip ${ui.taskCat === c.id ? 'on' : ''}" data-tcat="${c.id}">${catIcon(c)} ${esc(lstName(c))}${n ? ' <b>' + n + '</b>' : ''}</button>`; }).join('')}
  </div>`;
  if (!all.length) return html + emptyState('✅', t('empty_tasks'));
  const visible = all.filter(d => !ui.taskCat || (d.tcat || '') === ui.taskCat);
  const groups = {};
  visible.forEach(d => { const k = d.tcat && lst(d.tcat) ? d.tcat : ''; (groups[k] = groups[k] || []).push(d); });
  classes.map(c => c.id).concat(['']).forEach(k => {
    const g = groups[k];
    if (!g || !g.length) return;
    const c = lst(k);
    html += `<h3 class="day">${c ? catIcon(c) : '📋'} ${esc(c ? lstName(c) : t('no_tclass'))} <span class="muted">${g.filter(d => !d.done).length}</span></h3>${card(g.sort(openFirst))}`;
  });
  if (!visible.length) html += `<p class="muted center">${esc(t('nothing_upcoming'))}</p>`;
  return html;
}

/* ---------- In-app updates ---------- */

function updateCreds() {
  if (S.sync.apiKey && S.sync.projectId) return { k: S.sync.apiKey, p: S.sync.projectId };
  if (hasBuiltin()) return { k: BUILTIN_FB.apiKey, p: BUILTIN_FB.projectId };
  return null;
}

function updateBanner() {
  const u = ui.update;
  if (!u || !u.available) return '';
  if (u.busy || u.prog || u.error) return updCardHtml(u);
  return `<div class="card upd"><span>🆕 ${esc(t('upd_ready', { v: 'v' + u.version }))}</span>
    <button class="btn primary small" data-act="update">${esc(t('upd_now'))}</button></div>`;
}

function updateStatusHtml() {
  const u = ui.update || {};
  if (u.available && (u.busy || u.prog)) return updCardHtml(u);
  let msg = '';
  if (!updateCreds()) msg = t('upd_no_fb');
  else if (u.error) msg = t('upd_fail', { e: u.error });
  else if (u.available) msg = t('upd_ready', { v: 'v' + u.version }) + (u.needApk ? ' ' + t('upd_apk') : '');
  else if (u.checked) msg = t('upd_latest');
  return `${msg ? `<p class="muted small">${esc(msg)}</p>` : ''}
    <div class="actions">
      <button class="btn" data-act="updcheck" ${u.busy ? 'disabled' : ''}>🔄 ${esc(t('upd_check'))}</button>
      ${u.available ? `<button class="btn primary" data-act="update" ${u.busy ? 'disabled' : ''}>⬆️ ${esc(u.error ? t('upd_retry') : t('upd_now'))} (v${esc(u.version)})</button>` : ''}
    </div>`;
}

/* ---------- Update download card: percent, MB done / total, what is left, speed, time left ---------- */

function fmtNum(b, dec) {
  return ((b || 0) / 1048576).toLocaleString(locale(), { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtMB(b, dec) {
  return fmtNum(b, dec === undefined ? ((b || 0) < 1048576 ? 2 : 1) : dec) + ' MB';
}
/** "6,4 / 10,4 MB" */
function fmtPair(a, total) {
  const dec = total < 1048576 ? 2 : 1;
  return (a === null ? '—' : fmtNum(a, dec)) + ' / ' + fmtMB(total, dec);
}
function fmtDur(sec) {
  sec = Math.max(1, Math.round(sec));
  if (sec < 60) return t('upd_sec', { n: sec });
  const m = Math.floor(sec / 60), r = sec % 60;
  return t('upd_min', { n: m }) + (r ? ' ' + t('upd_sec', { n: r }) : '');
}

/** Numbers for the card; null fields mean "not known" (phones report only the start and the end). */
function updNumbers(u) {
  const p = u.prog || {};
  const total = p.total || u.size || 0;
  const live = p.live && total > 0;
  const got = Math.min(p.got || 0, total || Infinity);
  const pct = live ? Math.min(100, Math.floor(got * 100 / total)) : p.phase === 'install' || p.phase === 'restart' ? 100 : null;
  let speed = null;
  const sm = p.samples || [];
  if (live && sm.length > 1) {
    const a = sm[0], z = sm[sm.length - 1];
    if (z.ms > a.ms) speed = (z.got - a.got) * 1000 / (z.ms - a.ms);
  }
  const left = live ? Math.max(0, total - got) : null;
  const eta = live && speed > 0 ? left / speed : left === 0 ? 0 : null;
  return { total, got, live, pct, speed, left, eta };
}

function updCardHtml(u) {
  return `<div class="card updx" data-updx>${updCardInner(u)}</div>`;
}

function updCardInner(u) {
  const p = u.prog || {};
  const n = updNumbers(u);
  const pctTxt = n.pct === null ? '' : (n.pct / 100).toLocaleString(locale(), { style: 'percent' });
  const st = u.error ? t('upd_fail', { e: u.error }) : p.phase === 'restart' ? t('upd_done') : p.phase === 'install' ? t('upd_installing') : t('upd_busy');
  const dash = '—';
  const box = (k, v) => `<div class="updx-box"><small>${esc(t(k))}</small><b>${esc(v)}</b></div>`;
  return `<div class="updx-title">🆕 ${esc(t('upd_ready_title', { v: 'v' + u.version }))}</div>
    <div class="updx-row"><span class="${u.error ? 'updx-err' : ''}">${esc(st)}</span><b>${esc(pctTxt)}</b></div>
    <div class="updx-bar${n.pct === null && !u.error ? ' indet' : ''}${u.error ? ' err' : ''}"><i style="width:${n.pct === null ? 100 : n.pct}%"></i></div>
    ${u.error ? '' : `<div class="updx-grid">
      ${box('upd_got', !n.total ? dash : fmtPair(n.live || n.pct === 100 ? (n.pct === 100 ? n.total : n.got) : null, n.total))}
      ${box('upd_left', n.left === null ? (n.pct === 100 ? fmtMB(0) : dash) : fmtMB(n.left))}
      ${box('upd_speed', n.speed ? fmtMB(n.speed) + t('upd_per_s') : dash)}
      ${box('upd_eta', n.eta === null ? (n.pct === 100 ? fmtDur(0).replace(/\d+/, '0') : dash) : n.eta < 0.5 ? fmtDur(0).replace(/\d+/, '0') : fmtDur(n.eta))}
    </div>`}
    ${u.error ? `<div class="actions"><button class="btn primary" data-act="update">🔄 ${esc(t('upd_retry'))}</button></div>` : ''}`;
}

/** Redraws only the card(s), so the screen does not flicker 6 times a second. */
function paintUpdCard() {
  const u = ui.update;
  const cards = document.querySelectorAll('[data-updx]');
  if (!u || !cards.length) { refreshUpdateUi(); return; }
  const html = updCardInner(u);
  cards.forEach(c => { c.innerHTML = html; });
}

/** The desktop app reports every received chunk. */
window.onUpdProgress = p => {
  const u = ui.update;
  if (!u || !u.busy) return;
  const pr = u.prog || (u.prog = { samples: [] });
  pr.live = true;
  pr.phase = p.phase;
  pr.got = p.got;
  pr.total = p.total;
  pr.lastAt = Date.now();
  pr.samples.push({ got: p.got, ms: p.ms });
  // speed over the last ~2.5 seconds
  while (pr.samples.length > 2 && p.ms - pr.samples[0].ms > 2500) pr.samples.shift();
  paintUpdCard();
};

/** Bundle size for the phone card (the desktop check already sends it). */
async function updSizeFromManifest() {
  try {
    const r = await nat('http', 'GET', `${fsBase()}/${famPath('photos/upd_latest')}`, '', true);
    if (!r || r.status !== 200) return 0;
    const l = JSON.parse(JSON.parse(r.body).fields.data.stringValue);
    if (Array.isArray(l.partChars)) return l.partChars.reduce((a, b) => a + b + 260, 0);
    return l.bytes ? Math.round(l.bytes * 4 / 3) : 0;
  } catch (e) { return 0; }
}

function refreshUpdateUi() {
  const top = ui.stack[ui.stack.length - 1];
  if ($('#modal') || (top && top.type === 'edit')) return;
  render();
}

async function checkUpdate(manual) {
  const c = updateCreds();
  if (typeof N.updateCheck !== 'function' || !c) { if (manual) refreshUpdateUi(); return; }
  if ((ui.update && ui.update.busy) || (ui.updChecking && !manual)) return;
  const before = JSON.stringify(ui.update || null);
  ui.updChecking = true;
  const r = await nat('updateCheck', c.k, c.p);
  ui.updChecking = false;
  if (r && r.ok) ui.update = { available: !!r.available, version: r.version, needApk: !!r.needApk, notes: r.notes || '', size: r.size || 0, checked: true };
  else ui.update = Object.assign({}, ui.update, { error: manual ? (r && r.error) || '?' : '', checked: true });
  if (manual && r && r.ok && !r.available) N.toast(t('upd_latest'));
  // Frequent background checks redraw the screen only when something changed.
  if (manual || JSON.stringify(ui.update) !== before) refreshUpdateUi();
  if (!manual && ui.update.available && isDesktop() && document.hidden && notifiedVer !== ui.update.version && typeof N.notifyNow === 'function') {
    // The window is hidden in the tray: say it with a Windows notification.
    notifiedVer = ui.update.version;
    N.notifyNow('🆕 ' + t('upd_ready', { v: 'v' + ui.update.version }), tx(ui.update.notes || ''), '');
  }
  if (!manual && !ui.updatedShown) { ui.updatedShown = true; announceUpdated(); }
  if (!manual && ui.update.available) announceUpdate();
}

/* ---------- Update notices ---------- */

let announcedVer = '';
let notifiedVer = '';


/** A new version is waiting: say so in a box once per app start (and when one appears while the app is open). */
/** A new version is waiting: say so in a box once per app start. */
function announceUpdate() {
  const u = ui.update;
  if (!u || !u.available || u.busy || announcedVer === u.version) return;
  if ($('#modal') || $('#viewer')) { setTimeout(announceUpdate, 5000); return; }
  announcedVer = u.version;
  openModal(`<h3>🆕 ${esc(t('upd_ready', { v: 'v' + u.version }))}</h3>
    ${u.notes ? `<p class="mtext">${esc(tx(u.notes))}</p>` : ''}
    ${u.needApk ? `<p class="muted small">${esc(t('upd_apk'))}</p>` : ''}
    <div class="mbtns"><button class="btn" data-act="mclose">${esc(t('upd_later'))}</button><button class="btn primary" id="m-ok">⬆️ ${esc(t('upd_now'))}</button></div>`,
    root => { root.querySelector('#m-ok').onclick = () => { closeModal(); doUpdate(); }; });
}

/** First start after an update: show what is new. */
function announceUpdated() {
  const ver = N.version();
  const seen = S.settings.seenVer;
  S.settings.seenVer = ver;
  if (seen === ver || ver === 'preview') return;
  const latest = ui.update && ui.update.version === ver ? ui.update.notes : '';
  const notes = S.settings.updNotes && S.settings.updNotes.v === ver ? S.settings.updNotes.n : latest || '';
  delete S.settings.updNotes;
  saveNow();
  openModal(`<h3>✅ ${esc(t('upd_installed', { v: 'v' + ver }))}</h3>
    ${notes ? `<p class="mtext">${esc(tx(notes))}</p>` : ''}
    <div class="mbtns"><button class="btn primary" data-act="mclose">${esc(t('ok'))}</button></div>`);
}

const UPD_TIMEOUT = 5 * 60000;   // the whole download + install
const UPD_STALL = 150000;        // desktop: no new bytes for this long (the app itself retries 4 times first)

async function doUpdate() {
  const c = updateCreds();
  const u = ui.update;
  if (!c || !u || !u.available || u.busy) return;
  u.busy = true; u.error = '';
  u.prog = { samples: [], phase: 'dl', got: 0, total: u.size || 0, lastAt: Date.now() };
  refreshUpdateUi();
  paintUpdCard();
  S.settings.updNotes = { v: u.version, n: u.notes || '' };
  saveNow();
  if (!u.size && !u.needApk && S.sync.enabled) updSizeFromManifest().then(sz => { if (sz && u.busy) { u.size = sz; if (!u.prog.total) u.prog.total = sz; paintUpdCard(); } });
  // Never wait forever: a hard limit, plus (on the desktop) a stall check on the live byte count.
  let watch = null;
  const guard = new Promise(res => {
    const t0 = Date.now();
    watch = setInterval(() => {
      const p = u.prog || {};
      if (Date.now() - t0 > UPD_TIMEOUT) res({ ok: false, error: 'timeout' });
      else if (p.live && p.phase === 'dl' && Date.now() - p.lastAt > UPD_STALL) res({ ok: false, error: 'timeout' });
    }, 2000);
  });
  const call = u.needApk && typeof N.updateApk === 'function' ? nat('updateApk', c.k, c.p) : nat('updateApply', c.k, c.p);
  const r = await Promise.race([call, guard]);
  clearInterval(watch);
  u.busy = false;
  if (r && r.ok) {
    if (u.needApk) { u.prog = null; refreshUpdateUi(); return; }
    u.prog = Object.assign(u.prog || {}, { phase: 'restart', got: (u.prog && u.prog.total) || u.size || 0 });
    if (u.prog.total) u.prog.live = true;
    paintUpdCard();
    N.toast(t('upd_done'));
    setTimeout(() => N.restartApp(), 1200);
  } else {
    const e = (r && r.error) || '?';
    u.error = /timeout|network|net::|ERR_|failed|reset|sign-in|unreachable|Unable to resolve/i.test(e) ? t('err_net') : e;
    u.prog = null;
    N.toast(t('upd_fail', { e: u.error }));
    refreshUpdateUi();
    paintUpdCard();
  }
}

/** This phone's person in the people list: chosen in settings, else the one named like me. */
function myPerson() {
  if (S.settings.person && S.docs[S.settings.person]) return S.settings.person;
  const me = (S.me.name || '').trim().toLocaleLowerCase(locale());
  const p = me && listItems('person').find(i => (i.name || '').trim().toLocaleLowerCase(locale()) === me);
  return p ? p.id : '';
}

/**
 * New items from other family members: "for you" in this device's language, and on the main device everything
 * someone else added, in Turkish. Phones do this natively (also in the background); the desktop app does it here.
 */
function checkNotify() {
  if (typeof N.checkNotify === 'function') { N.checkNotify(); return; }
  if (typeof N.notifyNow !== 'function' || !S.sync.enabled) return;
  const st = S.ntf || (S.ntf = { init: false, seen: {} });
  const next = {};
  const me = myPerson();
  const inLang = (text, lang) => { const v = S.tx[lang + '|' + text]; return v || text; };
  const fmt = (pattern, d, lang) => pattern.replace('{name}', d.byName || d.uby ? inLang(d.byName || d.uby, lang) : I18N[lang].ntf_someone);
  const body = (d, lang) => {
    const icon = d.kind === 'appt' ? '🩺' : KINDS[d.kind] ? KINDS[d.kind].icon : '';
    const title = d.title ? inLang(d.title, lang) : [lst(d.doctor), lst(d.place)].filter(x => x && x.name).map(x => inLang(x.name, lang)).join(' · ');
    return icon + ' ' + title + (d.when ? '\n' + new Date(d.when).toLocaleString(lang === 'ar' ? 'ar' : lang === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  };
  Object.values(S.docs).forEach(d => {
    if (d.kind === 'lst') return;
    const forv = d.for || '';
    const prev = st.seen[d.id];
    next[d.id] = forv;
    if (!st.init || d.done || (d.ubid || d.by) === S.me.id) return;
    const forMe = !!me && forv === me;
    const lang = S.settings.lang;
    if (prev === undefined) {
      if (forMe) N.notifyNow(fmt(I18N[lang].ntf_for_you, d, lang), body(d, lang), d.id);
      else if (isAdmin() && d.by !== S.me.id) N.notifyNow(fmt(I18N.tr.ntf_added, d, 'tr'), body(d, 'tr'), d.id);
    } else if (forMe && prev !== forv) {
      N.notifyNow(fmt(I18N[lang].ntf_for_you, d, lang), body(d, lang), d.id);
    }
  });
  st.seen = next;
  st.init = true;
  save();
}

/** Task classes for phones that never had them; fixed ids so paired phones don't create duplicates. */
function seedTaskClasses() {
  if (S.settings.tcatSeeded) return;
  S.settings.tcatSeeded = true;
  if (listItems('tcat').length) return;
  const now = Date.now();
  DEFAULT_TCATS.forEach(([key, icon], i) => {
    const id = 'tcat_' + key;
    S.docs[id] = { id, kind: 'lst', list: 'tcat', key, icon, name: '', info: '', order: i, ca: now, ua: now, by: S.me.id };
    S.dirty[id] = 1;
  });
}

/* ================= Screens (stack) ================= */

function push(screen) { ui.stack.push(screen); render(); window.scrollTo(0, 0); }
function pop() {
  const s = ui.stack.pop();
  if (s && s.onClose) s.onClose();
  render();
}

window.onBack = () => {
  if (closeModal()) return true;
  if ($('#viewer')) { $('#viewer').remove(); return true; }
  if (ui.stack.length) { pop(); return true; }
  if (ui.tab !== 'agenda') { ui.tab = 'agenda'; render(); return true; }
  return false;
};

function renderScreen(s) {
  const body = s.type === 'edit' ? renderEdit(s) : s.type === 'settings' ? renderSettings() : s.type === 'lists' ? renderLists(s) : s.type === 'help' ? renderHelp() : '';
  const title = s.type === 'edit' ? (s.isNew ? t('new_' + s.doc.kind) : t('edit_' + s.doc.kind))
    : s.type === 'settings' ? t('settings') : s.type === 'lists' ? t('lists') : t('help_title');
  app().innerHTML = `
    <header class="bar">
      <button class="icon-btn back" data-act="back" aria-label="${esc(t('back'))}">${S.settings.lang === 'ar' ? '→' : '←'}</button>
      <h1>${esc(title)}</h1>
      ${winModeBtn()}
      ${s.type === 'edit' ? `<button class="btn save" data-act="save">${esc(t('save'))}</button>` : ''}
    </header>
    <main class="content screen">${body}</main>`;
  if (s.type === 'edit') { bindEdit(s); fitAll(app()); }
}

/* ---------- Edit ---------- */

function newDoc(kind) {
  const d = { kind, title: '', when: null, rem: [], remAt: null, notes: '', photos: [], done: false };
  const later = Date.now() + 86400000;
  const def = new Date(later); def.setMinutes(0, 0, 0);
  if (kind === 'appt') { d.sub = 'doctor'; d.when = def.getTime(); d.rem = [1440, 60]; }
  if (kind === 'visit') { d.when = def.getTime(); d.rem = [60]; }
  if (kind === 'shop') { d.cat = ui.shopCat || ''; d.qty = ''; }
  if (kind === 'task') { d.rem = [0]; d.tcat = ui.taskCat || ''; }
  return d;
}

function openEdit(doc, isNew) {
  const copy = JSON.parse(JSON.stringify(doc));
  const scr = { type: 'edit', doc: copy, isNew, added: [] };
  scr.onClose = () => {
    if (!scr.saved) scr.added.forEach(p => N.deletePhotoLocal(p));
  };
  push(scr);
}

function selectHtml(name, list, value, emptyLabel) {
  const items = listItems(list);
  return `<div class="selrow"><select name="${name}" data-list="${list}">
    <option value="">${esc(emptyLabel || '—')}</option>
    ${items.map(i => `<option value="${i.id}" ${i.id === value ? 'selected' : ''}>${esc((i.icon ? i.icon + ' ' : '') + lstName(i))}</option>`).join('')}
  </select><button type="button" class="btn small" data-newlst="${list}" data-for="${name}">＋</button></div>`;
}

/** Text boxes wrap and grow with their text, so everything typed stays visible without sideways scrolling. */
function fitText(el) {
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight + 2) + 'px';
}
function fitAll(root) { (root || document).querySelectorAll('textarea.grow').forEach(fitText); }
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('textarea.grow')) fitText(e.target); });
document.addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  ui.q = e.target.value;
  const body = $('#agbody');
  if (body) body.innerHTML = tabContent();
  const bar = e.target.parentNode;
  const x = bar.querySelector('.sclear');
  if (ui.q && !x) bar.insertAdjacentHTML('beforeend', `<button class="sclear" data-act="clearq" aria-label="✕">✕</button>`);
  if (!ui.q && x) x.remove();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('textarea.single')) e.preventDefault();
});
window.addEventListener('resize', () => fitAll());

function field(label, inner) { return `<label class="field"><span>${esc(label)}</span>${inner}</label>`; }

function renderEdit(s) {
  const d = s.doc;
  if (d.kind === 'net') return renderNetEdit(s);
  if (d.kind === 'elec') return renderElecEdit(s);
  let f = '';
  if (d.kind === 'appt') {
    f += `<div class="seg">${['doctor', 'hospital', 'test'].map(k => `<button type="button" class="${d.sub === k ? 'on' : ''}" data-sub="${k}">${k === 'doctor' ? '🩺' : k === 'hospital' ? '🏥' : '🧪'} ${esc(t('sub_' + k))}</button>`).join('')}</div>`;
    f += field(t('for_whom'), selectHtml('for', 'person', d.for, t('nobody')));
    f += field(t('hospital_place'), selectHtml('place', 'place', d.place));
    f += field(t('doctor'), selectHtml('doctor', 'doctor', d.doctor));
    f += field(t('department'), txArea('dept', d.dept, t('department_ph')));
    f += field(t('title_opt'), txArea('title', d.title));
  } else if (d.kind === 'visit') {
    f += field(t('visit_whom'), txArea('title', d.title, t('visit_whom_ph')));
    f += field(t('address'), txArea('address', d.address));
    f += field(t('who_goes'), selectHtml('for', 'person', d.for, t('everyone')));
  } else if (d.kind === 'shop') {
    f += field(t('item_name'), txArea('title', d.title, t('item_name_ph')));
    f += `<div class="two">${field(t('qty'), `<input name="qty" ${txAttrs(d.qty)} placeholder="1">`)}${field(t('category'), selectHtml('cat', 'cat', d.cat, t('no_cat')))}</div>`;
    f += field(t('for_whom'), selectHtml('for', 'person', d.for, t('nobody')));
  } else if (d.kind === 'task') {
    f += field(t('task_title'), txArea('title', d.title));
    f += field(t('task_class'), selectHtml('tcat', 'tcat', d.tcat, t('no_tclass')));
    f += field(t('assigned'), selectHtml('for', 'person', d.for, t('nobody')));
  }
  const whenLabel = d.kind === 'shop' || d.kind === 'task' ? t('when_opt') : t('when');
  f += field(whenLabel, `<input type="datetime-local" name="when" value="${toInput(d.when)}">`);
  f += `<div class="field"><span>🔔 ${esc(t('reminders'))}</span>
    <div class="chips wrap">${REM_OPTIONS.map(m => `<button type="button" class="chip ${(d.rem || []).includes(m) ? 'on' : ''}" data-rem="${m}">${esc(remLabel(m))}</button>`).join('')}</div>
    ${!d.when && (d.rem || []).length ? `<small class="muted">${esc(t('rem_need_time'))}</small>` : ''}
  </div>`;
  f += field(t('rem_at'), `<input type="datetime-local" name="remAt" value="${toInput(d.remAt)}">`);
  f += field(t('notes'), txArea('notes', d.notes, '', true));
  f += `<div class="field"><span>🖼️ ${esc(t('photos'))}</span><div class="photos">
    ${photoOrder(d).map(p => photoEditItem(d, p, true)).join('')}
    ${isDesktop() ? '' : `<button type="button" class="ph-add" data-pick="camera">📷<small>${esc(t('camera'))}</small></button>`}
    <button type="button" class="ph-add" data-pick="gallery">🖼️<small>${esc(t('gallery'))}</small></button>
  </div></div>`;
  if (d.kind === 'shop' || d.kind === 'task' || !s.isNew) {
    f += `<label class="switch big"><input type="checkbox" name="done" ${d.done ? 'checked' : ''}> ${esc(d.kind === 'shop' ? t('bought') : t('done'))}</label>`;
  }
  const place = d.kind === 'appt' ? lst(d.place) : null;
  const doc = d.kind === 'appt' ? lst(d.doctor) : null;
  let actions = '';
  if (d.kind === 'visit' && !s.isNew && d.address) actions += `<button type="button" class="btn" data-map="${esc(d.address)}">🗺️ ${esc(t('open_map'))}</button>`;
  if (d.kind === 'appt' && !s.isNew) {
    // Older hospital entries kept the address in the note field.
    const legacy = l => l.list === 'place' && !l.address && !l.geo && l.info ? Object.assign({}, l, { address: l.info }) : l;
    [doc, place].filter(Boolean).forEach(l => {
      const b = contactButtons(legacy(l));
      if (b) f += `<div class="field"><span>${l.list === 'place' ? '🏥' : '👨‍⚕️'} ${esc(lstName(l))}</span><div class="actions cbtns">${b}</div></div>`;
    });
  }
  if (!s.isNew) actions += `<button type="button" class="btn" data-act="sharedoc">📤 ${esc(t('share'))}</button>`;
  if (actions) f += `<div class="actions">${actions}</div>`;
  if (!s.isNew) {
    const by = tx(d.byName) || '';
    f += `<p class="meta">${esc(t('added_by', { name: by || '—', date: fmtWhen(d.ca) }))}${d.uby && d.ua !== d.ca ? '<br>' + esc(t('updated_by', { name: tx(d.uby), date: fmtWhen(d.ua) })) : ''}</p>`;
    if (isAdmin()) f += `<button type="button" class="btn danger wide" data-act="delete">🗑 ${esc(t('delete'))}</button>`;
    else f += `<p class="muted small center">🔒 ${esc(t('only_admin'))}</p>`;
  }
  return `<form id="editform" onsubmit="return false">${f}<div style="height:80px"></div></form>`;
}

function phoneIn(s) { const m = String(s || '').match(/\+?[\d][\d\s()-]{6,}\d/); return m ? m[0].replace(/[\s()-]/g, '') : ''; }

function readForm(s) {
  const form = $('#editform');
  if (!form) return;
  const d = s.doc;
  form.querySelectorAll('input[name],select[name],textarea[name]').forEach(el => {
    const n = el.name;
    if (el.type === 'checkbox') d[n] = el.checked;
    else if (el.type === 'datetime-local') d[n] = fromInput(el.value);
    else if (el.type === 'date') d[n] = dateOut(el.value);
    else d[n] = txRead(el);
  });
}

function bindEdit(s) {
  const form = $('#editform');
  form.addEventListener('change', () => readForm(s));
  form.addEventListener('input', () => readForm(s));
}

function saveEdit(s) {
  readForm(s);
  const d = s.doc;
  if ((d.kind === 'shop' || d.kind === 'task' || d.kind === 'visit') && !d.title) { N.toast(t('need_title')); return; }
  if ((d.kind === 'appt' || d.kind === 'visit') && !d.when) { N.toast(t('need_when')); return; }
  if (d.kind === 'net') { d.name = (d.name || '').trim(); if (!d.name) { N.toast(t('net_need_name')); return; } d.title = d.name; }
  if (d.kind === 'elec') {
    d.name = (d.name || '').trim(); d.meterNo = String(d.meterNo || '').trim();
    if (!d.name) { N.toast(t('elec_need_name')); return; }
    d.title = d.name;
    const fv = elecNum(d.firstV);
    if (s.isNew && fv !== null) d.reads = [{ id: uid(), v: fv, at: d.firstAt || Date.now(), note: '', by: S.me.name || '', ca: Date.now() }];
    delete d.firstV; delete d.firstAt;
  }
  s.added.forEach(p => { if (d.photos.includes(p) && !S.photoUp.includes(p)) S.photoUp.push(p); });
  const before = S.docs[d.id];
  if (!!d.done !== !!(before && before.done)) setDone(d, !!d.done);
  s.saved = true;
  putDoc(d);
  ui.tab = d.kind === 'net' || d.kind === 'elec' ? d.kind : ui.tab === 'agenda' ? 'agenda' : KINDS[d.kind].tab;
  pop();
  N.toast(t('saved'));
}

/* ---------- Settings ---------- */

function renderSettings() {
  const sy = S.sync;
  let syncHtml;
  if (!sy.enabled) {
    syncHtml = `<p class="muted">${esc(t('sync_off_desc'))}</p>
      <button class="btn primary wide" data-act="create">👑 ${esc(t('create_family'))}</button>
      <button class="btn wide" data-act="join">🔗 ${esc(t('join_family'))}</button>
      ${hasBuiltin() ? '' : `<button class="link" data-act="help">❓ ${esc(t('help_title'))}</button>`}`;
  } else {
    const admin = isAdmin();
    syncHtml = `<div class="kv"><span>${esc(t('family'))}</span><b>${esc(tx(sy.familyName) || '—')}</b></div>
      <div class="kv"><span>${esc(t('this_phone'))}</span><b>${sy.adminUid === sy.uid ? '👑 ' + esc(t('main_phone')) : admin ? '🔑 ' + esc(t('full_rights')) : esc(t('member'))}</b></div>
      <div class="kv"><span>${esc(t('last_sync'))}</span><b>${sy.lastSync ? esc(fmtWhen(sy.lastSync)) : '—'}</b></div>
      ${sy.lastError ? `<p class="error">⚠️ ${esc(sy.lastError)}</p>` : ''}
      ${shortCodeUsable() ? `<div class="codebox"><small>${esc(t('pair_code'))}</small><b>${esc(showCode(sy.fid))}</b>
        <button class="btn small" data-copycode="${esc(showCode(sy.fid))}">📋 ${esc(t('copy'))}</button></div>` : ''}
      <button class="btn primary wide" data-act="invite">📤 ${esc(t('share_invite'))}</button>
      <button class="btn wide" data-act="syncnow">🔄 ${esc(t('sync_now'))}</button>
      <h4>${esc(t('members'))}</h4>
      <div class="card">${(sy.members || []).map(m => `<div class="row static"><span class="kicon">${m.uid === sy.adminUid ? '👑' : isCoAdmin(m.uid) ? '🔑' : '📱'}</span>
        <div class="rtext"><div class="rtitle">${esc(tx(m.name))}${m.uid === sy.uid ? ' (' + esc(t('you')) + ')' : ''}</div>${isCoAdmin(m.uid) ? `<div class="rmeta">🔑 ${esc(t('full_rights'))}</div>` : ''}</div>
        ${admin && m.uid !== sy.uid && m.uid !== sy.adminUid ? `<button class="btn small" data-fullrights="${m.uid}" title="${esc(t('full_rights'))}">${isCoAdmin(m.uid) ? '🔒' : '🔑'}</button><button class="btn small" data-mkadmin="${m.uid}">👑</button><button class="btn small danger" data-rmmember="${m.uid}">✕</button>` : ''}
      </div>`).join('') || `<p class="muted pad">—</p>`}</div>
      <button class="link danger" data-act="leave">${esc(t('leave_family'))}</button>`;
  }
  return `
    <section class="card pad">
      ${field(t('my_name'), `<input id="myname" value="${esc(S.me.name)}" placeholder="${esc(t('my_name_ph'))}">`)}
      <div class="field"><span>🌐 ${esc(t('language'))}</span><div class="seg">
        ${[['tr', 'Türkçe'], ['en', 'English'], ['ar', 'العربية']].map(([k, l]) => `<button class="${S.settings.lang === k ? 'on' : ''}" data-lang="${k}">${l}</button>`).join('')}
      </div></div>
    </section>
    <section class="card pad">
      <h4>📋 ${esc(t('lists'))}</h4>
      <p class="muted small">${esc(t('lists_desc'))}</p>
      <div class="grid2">${LISTS.map(l => `<button class="btn" data-lists="${l}">${esc(t('list_' + l))} (${listItems(l).length})</button>`).join('')}</div>
    </section>
    <section class="card pad">
      <h4>🔔 ${esc(t('reminders'))}</h4>
      <label class="switch"><input type="checkbox" data-setting="onlyMine" ${S.settings.onlyMine ? 'checked' : ''}> ${esc(t('only_mine'))}</label>
      ${field(t('me_person'), `<select id="meperson"><option value="">${esc(t('me_person_auto'))}${myPerson() && !S.settings.person ? ' (' + esc(lstName(lst(myPerson()))) + ')' : ''}</option>${listItems('person').map(i => `<option value="${i.id}" ${S.settings.person === i.id ? 'selected' : ''}>${esc(lstName(i))}</option>`).join('')}</select>`)}
      <p class="muted small">${esc(t('me_person_note'))}</p>
      <p class="muted small">${esc(t('reminder_note'))}</p>
    </section>
    <section class="card pad">
      <h4>☁️ ${esc(t('family_sync'))}</h4>
      ${syncHtml}
    </section>
    <section class="card pad">
      <h4>📶 ${esc(t('lan_title'))}</h4>
      <p class="muted small">${esc(t('lan_desc'))}</p>
      <button class="btn wide" data-act="lan">📶 ${esc(t('lan_open'))}</button>
    </section>
    <section class="card pad">
      <h4>⬆️ ${esc(t('upd_title'))}</h4>
      <div class="kv"><span>${esc(t('app_name'))}</span><b>v${esc(N.version())}</b></div>
      ${updateStatusHtml()}
      <p class="muted small">${esc(t('upd_auto_note'))}</p>
    </section>
    <section class="card pad">
      <h4>✉️ ${esc(t('ct_title'))}</h4>
      <p class="muted small">${esc(t('ct_desc'))}</p>
      ${field(t('ct_name'), `<input id="ctname" dir="auto" maxlength="80" value="${esc(S.me.name || '')}">`)}
      ${field(t('ct_mail'), `<input id="ctmail" dir="ltr" maxlength="120" inputmode="email" placeholder="ornek@mail.com">`)}
      ${field(t('ct_msg'), `<textarea id="ctmsg" dir="auto" maxlength="5000" rows="5"></textarea>`)}
      <button class="btn primary wide" data-act="ctsend">✉️ ${esc(t('ct_send'))}</button>
    </section>`;
}

/* ---------- Contact the admin ----------
   Messages go to the administrator's mailbox through FormSubmit; the address is not shown. */
const ADMIN_TO = atob('').split('').reverse().join('');
let ctBusy = false;
async function sendContact() {
  if (ctBusy) return;
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  const msg = v('ctmsg'), mail = v('ctmail'), name = v('ctname');
  if (!msg) { N.toast(t('ct_empty')); return; }
  if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { N.toast(t('ct_badmail')); return; }
  const body = { _subject: 'Ajandam: yeni mesaj', _template: 'table', _captcha: 'false', Ad: name || '-', Mesaj: msg, Surum: N.version(), Cihaz: N.platform ? N.platform() : 'android', Dil: S.settings.lang };
  if (mail) { body.email = mail; body._replyto = mail; }
  ctBusy = true; N.toast(t('ct_sending'));
  try {
    const r = await nat('http', 'POST', 'https://formsubmit.co/ajax/' + ADMIN_TO, JSON.stringify(body), false);
    let j = {}; try { j = JSON.parse(r.body || '{}'); } catch (e) {}
    if ((r.status >= 200 && r.status < 300 && String(j.success) !== 'false') || /activat/i.test(j.message || '')) {
      const el = document.getElementById('ctmsg'); if (el) el.value = '';
      N.toast(t('ct_sent'));
    } else N.toast(t('ct_fail'));
  } catch (e) { N.toast(t('ct_fail')); }
  ctBusy = false;
}

/* ---------- Lists manager ---------- */

/* ---------- Hospitals and doctors: contact details ---------- */

const CONTACT_LISTS = ['place', 'doctor'];

function dirItems() { return listItems('place').concat(listItems('doctor')); }

/** Number in international form for WhatsApp links (Turkish numbers may be typed starting with 0). */
function waNumber(phone) {
  let n = String(phone || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  else if (n.length === 11 && n.startsWith('0')) n = '90' + n.slice(1);
  else if (n.length === 10 && n.startsWith('5')) n = '90' + n;
  return n;
}

/** "lat,lng" from typed coordinates or a pasted map link, else ''. */
function parseGeo(s) {
  const m = String(s || '').match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  return m ? m[1] + ',' + m[2] : '';
}

function contactPhone(l) { return (l && (l.phone || phoneIn(l.info))) || ''; }

const WA_ICON = '<svg class="waicon" viewBox="0 0 32 32" aria-hidden="true"><path fill="#25D366" d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.4.7 4.7 1.9 6.7L3 29l6.9-2.1c1.9 1 4 1.6 6.1 1.6 7 0 12.7-5.7 12.7-12.7S23 3 16 3z"/><path fill="#fff" d="M12 9.6c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1.1.5-.4.4-1.4 1.4-1.4 3.4s1.5 4 1.7 4.2c.2.3 2.9 4.6 7.1 6.3 3.5 1.4 4.2 1.1 5 1 .8-.1 2.4-1 2.8-2 .3-1 .3-1.8.2-2-.1-.2-.4-.3-.8-.5l-2.8-1.4c-.4-.1-.6-.2-.9.2-.3.4-1 1.3-1.3 1.5-.2.3-.5.3-.9.1-.4-.2-1.7-.6-3.2-2-1.2-1.1-2-2.4-2.2-2.8-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3 0-.5 0-.7l-1.3-3.1z"/></svg>';

/** Call / WhatsApp / map / e-mail buttons for a hospital or doctor. */
function contactButtons(l, small) {
  if (!l) return '';
  const cls = 'btn' + (small ? ' small' : '');
  const phone = contactPhone(l);
  const geo = parseGeo(l.geo);
  const link = /^https?:\/\//.test((l.geo || '').trim()) ? l.geo.trim() : '';
  let h = '';
  if (phone && !isDesktop()) h += `<a class="${cls}" data-ext href="tel:${esc(phone.replace(/[^\d+]/g, ''))}">📞 ${esc(t('call'))}</a>`;
  if (phone && l.wa && waNumber(phone)) h += `<a class="${cls} wa" data-ext href="https://wa.me/${waNumber(phone)}">${WA_ICON} WhatsApp</a>`;
  if (geo || (!link && l.address)) h += `<button type="button" class="${cls}" data-map="${esc(geo || l.address)}">📍 ${esc(t('open_map'))}</button>`;
  else if (link) h += `<a class="${cls}" data-ext href="${esc(link)}">📍 ${esc(t('open_map'))}</a>`;
  if (l.email) h += `<a class="${cls}" data-ext href="mailto:${esc(l.email)}">✉️ ${esc(t('email'))}</a>`;
  return h;
}

/** A hospital or doctor in the Health tab's directory. */
function dirRow(l) {
  const ph = (l.photos || []).find(p => N.photoUrl(p));
  const kind = l.logo ? catIcon(l) : l.list === 'place' ? '🏥' : '👨‍⚕️';
  const meta = [l.spec ? tx(l.spec) : '', l.address ? tx(l.address) : '', contactPhone(l), l.info && !l.address ? tx(l.info) : ''].filter(Boolean);
  return `<div class="row dir" data-editlst="${l.id}">
    <div class="rtext">
      <div class="rtitle"><span class="ricon">${kind}</span> <span class="rname">${esc(lstName(l))}</span>${l.wa && contactPhone(l) ? ' ' + WA_ICON : ''}</div>
      ${meta.length ? `<div class="rmeta">${esc(meta.join(' · '))}</div>` : ''}
      <div class="cbtns">${contactButtons(l, true)}</div>
    </div>
    ${ph ? `<img class="thumb" src="${esc(N.photoUrl(ph))}" data-view="${esc(ph)}" data-of="${l.id}" alt="">` : ''}
  </div>`;
}

function renderDirectory() {
  const items = dirItems();
  return `<h3 class="day">📇 ${esc(t('directory'))}</h3>
    ${items.length ? `<div class="card">${items.map(dirRow).join('')}</div>` : `<p class="muted small">${esc(t('directory_empty'))}</p>`}
    <div class="actions"><button class="btn" data-newlst="place">＋ 🏥 ${esc(t('add_hospital'))}</button><button class="btn" data-newlst="doctor">＋ 👨‍⚕️ ${esc(t('add_doctor'))}</button></div>`;
}

function renderLists(s) {
  const l = s.list;
  const items = listItems(l);
  return `<div class="seg wrap">${LISTS.map(k => `<button class="${k === l ? 'on' : ''}" data-lists-tab="${k}">${esc(t('list_' + k))}</button>`).join('')}</div>
    <div class="card">${items.map(i => `<div class="row" data-editlst="${i.id}">
      ${LOGO_LISTS.includes(l) ? `<span class="kicon">${catIcon(i)}</span>` : ''}
      <div class="rtext"><div class="rtitle">${esc(lstName(i))}${i.wa && contactPhone(i) ? ' ' + WA_ICON : ''}</div>${i.info || i.address || i.phone ? `<div class="rmeta">${esc([tx(i.address), i.phone, tx(i.info)].filter(Boolean).join(' · '))}</div>` : ''}</div>
      ${isAdmin() ? `<button class="btn small danger" data-dellst="${i.id}">✕</button>` : ''}
    </div>`).join('') || `<p class="muted pad">${esc(t('list_empty'))}</p>`}</div>
    <button class="btn primary wide" data-newlst="${l}">＋ ${esc(t('add_to_list', { list: t('list_' + l) }))}</button>
    ${!isAdmin() ? `<p class="muted small center">🔒 ${esc(t('only_admin'))}</p>` : ''}`;
}

const PLAIN_COLORS = ['#2E6B5E', '#E85D4A', '#3B6FB6', '#8A5CC2', '#D99A1E', '#6B7570'];
function plainLogoHtml(logo, name, cls) {
  const color = PLAIN_COLORS[+logo.split(':')[1] || 0] || PLAIN_COLORS[0];
  const letter = (String(name || '?').trim()[0] || '?').toLocaleUpperCase(locale());
  return `<span class="plainlogo ${cls || ''}" style="background:${color}">${esc(letter)}</span>`;
}

// All built-in logos, everyday objects/food/places first; letter blocks and flags last.
let allLogoCache = null;
function allLogos() {
  if (allLogoCache) return allLogoCache;
  const rank = f => {
    const c = parseInt(f, 16);
    if (c >= 0x1f345 && c <= 0x1f37f) return 0;
    if (c >= 0x1f380 && c <= 0x1f3ff) return 1;
    if (c >= 0x1f400 && c <= 0x1f4ff) return 1;
    if (c >= 0x1f950 && c <= 0x1f9ff) return 1;
    if (c >= 0x1f300 && c <= 0x1f344) return 2;
    if (c >= 0x1f500 && c <= 0x1f6ff) return 2;
    if (c >= 0x1fa70) return 2;
    if (c >= 0x1f900) return 3;
    if (c < 0x1f300 || f.includes('-1f1')) return 5;
    return 4;
  };
  allLogoCache = EMOJI_INDEX.map(e => e[0]).filter(f => !/^1f1[ef]/.test(f)).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1)).map(f => 'tw:' + f);
  return allLogoCache;
}

function editListItem(list, existing, onDone) {
  const it = existing || { list, name: '', info: '', icon: list === 'place' ? '🏥' : list === 'doctor' ? '🧑‍⚕️' : LOGO_LISTS.includes(list) ? '📦' : '' };
  const infoLabel = list === 'place' ? t('info_place') : list === 'doctor' ? t('info_doctor') : list === 'person' ? t('info_person') : list === 'tcat' ? t('info_tcat') : t('info_cat');
  const current = it.logo || (twemojiFor(it.icon) ? 'tw:' + twemojiFor(it.icon) : '');
  const PER_PAGE = 24;
  openModal(`
    <h3>${esc(existing ? t('edit') : t('add_to_list', { list: t('list_' + list) }))}</h3>
    ${field(t('name'), `<textarea id="m-name" class="grow single" rows="1" autocomplete="off">${esc(lstName(it))}</textarea>`)}
    ${field(CONTACT_LISTS.includes(list) ? t('notes') : infoLabel, txArea('', it.info, '', true, 'm-info'))}
    ${CONTACT_LISTS.includes(list) ? contactFields(it) : ''}
    ${CONTACT_LISTS.includes(list) ? `<div class="field"><span>🩺 ${esc(t('specialty'))}</span>${txArea('', it.spec, t('specialty_ph'), false, 'm-spec')}
      <div class="chips wrap specchips">${SPECIALTIES.filter(sp => list === 'doctor' ? !['hospital', 'pharmacy', 'lab', 'emergency'].includes(sp[0]) : true)
        .map(sp => `<button type="button" class="chip" data-spec="${sp[0]}">${sp[4]} ${esc(specLabel(sp, S.settings.lang))}</button>`).join('')}</div></div>` : ''}
    ${LOGO_LISTS.includes(list) ? `<div class="field"><span>${esc(t('icon'))} <small class="muted" id="m-findmsg">${esc(CONTACT_LISTS.includes(list) ? t('med_logo_note') : t('auto_logo_note'))}</small></span>
      <div class="seg small" id="m-mode"><button type="button" class="on" data-mode="suggest">${esc(t('logos_suggested'))}</button><button type="button" data-mode="all">${esc(t('logos_all'))}</button></div>
      <div class="logogrid" id="m-logos"></div>
      <div class="pager" id="m-pager"></div>
      <div class="plainrow"><small class="muted">${esc(t('logo_plain'))}</small><div class="logogrid" id="m-plain"></div></div>
    </div>` : ''}
    <div class="mbtns"><button class="btn" data-act="mclose">${esc(t('cancel'))}</button><button class="btn primary" id="m-ok">${esc(t('save'))}</button></div>`, root => {
    const nameInput = root.querySelector('#m-name');
    const photos = (it.photos || []).slice();
    const added = [];
    if (CONTACT_LISTS.includes(list)) bindContactFields(root, it, photos, added);
    const box = root.querySelector('#m-logos');
    const specInput = root.querySelector('#m-spec');
    const med = CONTACT_LISTS.includes(list);
    // Hospitals and doctors: logos follow the speciality (typed or tapped), else the name.
    const logoQuery = () => (specInput && txRead(specInput)) || nameInput.value.trim();
    const localFor = q => {
      const sp = med ? guessSpec(q) || guessSpec(nameInput.value) : null;
      const out = sp ? specLogos(sp) : [];
      // A known speciality brings its own pictures; the general picture search would add unrelated ones (a tooth finds sweets).
      if (!sp) localLogos(q, med ? 12 : 96).forEach(l => { if (!out.includes(l)) out.push(l); });
      if (med && !out.length) specLogos(SPECIALTIES.find(x => x[0] === (list === 'place' ? 'hospital' : 'general'))).forEach(l => out.push(l));
      return out;
    };
    const st = { logo: current, manual: !!existing, mode: 'suggest', page: 0, suggest: [], online: [] };
    const cell = l => `<button type="button" class="logo ${l === st.logo ? 'on' : ''}" data-logo="${esc(l)}">${l.startsWith('plain:') ? plainLogoHtml(l, nameInput.value, 'big') : `<img src="${esc(logoSrc(l))}" alt="">`}</button>`;
    const pool = () => st.mode === 'all' ? allLogos() : st.suggest.concat(st.online.filter(x => !st.suggest.includes(x)));
    const draw = () => {
      if (!box) return;
      const all = pool();
      const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
      st.page = Math.min(st.page, pages - 1);
      box.innerHTML = all.slice(st.page * PER_PAGE, (st.page + 1) * PER_PAGE).map(cell).join('')
        || `<span class="muted small span-all">${esc(nameInput.value.trim() ? t('logo_none_plain') : t('logo_type_name'))}</span>`;
      root.querySelector('#m-pager').innerHTML = pages > 1
        ? `<button type="button" class="btn small" data-pg="-1" ${st.page ? '' : 'disabled'}>‹</button><span>${esc(t('page_of', { n: st.page + 1, total: pages }))}</span><button type="button" class="btn small" data-pg="1" ${st.page < pages - 1 ? '' : 'disabled'}>›</button>`
        : '';
      root.querySelector('#m-plain').innerHTML = PLAIN_COLORS.map((c, i) => cell('plain:' + i)).join('');
      root.querySelectorAll('[data-logo]').forEach(b => b.onclick = () => {
        st.logo = b.dataset.logo; st.manual = true;
        root.querySelectorAll('[data-logo]').forEach(x => x.classList.toggle('on', x === b));
      });
      root.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { st.page += +b.dataset.pg; draw(); });
    };
    let seq = 0;
    const search = async () => {
      if (!box) return;
      const name = logoQuery();
      const my = ++seq;
      st.suggest = name ? localFor(name) : [];
      if (st.manual && st.logo && !st.logo.startsWith('plain:') && !st.suggest.includes(st.logo)) st.suggest.unshift(st.logo);
      st.online = [];
      st.page = 0;
      if (!st.manual) st.logo = st.suggest[0] || (name ? 'plain:0' : current);
      draw();
      if (!name) return;
      const msg = root.querySelector('#m-findmsg');
      msg.textContent = t('searching');
      const sp = med ? guessSpec(name) || guessSpec(nameInput.value) : null;
      const online = await onlineLogos(name, S.settings.lang, med ? 32 : 12, med ? { terms: sp ? sp[5] : [list === 'place' ? 'hospital' : 'doctor'], sets: MED_ICON_SETS } : {});
      if (my !== seq || !document.body.contains(box)) return;
      msg.textContent = '';
      st.online = online;
      if (!st.manual && !st.suggest.length && online.length) st.logo = online[0];
      draw();
    };
    root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      st.mode = b.dataset.mode; st.page = 0;
      root.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x === b));
      draw();
    });
    let timer = null;
    const retype = () => {
      if (existing) st.manual = false;
      clearTimeout(timer);
      timer = setTimeout(search, 250);
    };
    nameInput.addEventListener('input', retype);
    if (specInput) {
      specInput.addEventListener('input', retype);
      root.querySelectorAll('[data-spec]').forEach(b => b.onclick = () => {
        const sp = SPECIALTIES.find(x => x[0] === b.dataset.spec);
        specInput.value = specLabel(sp, S.settings.lang);
        fitText(specInput);
        st.manual = false;
        search();
      });
    }
    if (box) {
      const q = (it.spec && tx(it.spec)) || lstName(it);
      st.suggest = q ? localFor(q) : [];
      if (current && !st.suggest.includes(current)) st.suggest.unshift(current);
      draw();
      // Hospitals and doctors look online straight away, so there are many choices to pick from.
      if (med && q && existing) search();
    }
    setTimeout(() => nameInput.focus(), 50);
    root.querySelector('#m-ok').onclick = () => {
      const name = nameInput.value.trim();
      if (!name) { N.toast(t('need_title')); return; }
      if (LOGO_LISTS.includes(list) && !st.logo) st.logo = localLogos(name, 1)[0] || 'plain:0';
      const d = existing ? JSON.parse(JSON.stringify(existing)) : { kind: 'lst', list, order: listItems(list).length + 100 };
      if (!(existing && (existing.key || existing.name) && name === lstName(existing))) { d.name = name; delete d.key; }
      d.info = txRead(root.querySelector('#m-info'));
      if (CONTACT_LISTS.includes(list)) {
        const v = id => root.querySelector(id).value.trim();
        d.spec = txRead(specInput);
        d.address = txRead(root.querySelector('#m-addr'));
        d.phone = v('#m-phone');
        d.wa = root.querySelector('#m-wa').checked;
        d.email = v('#m-email');
        d.geo = parseGeo(v('#m-geo')) || v('#m-geo');
        d.photos = photos.slice();
        added.forEach(p => { if (d.photos.includes(p) && !S.photoUp.includes(p)) S.photoUp.push(p); });
        if (existing) (existing.photos || []).filter(p => !d.photos.includes(p)).forEach(p => { S.photoDel.push(p); S.photoUp = S.photoUp.filter(x => x !== p); N.deletePhotoLocal(p); });
      }
      if (LOGO_LISTS.includes(list)) {
        d.logo = st.logo;
        if (!d.icon) d.icon = list === 'place' ? '🏥' : list === 'doctor' ? '🧑‍⚕️' : '📦';
      }
      delete d.def;
      const saved = putDoc(d);
      closeModal();
      if (onDone) onDone(saved);
      else render();
    };
  });
}

function contactFields(it) {
  return `${field('📍 ' + t('address'), txArea('', it.address, '', true, 'm-addr'))}
    ${field('📞 ' + t('phone'), `<input id="m-phone" type="tel" value="${esc(it.phone || '')}" placeholder="0212 000 00 00">`)}
    <label class="switch"><input type="checkbox" id="m-wa" ${it.wa ? 'checked' : ''}> ${WA_ICON} ${esc(t('has_whatsapp'))}</label>
    ${field('✉️ ' + t('email'), `<input id="m-email" type="email" value="${esc(it.email || '')}">`)}
    <div class="field"><span>🧭 ${esc(t('coords'))}</span>
      <input id="m-geo" value="${esc(it.geo || '')}" placeholder="41.0082, 28.9784">
      <small class="muted">${esc(t('coords_help'))}</small>
      <div class="actions"><button type="button" class="btn small" id="m-findmap">🗺️ ${esc(t('find_on_map'))}</button><button type="button" class="btn small" id="m-pastegeo">📋 ${esc(t('paste'))}</button></div>
      <small id="m-geook" class="muted"></small>
    </div>
    <div class="field"><span>🖼️ ${esc(t('photos'))}</span><div class="photos" id="m-photos"></div></div>`;
}

function bindContactFields(root, it, photos, added) {
  const geo = root.querySelector('#m-geo');
  const ok = root.querySelector('#m-geook');
  const showGeo = () => { const g = parseGeo(geo.value); ok.textContent = g ? '✓ ' + g : (geo.value.trim() && !/^https?:/.test(geo.value.trim()) ? t('coords_bad') : ''); };
  geo.addEventListener('input', showGeo);
  showGeo();
  root.querySelector('#m-pastegeo').onclick = () => { const p = N.paste(); if (p) { geo.value = parseGeo(p) || p.trim(); showGeo(); } };
  root.querySelector('#m-findmap').onclick = () => {
    const q = [root.querySelector('#m-name').value, txRead(root.querySelector('#m-addr'))].filter(x => x && x.trim()).join(', ');
    if (q) N.openMap(q); else N.toast(t('need_title'));
  };
  const box = root.querySelector('#m-photos');
  const draw = () => {
    box.innerHTML = photos.map(p => { const u = N.photoUrl(p); return `<div class="ph-item">${u ? `<img src="${esc(u)}" data-view="${p}"${it.id ? ` data-of="${it.id}"` : ''}>` : '<div class="ph-missing">⏳</div>'}${added.includes(p) || isAdmin() ? `<button type="button" class="ph-del" data-lphdel="${p}">✕</button>` : ''}</div>`; }).join('')
      + (isDesktop() ? '' : `<button type="button" class="ph-add" data-lpick="camera">📷<small>${esc(t('camera'))}</small></button>`)
      + `<button type="button" class="ph-add" data-lpick="gallery">🖼️<small>${esc(t('gallery'))}</small></button>`;
    box.querySelectorAll('[data-lpick]').forEach(b => b.onclick = async () => {
      const ids = await nat('pickPhoto', b.dataset.lpick);
      if (Array.isArray(ids) && ids.length) { ids.forEach(id => { photos.push(id); added.push(id); }); draw(); }
    });
    box.querySelectorAll('[data-lphdel]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const i = photos.indexOf(b.dataset.lphdel);
      if (i >= 0) photos.splice(i, 1);
      draw();
    });
  };
  draw();
}

/** Last resort for names nothing built-in matches: look on the internet in the background. */
async function autoLogo(id, name) {
  try {
    const logos = await onlineLogos(name, S.settings.lang, 1);
    const d = S.docs[id];
    if (!logos.length || !d || d.logo || lstName(d) !== name) return;
    const c = JSON.parse(JSON.stringify(d));
    c.logo = logos[0];
    putDoc(c);
    if (!ui.stack.some(x => x.type === 'edit') && !$('#modal')) render();
  } catch (e) { console.error(e); }
}

/* ---------- Help ---------- */

const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function fam(fid) { return get(/databases/$(db)/documents/families/$(fid)).data; }
    function isAdmin(fid) {
      return signedIn() && (fam(fid).adminUid == request.auth.uid || request.auth.uid in fam(fid).get('admins', []));
    }
    function isMember(fid) {
      return signedIn() && exists(/databases/$(db)/documents/families/$(fid)/members/$(request.auth.uid));
    }
    match /appUpdates/{id} {
      allow read: if true;
      allow write: if signedIn() && request.auth.uid == 'MLR194aTfBMfDjG7ztEDgXH3ZKu2';
    }
    match /families/{fid} {
      allow get: if signedIn();
      allow create: if signedIn() && request.resource.data.adminUid == request.auth.uid;
      allow update: if isAdmin(fid);
      match /members/{uid} {
        allow read: if isMember(fid);
        allow create, update: if signedIn() && request.auth.uid == uid;
        allow delete: if isAdmin(fid);
      }
      match /docs/{id} {
        allow read, create, update: if isMember(fid);
        allow delete: if isAdmin(fid);
      }
      match /photos/{id} {
        allow read, create, update: if isMember(fid);
        allow delete: if isAdmin(fid);
      }
    }
  }
}`;

function renderHelp() {
  return `<section class="card pad help">
    <p>${esc(t('help_intro'))}</p>
    <ol>${[1, 2, 3, 4, 5, 6].map(i => `<li>${esc(t('help_' + i))}</li>`).join('')}</ol>
    <button class="btn wide" data-act="copyrules">📋 ${esc(t('copy_rules'))}</button>
    <pre class="rules">${esc(RULES)}</pre>
    <p class="muted small">${esc(t('help_free'))}</p>
  </section>`;
}

/* ---------- Modal ---------- */

function openModal(html, bind) {
  closeModal();
  const m = document.createElement('div');
  m.id = 'modal';
  m.innerHTML = `<div class="mback" data-act="mclose"></div><div class="mbox">${html}</div>`;
  document.body.appendChild(m);
  if (bind) bind(m.querySelector('.mbox'));
  fitAll(m);
}
function closeModal() { const m = $('#modal'); if (m) { m.remove(); return true; } return false; }

function confirmBox(text, okLabel, onOk, danger) {
  openModal(`<p class="mtext">${esc(text)}</p><div class="mbtns"><button class="btn" data-act="mclose">${esc(t('cancel'))}</button><button class="btn ${danger ? 'danger' : 'primary'}" id="m-ok">${esc(okLabel)}</button></div>`,
    root => { root.querySelector('#m-ok').onclick = () => { closeModal(); onOk(); }; });
}

function busyBox(text) {
  openModal(`<div class="center pad"><div class="spinner"></div><p>${esc(text)}</p></div>`);
}

function chooseKind() {
  const kinds = [['appt', '🩺'], ['visit', '🏠'], ['shop', '🛒'], ['task', '✅']];
  openModal(`<h3>${esc(t('what_add'))}</h3><div class="kindgrid">${kinds.map(([k, i]) => `<button class="kind" data-newkind="${k}"><span>${i}</span>${esc(t('new_' + k))}</button>`).join('')}</div>`);
}

function createFamilyDialog() {
  openModal(`<h3>👑 ${esc(t('create_family'))}</h3>
    <p class="muted small">${esc(hasBuiltin() ? t('create_desc_builtin') : t('create_desc'))}</p>
    ${field(t('family_name'), `<input id="m-fname" value="${esc(S.sync.familyName || '')}" placeholder="${esc(t('family_name_ph'))}">`)}
    ${field(t('my_name'), `<input id="m-me" value="${esc(S.me.name)}">`)}
    <div ${hasBuiltin() ? 'hidden' : ''}>
    ${field(t('fb_config'), `<textarea id="m-cfg" rows="4" placeholder="apiKey: &quot;AIza...&quot;, projectId: &quot;aile-xxxx&quot;"></textarea>`)}
    ${field('apiKey', `<input id="m-key" value="${esc(BUILTIN_FB.apiKey || S.sync.apiKey || '')}">`)}
    ${field('projectId', `<input id="m-pid" value="${esc(BUILTIN_FB.projectId || S.sync.projectId || '')}">`)}
    <button class="link" data-act="help">❓ ${esc(t('help_title'))}</button>
    </div>
    <div class="mbtns"><button class="btn" data-act="mclose">${esc(t('cancel'))}</button><button class="btn primary" id="m-ok">${esc(t('create'))}</button></div>`, root => {
    root.querySelector('#m-cfg').addEventListener('input', e => {
      const c = parseFirebaseConfig(e.target.value);
      if (c.apiKey) root.querySelector('#m-key').value = c.apiKey;
      if (c.projectId) root.querySelector('#m-pid').value = c.projectId;
    });
    root.querySelector('#m-ok').onclick = async () => {
      const key = root.querySelector('#m-key').value.trim();
      const pid = root.querySelector('#m-pid').value.trim();
      const fname = root.querySelector('#m-fname').value.trim() || t('family_name_ph');
      const me = root.querySelector('#m-me').value.trim();
      if (!key || !pid) { N.toast(t('need_config')); return; }
      if (me) S.me.name = me;
      busyBox(t('connecting'));
      try {
        await createFamily(key, pid, fname);
        closeModal();
        render();
        await syncNow();
        confirmBox(t('created_ok'), t('share_invite'), () => N.share(inviteText()));
      } catch (e) {
        S.sync.enabled = false;
        closeModal();
        render();
        openModal(`<p class="error">⚠️ ${esc(e.message || e)}</p><div class="mbtns"><button class="btn" data-act="mclose">OK</button></div>`);
      }
    };
  });
}

function inviteText() {
  if (shortCodeUsable()) return t('invite_short', { family: S.sync.familyName, code: showCode(S.sync.fid) });
  return t('invite_msg', { family: S.sync.familyName }) + '\n\n' + makeInvite();
}

/** Accepts the short pairing code or the long AILE: invite. */
function parseJoinCode(text) {
  const inv = parseInvite(text);
  if (inv) return inv;
  const code = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!isShortCode(code)) return { error: t('bad_invite') };
  if (!hasBuiltin()) return { error: t('err_no_builtin') };
  return { k: BUILTIN_FB.apiKey, p: BUILTIN_FB.projectId, f: code, n: '' };
}

function joinFamilyDialog() {
  openModal(`<h3>🔗 ${esc(t('join_family'))}</h3>
    <p class="muted small">${esc(t('join_desc'))}</p>
    ${field(t('my_name'), `<input id="m-me" value="${esc(S.me.name)}">`)}
    ${field(t('invite_code'), `<input id="m-inv" class="codein" autocapitalize="characters" autocomplete="off" placeholder="XXXXX-XXXXX">`)}
    <button class="btn small" id="m-paste">📋 ${esc(t('paste'))}</button>
    <div class="mbtns"><button class="btn" data-act="mclose">${esc(t('cancel'))}</button><button class="btn primary" id="m-ok">${esc(t('join'))}</button></div>`, root => {
    root.querySelector('#m-paste').onclick = () => { root.querySelector('#m-inv').value = N.paste(); };
    root.querySelector('#m-ok').onclick = async () => {
      const inv = parseJoinCode(root.querySelector('#m-inv').value);
      const me = root.querySelector('#m-me').value.trim();
      if (inv.error) { N.toast(inv.error); return; }
      if (me) S.me.name = me;
      busyBox(t('connecting'));
      try {
        await joinFamily(inv);
        closeModal();
        await syncNow();
        N.toast(t('joined_ok'));
      } catch (e) {
        S.sync.enabled = false;
        closeModal();
        render();
        openModal(`<p class="error">⚠️ ${esc(e.message || e)}</p><div class="mbtns"><button class="btn" data-act="mclose">OK</button></div>`);
      }
    };
  });
}


/* ---------- Photo cover (favourite) + edit tiles ---------- */
/** The favourite photo of a doc: d.cover if it is still there and loaded, else the first loaded one. */
function coverOf(d) {
  const ph = (d.photos || []);
  if (d.cover && ph.includes(d.cover) && N.photoUrl(d.cover)) return d.cover;
  return ph.find(p => N.photoUrl(p)) || '';
}
/** Photos with the favourite first. */
function photoOrder(d) {
  const ph = (d.photos || []).slice();
  const c = d.cover && ph.includes(d.cover) ? d.cover : '';
  return c ? [c].concat(ph.filter(p => p !== c)) : ph;
}
/** One tile in a photo editor: picture, ⭐ favourite (optional) and 🗑 delete (everyone, with confirmation). */
function photoEditItem(d, p, star) {
  const u = N.photoUrl(p);
  const fav = star && (d.cover ? d.cover === p : photoOrder(d)[0] === p);
  return `<div class="ph-item${fav ? ' fav' : ''}">${u ? `<img src="${esc(u)}" data-view="${p}" data-of="${d.id}">` : `<div class="ph-missing">⏳</div>`}`
    + (star && u ? `<button type="button" class="ph-star${fav ? ' on' : ''}" data-favphoto="${p}" title="${esc(t('photo_fav'))}">${fav ? '⭐' : '☆'}</button>` : '')
    + `<button type="button" class="ph-del" data-delphoto="${p}" title="${esc(t('delete'))}">🗑</button>`
    + (fav ? `<span class="ph-favtag">${esc(t('photo_fav_on'))}</span>` : '')
    + `</div>`;
}

/* ---------- Photo viewer ---------- */

function viewPhoto(pid, list) {
  const photos = list && list.includes(pid) ? list : [pid];
  let at = photos.indexOf(pid);
  if (!N.photoUrl(pid)) return;
  if ($('#viewer')) $('#viewer').remove();
  const v = document.createElement('div');
  v.id = 'viewer';
  v.innerHTML = `<img alt=""><button class="vclose" aria-label="✕">✕</button>`
    + (photos.length > 1 ? `<button class="vnav prev" aria-label="‹">‹</button><button class="vnav next" aria-label="›">›</button><span class="vcount"></span>` : '');
  const img = v.querySelector('img');
  // Zoom: pinch with two fingers or double-tap; drag to move around a zoomed photo.
  let sc = 1, tx0 = 0, ty0 = 0, pinch = null, drag = null, lastTap = 0, moved = false;
  const apply = () => { img.style.transform = `translate(${tx0}px, ${ty0}px) scale(${sc})`; };
  const reset = () => { sc = 1; tx0 = 0; ty0 = 0; apply(); };
  const show = i => {
    at = (i + photos.length) % photos.length;
    img.src = N.photoUrl(photos[at]);
    reset();
    const c = v.querySelector('.vcount');
    if (c) c.textContent = (at + 1) + ' / ' + photos.length;
  };
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  v.addEventListener('touchstart', e => {
    moved = false;
    if (e.touches.length === 2) pinch = { d: dist(e.touches), sc };
    else if (e.touches.length === 1) drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: tx0, ty: ty0 };
  }, { passive: true });
  v.addEventListener('touchmove', e => {
    e.preventDefault();
    moved = true;
    if (pinch && e.touches.length === 2) { sc = Math.min(6, Math.max(1, pinch.sc * dist(e.touches) / pinch.d)); if (sc === 1) { tx0 = 0; ty0 = 0; } apply(); }
    else if (drag && e.touches.length === 1 && sc > 1) { tx0 = drag.tx + e.touches[0].clientX - drag.x; ty0 = drag.ty + e.touches[0].clientY - drag.y; apply(); }
  }, { passive: false });
  v.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinch = null;
    if (!e.touches.length) {
      // A quick sideways swipe on an unzoomed photo goes to the next / previous one.
      if (drag && sc === 1 && photos.length > 1 && e.changedTouches[0]) {
        const dx = e.changedTouches[0].clientX - drag.x;
        if (Math.abs(dx) > 60) show(at + (dx < 0 ? 1 : -1) * (document.documentElement.dir === 'rtl' ? -1 : 1));
      }
      drag = null;
    }
  });
  v.addEventListener('wheel', e => { e.preventDefault(); sc = Math.min(6, Math.max(1, sc * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); if (sc === 1) { tx0 = 0; ty0 = 0; } apply(); }, { passive: false });
  v.onclick = e => {
    if (e.target.closest('.vclose')) { v.remove(); return; }
    if (e.target.closest('.prev')) { show(at - 1); return; }
    if (e.target.closest('.next')) { show(at + 1); return; }
    if (moved) return;
    const now = Date.now();
    if (e.target === img && now - lastTap < 350) { if (sc > 1) reset(); else { sc = 2.5; apply(); } lastTap = 0; return; }
    lastTap = now;
    // A single tap outside the photo closes it, as before.
    if (e.target !== img && sc === 1) v.remove();
  };
  show(at);
  document.body.appendChild(v);
}

/* ================= Internet (connection payment tracking) ================= */

const NET_CURS = ['USD', 'TRY', 'SYP', 'EUR'];
const NET_REMDAYS = [1, 2, 3, 5, 7, 10];
const DAY = 86400000;

function netItems() { return docs('net').sort((a, b) => (a.until || 9e15) - (b.until || 9e15) || String(a.name).localeCompare(String(b.name))); }
function netDaysLeft(d) { return d.until ? Math.round((dayKey(d.until) - dayKey(Date.now())) / DAY) : null; }
function netDate(ms) { return ms ? fmtDate(ms, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'; }
function netMoney(v, cur) {
  const n = parseFloat(String(v || '').replace(',', '.'));
  if (isNaN(n)) return '';
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + (cur || '');
}
/** Same day N months later (end of month is kept: Jan 31 + 1 → Feb 28/29). */
function addMonths(ms, n) {
  const d = new Date(ms); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}
function dateIn(ms) { if (!ms) return ''; const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function dateOut(v) { if (!v) return null; const ms = new Date(v + 'T12:00:00').getTime(); return isNaN(ms) ? null : ms; }

/** The payment QR is d.qr; older entries kept it as their first picture. Every other picture is account info. */
function netQrId(d) { return d.qr !== undefined ? d.qr : ((d.photos || [])[0] || ''); }
function netInfoIds(d) { const q = netQrId(d); return (d.photos || []).filter(p => p !== q); }
function netLastPay(d) {
  const p = (d.pays || []).reduce((m, x) => (!m || x.at > m.at ? x : m), null);
  // A payment date typed in the form (e.g. paid before the app tracked payments).
  if (d.paidOn && (!p || dayKey(d.paidOn) > dayKey(p.at))) return { at: d.paidOn, amount: '', cur: '' };
  return p;
}
/** Unlimited / capped (GB) / slowed down after a quota. */
function netQuotaText(d) {
  if (d.qType === 'cap') return '📦 ' + t('net_q_cap_txt', { gb: d.qGb || '?' });
  if (d.qType === 'fup') return '🐢 ' + t('net_q_fup_txt', { gb: d.qGb || '?', mbps: d.qSlow || '?' });
  return '♾️ ' + t('net_q_unl');
}

/** 'ok' | 'soon' | 'late' | 'none' */
function netState(d) {
  const n = netDaysLeft(d);
  if (n === null) return 'none';
  if (n < 0) return 'late';
  return n <= (d.remDays || 3) ? 'soon' : 'ok';
}
function netStatusText(d) {
  const n = netDaysLeft(d);
  if (n === null) return t('net_no_until');
  if (n < 0) return t('net_expired', { n: -n });
  if (n === 0) return t('net_today');
  if (n === 1) return t('net_tomorrow');
  return t('net_left', { n });
}

/** Reminders: N days before the paid period ends, the day before, and on the last day (10:00). */
function netAl(d) {
  const times = [];
  if (d.until) {
    const at10 = ms => { const x = new Date(ms); x.setHours(10, 0, 0, 0); return x.getTime(); };
    [d.remDays || 3, 1, 0].forEach(k => times.push(at10(d.until - k * DAY)));
  }
  const now = Date.now();
  const price = netMoney(d.price, d.cur);
  return {
    t: [...new Set(times)].filter(x => x > now).sort(),
    ti: '📶 ' + (d.name || t('tab_net')) + ' — ' + t('net_rem_ti'),
    b: t('net_rem_body', { date: netDate(d.until) }) + (price ? ' · ' + price : '')
  };
}

function newNet() {
  return { kind: 'net', name: '', title: '', speed: '', price: '', cur: 'USD', until: addMonths(dayKey(Date.now()) + 12 * 3600000, 1), remDays: 3,
    photos: [], qr: '', qType: 'unl', qGb: '', qSlow: '', pays: [], waPhone: '', waSt: '', waAt: 0, tgUser: '', tgSt: '', tgAt: 0, notes: '', when: null, rem: [], remAt: null, done: false };
}

function netContact(d, key) {
  const isWa = key === 'wa';
  const val = isWa ? d.waPhone : d.tgUser;
  const st = isWa ? d.waSt : d.tgSt;
  const at = isWa ? d.waAt : d.tgAt;
  const stTxt = st === 'ok' ? t('net_st_ok') : st === 'bad' ? t('net_st_bad') : t('net_st_none');
  const meta = [stTxt, val || '', at ? t('net_last_try', { date: netDate(at) }) : ''].filter(Boolean).join(' · ');
  let link = '';
  if (val && isWa && waNumber(val)) link = `https://wa.me/${waNumber(val)}`;
  if (val && !isWa) link = /^https?:/.test(val) ? val : `https://t.me/${String(val).replace(/^@/, '').replace(/^\+/, '+')}`;
  const icon = isWa ? WA_ICON : '<span class="tgicon">✈️</span>';
  return `<div class="netc st-${st || 'none'}">
    <span class="ndot"></span>${icon}
    <div class="nctext"><b>${isWa ? 'WhatsApp' : 'Telegram'}</b> <span class="ncmeta">${esc(meta)}</span></div>
    <button class="nbtn ${st === 'ok' ? 'on ok' : ''}" data-netst="${d.id}|${key}|ok" title="${esc(t('net_mark_ok'))}">✓</button>
    <button class="nbtn ${st === 'bad' ? 'on bad' : ''}" data-netst="${d.id}|${key}|bad" title="${esc(t('net_mark_bad'))}">✕</button>
    ${link ? `<a class="nbtn open" data-ext href="${esc(link)}">↗ ${esc(t('net_open'))}</a>` : ''}
  </div>`;
}

function netCard(d) {
  const st = netState(d);
  const qrId = netQrId(d);
  const qr = qrId && N.photoUrl(qrId) ? qrId : '';
  const info = netInfoIds(d);
  const last = netLastPay(d);
  const meta = [d.speed ? '⚡ ' + d.speed + ' Mbps' : '', d.price ? '💳 ' + netMoney(d.price, d.cur) + ' ' + t('net_per_month') : ''].filter(Boolean).join('   ');
  const pays = (d.pays || []).slice(0, 6);
  return `<div class="card netcard">
    <div class="nethead">
      <div class="neticon">📶</div>
      <div class="rtext"><div class="netname">${esc(d.name || t('tab_net'))}</div>${meta ? `<div class="rmeta">${esc(meta)}</div>` : ''}<div class="rmeta netquota q-${d.qType || 'unl'}">${esc(netQuotaText(d))}</div></div>
      <button class="nbtn" data-open="${d.id}" title="${esc(t('edit'))}">✏️</button>
      ${isAdmin() ? `<button class="nbtn" data-trash="${d.id}" title="${esc(t('delete'))}">🗑</button>` : ''}
    </div>
    <div class="netstat ${st}">
      <div class="nsicon">${st === 'late' ? '⛔' : st === 'soon' ? '⏰' : '📅'}</div>
      <div class="rtext"><div class="nstitle">${esc(netStatusText(d))}</div><div class="small">🏁 ${esc(t('net_until_line', { date: netDate(d.until) }))}</div><div class="small">💵 ${esc(last ? (last.amount ? t('net_last_pay', { date: netDate(last.at), amount: netMoney(last.amount, last.cur) }) : t('net_last_pay_d', { date: netDate(last.at) })) : t('net_no_pay'))}</div></div>
      <button class="btn primary netpay" data-netpay="${d.id}">✓ ${esc(t('net_pay'))}</button>
    </div>
    <div class="netbody">
      ${qr ? `<figure class="netqr"><img src="${esc(N.photoUrl(qr))}" data-view="${esc(qr)}" data-of="${d.id}" alt=""><figcaption>${esc(t('net_qr'))}</figcaption></figure>` : ''}
      <div class="netcs">${netContact(d, 'wa')}${netContact(d, 'tg')}</div>
    </div>
    ${info.length ? `<div class="netinfo"><div class="small muted">🖼️ ${esc(t('net_info'))} (${info.length})</div><div class="netinfo-row">${info.map(p => { const u = N.photoUrl(p); return u ? `<img src="${esc(u)}" data-view="${esc(p)}" data-of="${d.id}" alt="">` : '<span class="ph-missing">⏳</span>'; }).join('')}</div></div>` : ''}
    ${d.notes ? `<p class="small muted netnotes">${esc(tx(d.notes))}</p>` : ''}
    ${pays.length ? `<div class="netpays"><div class="small muted">${esc(t('net_pays'))}</div>
      <div class="netprow head small muted"><span>${esc(t('net_paid_on'))}</span><span>${esc(t('net_ends_on'))}</span><span>${esc(t('net_months'))}</span><span>${esc(t('net_amount'))}</span></div>
      ${pays.map((p, i) => `<div class="netprow"><span>💵 ${esc(netDate(p.at))}</span><span>🏁 ${esc(netDate(p.newUntil))}</span><span>${esc(t('net_month_n', { n: p.months }))}</span><b>${esc(netMoney(p.amount, p.cur))}</b>${p.note ? `<span class="muted small">${esc(tx(p.note))}</span>` : ''}${isAdmin() ? `<button class="nbtn sm" data-netpaydel="${d.id}|${i}" title="${esc(t('delete'))}">🗑</button>` : ''}</div>`).join('')}
    </div>` : ''}
  </div>`;
}

function netBody() {
  const items = netItems();
  let h = `<p class="muted small netintro">${esc(t('net_intro'))}</p><button class="btn primary netadd" data-act="add">＋ ${esc(t('net_add'))}</button>`;
  if (!items.length) return h + `<div class="empty"><div class="eicon">📶</div><p>${esc(t('net_empty'))}</p></div>`;
  return h + items.map(netCard).join('');
}

/** On the main screen: connections whose paid period ends soon or has ended. */
function netAgendaCard() {
  const warn = netItems().filter(d => ['soon', 'late'].includes(netState(d)));
  if (!warn.length) return '';
  return `<div class="card summary netsum" data-tab="net"><div class="stitle">📶 ${esc(t('tab_net'))}</div>
    ${warn.map(d => `<div class="small ${netState(d)}">${esc((d.name || t('tab_net')) + ': ' + netStatusText(d))}</div>`).join('')}</div>`;
}

function renderNetEdit(s) {
  const d = s.doc;
  if (d.qr === undefined) d.qr = (d.photos || [])[0] || '';
  let f = '';
  f += field(t('net_name'), `<input name="name" value="${esc(d.name || '')}" placeholder="${esc(t('net_name_ph'))}">`);
  f += `<div class="two">${field(t('net_speed'), `<input name="speed" inputmode="decimal" value="${esc(d.speed || '')}" placeholder="10">`)}${field(t('net_price'), `<input name="price" inputmode="decimal" value="${esc(d.price || '')}" placeholder="30">`)}</div>`;
  f += field(t('net_cur'), `<select name="cur">${NET_CURS.concat(NET_CURS.includes(d.cur) || !d.cur ? [] : [d.cur]).map(c => `<option ${c === d.cur ? 'selected' : ''}>${c}</option>`).join('')}</select>`);
  f += `<div class="two">${field('💵 ' + t('net_paid_on'), `<input type="date" name="paidOn" value="${dateIn(d.paidOn)}">`)}${field('🏁 ' + t('net_until'), `<input type="date" name="until" value="${dateIn(d.until)}">`)}</div>`;
  const qt = d.qType || 'unl';
  f += `<div class="field"><span>📊 ${esc(t('net_quota'))}</span><div class="seg">${[['unl', '♾️'], ['cap', '📦'], ['fup', '🐢']].map(([k, i]) => `<button type="button" class="${qt === k ? 'on' : ''}" data-netq="${k}">${i} ${esc(t('net_q_' + k))}</button>`).join('')}</div></div>`;
  if (qt !== 'unl') f += `<div class="two">${field(qt === 'cap' ? t('net_q_gb') : t('net_q_fup_gb'), `<input name="qGb" inputmode="decimal" value="${esc(d.qGb || '')}" placeholder="100">`)}${qt === 'fup' ? field(t('net_q_slow'), `<input name="qSlow" inputmode="decimal" value="${esc(d.qSlow || '')}" placeholder="2">`) : ''}</div>`;
  f += `<div class="field"><span>🔔 ${esc(t('net_remdays'))}</span><div class="chips wrap">${NET_REMDAYS.map(n => `<button type="button" class="chip ${(d.remDays || 3) === n ? 'on' : ''}" data-netrem="${n}">${esc(t('net_days', { n }))}</button>`).join('')}</div></div>`;
  f += field('WhatsApp — ' + t('net_wa'), `<input name="waPhone" inputmode="tel" value="${esc(d.waPhone || '')}" placeholder="+963…">`);
  f += field('Telegram — ' + t('net_tg'), `<input name="tgUser" value="${esc(d.tgUser || '')}" placeholder="${esc(t('net_tg_ph'))}">`);
  const picBtns = role => `${isDesktop() ? '' : `<button type="button" class="ph-add" data-pick="camera" data-role="${role}">📷<small>${esc(t('camera'))}</small></button>`}<button type="button" class="ph-add" data-pick="gallery" data-role="${role}">🖼️<small>${esc(t('gallery'))}</small></button>`;
  const picItem = p => photoEditItem(d, p, false);
  const qrId = netQrId(d);
  f += `<div class="field"><span>🔳 ${esc(t('net_qr'))}</span><div class="photos">${qrId ? picItem(qrId) : picBtns('qr')}</div></div>`;
  f += `<div class="field"><span>🖼️ ${esc(t('net_info'))}</span><small class="muted">${esc(t('net_info_note'))}</small><div class="photos">${netInfoIds(d).map(picItem).join('')}${picBtns('info')}</div></div>`;
  f += field(t('notes'), txArea('notes', d.notes, '', true));
  if (!s.isNew) {
    f += `<p class="meta">${esc(t('added_by', { name: tx(d.byName) || '—', date: fmtWhen(d.ca) }))}</p>`;
    if (isAdmin()) f += `<button type="button" class="btn danger wide" data-act="delete">🗑 ${esc(t('delete'))}</button>`;
  }
  return `<form id="editform" onsubmit="return false">${f}<div style="height:80px"></div></form>`;
}

function netPayDialog(id) {
  const d = S.docs[id];
  if (!d) return;
  const today = dateIn(Date.now());
  const price = parseFloat(String(d.price || '').replace(',', '.')) || 0;
  const newUntil = (months, payMs) => {
    const base = d.until && dayKey(d.until) >= dayKey(payMs) - 0 ? d.until : payMs;
    return addMonths(base, months);
  };
  openModal(`<h3>✓ ${esc(t('net_pay_title'))} — ${esc(d.name || '')}</h3>
    <div class="two">${field(t('net_months'), `<input id="np-m" type="number" min="1" max="24" value="1">`)}${field(t('net_amount') + (d.cur ? ' (' + d.cur + ')' : ''), `<input id="np-a" inputmode="decimal" value="${price ? price : ''}">`)}</div>
    ${field(t('net_pay_date'), `<input id="np-d" type="date" value="${today}">`)}
    ${field(t('net_pay_note'), `<input id="np-n" value="">`)}
    <p class="small" id="np-u"></p>
    <div class="mbtns"><button class="btn" data-act="mclose">${esc(t('cancel'))}</button><button class="btn primary" id="m-ok">✓ ${esc(t('net_pay'))}</button></div>`,
  root => {
    const m = root.querySelector('#np-m'), a = root.querySelector('#np-a'), dt = root.querySelector('#np-d'), u = root.querySelector('#np-u');
    let amountTouched = false;
    const months = () => Math.max(1, Math.min(24, parseInt(m.value, 10) || 1));
    const upd = () => {
      if (!amountTouched && price) a.value = String(Math.round(price * months() * 100) / 100);
      u.textContent = '📅 ' + t('net_pay_new_until', { date: netDate(newUntil(months(), dateOut(dt.value) || Date.now())) });
    };
    a.addEventListener('input', () => { amountTouched = true; });
    m.addEventListener('input', upd); dt.addEventListener('input', upd); dt.addEventListener('change', upd);
    upd();
    root.querySelector('#m-ok').onclick = () => {
      const payMs = dateOut(dt.value) || Date.now();
      const c = JSON.parse(JSON.stringify(S.docs[id]));
      const nu = newUntil(months(), payMs);
      c.pays = [{ at: payMs, months: months(), amount: a.value.trim(), cur: c.cur, note: root.querySelector('#np-n').value.trim(), prevUntil: c.until || null, newUntil: nu, by: S.me.name || '' }].concat(c.pays || []);
      c.until = nu;
      c.paidOn = payMs;
      putDoc(c);
      closeModal();
      render();
      N.toast(t('net_pay_ok', { date: netDate(nu) }));
    };
  });
}

function netPayDelete(id, idx) {
  if (!isAdmin()) { N.toast(t('only_admin')); return; }
  confirmBox(t('net_confirm_paydel'), t('delete'), () => {
    const c = JSON.parse(JSON.stringify(S.docs[id]));
    const p = (c.pays || [])[idx];
    if (!p) return;
    // Removing the latest payment gives back the end date it had before.
    if (idx === 0 && p.newUntil === c.until && p.prevUntil) c.until = p.prevUntil;
    c.pays.splice(idx, 1);
    putDoc(c);
    render();
  }, true);
}

function netSetStatus(id, key, st) {
  const c = JSON.parse(JSON.stringify(S.docs[id]));
  const f = key === 'wa' ? 'wa' : 'tg';
  c[f + 'St'] = c[f + 'St'] === st ? '' : st;
  c[f + 'At'] = Date.now();
  putDoc(c);
  render();
}

/* ================= Electricity (meter readings) ================= */

function elecItems() { return docs('elec').sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), locale())); }
/** Readings newest first (by the date the meter was read, then by when it was typed). */
function elecReads(d) { return (d.reads || []).slice().sort((a, b) => (b.at - a.at) || ((b.ca || 0) - (a.ca || 0))); }
function elecNum(v) { const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; }
function elecFmt(n, max = 2) { return new Intl.NumberFormat(locale(), { minimumFractionDigits: 0, maximumFractionDigits: max }).format(n); }
function elecDaysAgo(ms) { return Math.max(0, Math.round((dayKey(Date.now()) - dayKey(ms)) / DAY)); }
function elecAgoText(ms) { const n = elecDaysAgo(ms); return n === 0 ? t('today') : n === 1 ? t('elec_yesterday') : t('elec_days_ago', { n }); }
/** Prepaid meters count down (remaining kWh); normal meters count up. */
function elecDown(d) { return d.mType !== 'up'; }
/** Used energy between two readings (older → newer). Negative = a top-up on a prepaid meter / a reset. */
function elecUsed(d, older, newer) { return Math.round((elecDown(d) ? older.v - newer.v : newer.v - older.v) * 100) / 100; }
function elecDiffText(d, older, newer) {
  const u = elecUsed(d, older, newer);
  if (u < 0) return '⬆ +' + elecFmt(-u) + ' ' + t(elecDown(d) ? 'elec_topup' : 'elec_reset');
  return '−' + elecFmt(u);
}
/** Last interval and the average per day over every interval where energy was used. */
function elecStats(d) {
  const r = elecReads(d);
  if (r.length < 2) return null;
  const last = { used: elecUsed(d, r[1], r[0]), days: Math.max(1, Math.round((dayKey(r[0].at) - dayKey(r[1].at)) / DAY)) };
  let used = 0, days = 0;
  for (let i = 0; i < r.length - 1; i++) {
    const u = elecUsed(d, r[i + 1], r[i]);
    const dd = Math.round((dayKey(r[i].at) - dayKey(r[i + 1].at)) / DAY);
    if (u >= 0 && dd > 0) { used += u; days += dd; }
  }
  const avg = days ? used / days : (last.used >= 0 ? last.used / last.days : 0);
  // A prepaid meter: how long what is left should last, from today.
  let left = null;
  if (elecDown(d) && avg > 0) left = Math.floor(r[0].v / avg) - elecDaysAgo(r[0].at);
  return { last, avg, left };
}
/** 'ok' | 'soon' | 'late' — for prepaid meters running out. */
function elecState(d) {
  const s = elecStats(d);
  if (!s || s.left === null) return 'ok';
  if (s.left <= 0) return 'late';
  return s.left <= (d.warnDays || 3) ? 'soon' : 'ok';
}
function elecLeftText(d) {
  const s = elecStats(d);
  if (!s || s.left === null) return '';
  return s.left <= 0 ? t('elec_left_out') : t('elec_left', { n: s.left });
}

function newElec() {
  return { kind: 'elec', name: '', title: '', meterNo: '', mType: 'down', warnDays: 3, reads: [], photos: [], notes: '', when: null, rem: [], remAt: null, done: false };
}

function elecAl(d) {
  return { t: [], ti: '⚡ ' + (d.name || t('tab_elec')), b: d.meterNo || t('tab_elec') };
}

function elecCard(d) {
  const r = elecReads(d);
  const last = r[0];
  const st = elecStats(d);
  const state = elecState(d);
  const photoId = coverOf(d);
  const more = (d.photos || []).filter(p => p !== photoId && N.photoUrl(p));
  const rows = r.slice(0, 12);
  let usage = '';
  if (st) {
    usage = st.last.used >= 0
      ? t('elec_used_line', { used: elecFmt(st.last.used), days: st.last.days, avg: elecFmt(st.last.used / st.last.days) })
      : t(elecDown(d) ? 'elec_topup_line' : 'elec_reset_line', { v: elecFmt(-st.last.used) });
    if (st.avg > 0) usage += ' · ' + t('elec_avg', { avg: elecFmt(st.avg) });
  }
  const left = elecLeftText(d);
  return `<div class="card eleccard">
    <div class="nethead">
      <div class="neticon elecicon">⚡</div>
      <div class="rtext"><div class="netname">${esc(d.name || t('tab_elec'))}</div>${d.meterNo ? `<div class="rmeta elecno"># ${esc(t('elec_no'))}: <b>${esc(d.meterNo)}</b></div>` : ''}<div class="rmeta">${esc(elecDown(d) ? '🔋 ' + t('elec_t_down') : '🔢 ' + t('elec_t_up'))}</div></div>
      <button class="nbtn" data-open="${d.id}" title="${esc(t('edit'))}">✏️</button>
      ${isAdmin() ? `<button class="nbtn" data-trash="${d.id}" title="${esc(t('delete'))}">🗑</button>` : ''}
    </div>
    <div class="elecmain">
      ${photoId ? `<figure class="elecph"><img src="${esc(N.photoUrl(photoId))}" data-view="${esc(photoId)}" data-of="${d.id}" alt=""><figcaption>${esc(t('elec_photo'))}</figcaption></figure>` : ''}
      <div class="elecright">
        <div class="eleclast ${state}">
          <div class="elgauge">⏲️</div>
          <div class="rtext">
            <div class="small muted">${esc(t('elec_last'))}</div>
            ${last ? `<div class="elecval">${esc(elecFmt(last.v))} <small>kWh</small></div><div class="small muted">${esc(netDate(last.at))} · ${esc(elecAgoText(last.at))}</div>` : `<div class="elecval none">—</div><div class="small muted">${esc(t('elec_no_reads'))}</div>`}
          </div>
        </div>
        ${usage ? `<p class="small elecuse">${esc(usage)}</p>` : ''}
        ${left ? `<p class="small elecleft ${state}">${state === 'ok' ? '🔋' : '⚠️'} ${esc(left)}</p>` : ''}
        <button class="btn primary wide elecadd" data-elecread="${d.id}">＋ ${esc(t('elec_enter'))}</button>
      </div>
    </div>
    ${more.length ? `<div class="netinfo-row">${more.map(p => `<img src="${esc(N.photoUrl(p))}" data-view="${esc(p)}" data-of="${d.id}" alt="">`).join('')}</div>` : ''}
    ${d.notes ? `<p class="small muted netnotes">${esc(tx(d.notes))}</p>` : ''}
    ${rows.length ? `<div class="netpays"><div class="small muted">${esc(t('elec_reads'))}</div>
      ${rows.map((x, i) => { const prev = r[i + 1]; return `<div class="elecrow">
        <span>${esc(dateIn(x.at))}</span><b>${esc(elecFmt(x.v))} kWh</b>
        <span class="elecdiff ${prev && elecUsed(d, prev, x) < 0 ? 'up' : ''}">${prev ? esc(elecDiffText(d, prev, x)) : ''}</span>
        <span class="small muted elecby">${esc([x.note ? tx(x.note) : '', x.by || ''].filter(Boolean).join(' · '))}</span>
        <button class="nbtn sm" data-elecedit="${d.id}|${esc(x.id)}" title="${esc(t('edit'))}">✏️</button>
        ${isAdmin() ? `<button class="nbtn sm" data-elecdel="${d.id}|${esc(x.id)}" title="${esc(t('delete'))}">🗑</button>` : ''}
      </div>`; }).join('')}
      ${r.length > rows.length ? `<p class="small muted center">${esc(t('elec_more', { n: r.length - rows.length }))}</p>` : ''}
    </div>` : ''}
  </div>`;
}

function elecBody() {
  const items = elecItems();
  let h = `<p class="muted small netintro">${esc(t('elec_intro'))}</p><button class="btn primary netadd" data-act="add">＋ ${esc(t('elec_add'))}</button>`;
  if (!items.length) return h + `<div class="empty"><div class="eicon">⚡</div><p>${esc(t('elec_empty'))}</p></div>`;
  return h + items.map(elecCard).join('');
}

/** On the main screen: prepaid meters about to run out. */
function elecAgendaCard() {
  const warn = elecItems().filter(d => elecState(d) !== 'ok');
  if (!warn.length) return '';
  return `<div class="card summary netsum" data-tab="elec"><div class="stitle">⚡ ${esc(t('tab_elec'))}</div>
    ${warn.map(d => `<div class="small ${elecState(d)}">${esc((d.name || t('tab_elec')) + ': ' + elecLeftText(d))}</div>`).join('')}</div>`;
}

function renderElecEdit(s) {
  const d = s.doc;
  let f = '';
  f += field(t('elec_name'), `<input name="name" value="${esc(d.name || '')}" placeholder="${esc(t('elec_name_ph'))}">`);
  f += field('# ' + t('elec_no'), `<input name="meterNo" inputmode="numeric" value="${esc(d.meterNo || '')}" placeholder="0105101668413">`);
  const mt = d.mType === 'up' ? 'up' : 'down';
  f += `<div class="field"><span>⚙️ ${esc(t('elec_type'))}</span><div class="seg">${[['down', '🔋'], ['up', '🔢']].map(([k, i]) => `<button type="button" class="${mt === k ? 'on' : ''}" data-electype="${k}">${i} ${esc(t('elec_t_' + k))}</button>`).join('')}</div><small class="muted">${esc(t('elec_type_note_' + mt))}</small></div>`;
  if (mt === 'down') f += `<div class="field"><span>⚠️ ${esc(t('elec_warn'))}</span><div class="chips wrap">${NET_REMDAYS.map(n => `<button type="button" class="chip ${(d.warnDays || 3) === n ? 'on' : ''}" data-elecwarn="${n}">${esc(t('net_days', { n }))}</button>`).join('')}</div></div>`;
  if (s.isNew) f += `<div class="two">${field(t('elec_first'), `<input name="firstV" inputmode="decimal" value="${esc(d.firstV || '')}" placeholder="413,43">`)}${field(t('elec_date'), `<input type="date" name="firstAt" value="${dateIn(d.firstAt || Date.now())}">`)}</div>`;
  f += `<div class="field"><span>📷 ${esc(t('elec_photo'))}</span><div class="photos">
    ${photoOrder(d).map(p => photoEditItem(d, p, true)).join('')}
    ${isDesktop() ? '' : `<button type="button" class="ph-add" data-pick="camera">📷<small>${esc(t('camera'))}</small></button>`}
    <button type="button" class="ph-add" data-pick="gallery">🖼️<small>${esc(t('gallery'))}</small></button>
  </div></div>`;
  f += field(t('notes'), txArea('notes', d.notes, '', true));
  if (!s.isNew) {
    f += `<p class="meta">${esc(t('added_by', { name: tx(d.byName) || '—', date: fmtWhen(d.ca) }))}</p>`;
    if (isAdmin()) f += `<button type="button" class="btn danger wide" data-act="delete">🗑 ${esc(t('delete'))}</button>`;
  }
  return `<form id="editform" onsubmit="return false">${f}<div style="height:80px"></div></form>`;
}

/** Enter a new reading, or change one (rid). */
function elecReadDialog(id, rid) {
  const d = S.docs[id];
  if (!d) return;
  const old = rid ? (d.reads || []).find(x => x.id === rid) : null;
  if (rid && !old) return;
  const last = elecReads(d)[0];
  openModal(`<h3>⚡ ${esc(old ? t('elec_edit_read') : t('elec_enter'))} — ${esc(d.name || '')}</h3>
    <div class="two">${field(t('elec_value') + ' (kWh)', `<input id="er-v" inputmode="decimal" value="${old ? esc(String(old.v).replace('.', ',')) : ''}" placeholder="${last ? esc(String(last.v).replace('.', ',')) : '0'}">`)}${field(t('elec_date'), `<input id="er-d" type="date" value="${dateIn(old ? old.at : Date.now())}">`)}</div>
    ${field(t('net_pay_note'), `<input id="er-n" value="${old ? esc(old.note || '') : ''}">`)}
    <p class="small" id="er-u"></p>
    <div class="mbtns"><button class="btn" data-act="mclose">${esc(t('cancel'))}</button><button class="btn primary" id="m-ok">✓ ${esc(t('save'))}</button></div>`,
  root => {
    const v = root.querySelector('#er-v'), dt = root.querySelector('#er-d'), u = root.querySelector('#er-u');
    const upd = () => {
      const n = elecNum(v.value);
      const prev = elecReads(d).filter(x => x.id !== rid && x.at <= (dateOut(dt.value) || Date.now()))[0];
      u.textContent = n !== null && prev ? (() => { const used = elecUsed(d, prev, { v: n }); return used >= 0 ? '📉 ' + t('elec_since', { used: elecFmt(used), date: netDate(prev.at) }) : '⬆ +' + elecFmt(-used) + ' ' + t(elecDown(d) ? 'elec_topup' : 'elec_reset'); })() : '';
    };
    v.addEventListener('input', upd); dt.addEventListener('input', upd); dt.addEventListener('change', upd);
    setTimeout(() => v.focus(), 50);
    upd();
    root.querySelector('#m-ok').onclick = () => {
      const n = elecNum(v.value);
      if (n === null || n < 0) { N.toast(t('elec_need_value')); return; }
      const c = JSON.parse(JSON.stringify(S.docs[id]));
      c.reads = c.reads || [];
      const at = dateOut(dt.value) || Date.now();
      const note = root.querySelector('#er-n').value.trim();
      if (old) { const x = c.reads.find(y => y.id === rid); if (x) { x.v = n; x.at = at; x.note = note; x.ua = Date.now(); } }
      else c.reads.push({ id: uid(), v: n, at, note, by: S.me.name || '', ca: Date.now() });
      putDoc(c);
      closeModal();
      render();
      N.toast(t('saved'));
    };
  });
}

function elecReadDelete(id, rid) {
  if (!isAdmin()) { N.toast(t('only_admin')); return; }
  confirmBox(t('elec_confirm_del'), t('delete'), () => {
    const c = JSON.parse(JSON.stringify(S.docs[id]));
    c.reads = (c.reads || []).filter(x => x.id !== rid);
    putDoc(c);
    render();
  }, true);
}

/* ================= Events ================= */

document.addEventListener('click', async e => {
  if (e.target.closest('a[data-ext]')) return;
  const el = e.target.closest('[data-act],[data-tab],[data-open],[data-toggle],[data-cat],[data-tcat],[data-hist],[data-newkind],[data-sub],[data-rem],[data-pick],[data-delphoto],[data-favphoto],[data-view],[data-newlst],[data-lang],[data-lists],[data-lists-tab],[data-editlst],[data-dellst],[data-map],[data-dial],[data-mkadmin],[data-fullrights],[data-rmmember],[data-trash],[data-copycode],[data-netpay],[data-netst],[data-netpaydel],[data-netrem],[data-netq],[data-elecread],[data-elecedit],[data-elecdel],[data-electype],[data-elecwarn]');
  if (!el) return;
  const ds = el.dataset;
  const top = ui.stack[ui.stack.length - 1];

  if (ds.toggle) {
    e.stopPropagation();
    const d = S.docs[ds.toggle];
    if (d) { const c = JSON.parse(JSON.stringify(d)); setDone(c, !c.done); putDoc(c); render(); }
    return;
  }
  if (ds.trash) {
    e.stopPropagation();
    const d = S.docs[ds.trash];
    if (d) confirmBox(t('confirm_delete', { name: docTitle(d) }), t('delete'), () => { deleteDoc(d.id); render(); }, true);
    return;
  }
  if (ds.netpay) { e.stopPropagation(); netPayDialog(ds.netpay); return; }
  if (ds.netst) { e.stopPropagation(); const [i, k, v] = ds.netst.split('|'); if (S.docs[i]) netSetStatus(i, k, v); return; }
  if (ds.elecread) { e.stopPropagation(); elecReadDialog(ds.elecread); return; }
  if (ds.elecedit) { e.stopPropagation(); const [i, r] = ds.elecedit.split('|'); elecReadDialog(i, r); return; }
  if (ds.elecdel) { e.stopPropagation(); const [i, r] = ds.elecdel.split('|'); if (S.docs[i]) elecReadDelete(i, r); return; }
  if (ds.netpaydel) { e.stopPropagation(); const [i, x] = ds.netpaydel.split('|'); if (S.docs[i]) netPayDelete(i, +x); return; }
  if (ds.copycode) { N.copy(ds.copycode); N.toast(t('copied')); return; }
  if (ds.tab) { if (ui.tab !== ds.tab) ui.q = ''; ui.tab = ds.tab; render(); window.scrollTo(0, 0); return; }
  if (ds.open) { const d = S.docs[ds.open]; if (d) openEdit(d, false); return; }
  if (ds.cat !== undefined && el.classList.contains('chip')) { ui.shopCat = ds.cat; render(); return; }
  if (ds.tcat !== undefined && el.classList.contains('chip')) { ui.taskCat = ds.tcat; render(); return; }
  if (ds.hist) { ui.histOpen[ds.hist] = !ui.histOpen[ds.hist]; render(); return; }
  if (ds.newkind) { closeModal(); openEdit(newDoc(ds.newkind), true); return; }
  if (ds.lang) {
    S.settings.lang = ds.lang; applyLang();
    // Recompute reminder texts in the new language for every item.
    translateAll();
    saveNow(); render(); return;
  }
  if (ds.lists) { push({ type: 'lists', list: ds.lists }); return; }
  if (ds.listsTab) { top.list = ds.listsTab; render(); return; }
  if (ds.editlst) {
    if (e.target.closest('[data-dellst]')) return;
    editListItem(S.docs[ds.editlst].list, S.docs[ds.editlst]);
    return;
  }
  if (ds.dellst) {
    e.stopPropagation();
    const it = S.docs[ds.dellst];
    confirmBox(t('confirm_delete', { name: lstName(it) }), t('delete'), () => { deleteDoc(ds.dellst); render(); }, true);
    return;
  }
  if (ds.newlst) {
    if (top && top.type === 'edit') {
      readForm(top);
      const fieldName = ds.for;
      editListItem(ds.newlst, null, saved => { top.doc[fieldName] = saved.id; render(); });
    } else {
      editListItem(ds.newlst, null);
    }
    return;
  }
  if (ds.map) { N.openMap(ds.map); return; }
  if (ds.dial) { N.dial(ds.dial); return; }
  if (ds.view) {
    e.stopPropagation();
    const d = ds.of && (S.docs[ds.of] || (top && top.doc && top.doc.id === ds.of ? top.doc : null));
    viewPhoto(ds.view, d ? (d.photos || []).filter(p => N.photoUrl(p)) : null);
    return;
  }
  if (ds.fullrights) {
    const m = S.sync.members.find(x => x.uid === ds.fullrights);
    const on = !isCoAdmin(ds.fullrights);
    confirmBox(t(on ? 'confirm_full_rights' : 'confirm_remove_rights', { name: m ? tx(m.name) : '' }), on ? t('give_full_rights') : t('remove_rights'), async () => {
      try { await setFullRights(ds.fullrights, on); N.toast(t('saved')); } catch (err) { N.toast(String(err.message || err)); }
      render();
    }, !on);
    return;
  }
  if (ds.mkadmin) {
    const m = S.sync.members.find(x => x.uid === ds.mkadmin);
    confirmBox(t('confirm_admin', { name: m ? m.name : '' }), t('make_admin'), async () => {
      try { await makeAdmin(ds.mkadmin); N.toast(t('saved')); } catch (err) { N.toast(String(err.message || err)); }
      render();
    });
    return;
  }
  if (ds.rmmember) {
    const m = S.sync.members.find(x => x.uid === ds.rmmember);
    confirmBox(t('confirm_remove_member', { name: m ? m.name : '' }), t('delete'), async () => {
      try { await removeMember(ds.rmmember); } catch (err) { N.toast(String(err.message || err)); }
      render();
    }, true);
    return;
  }

  if (top && top.type === 'edit') {
    const d = top.doc;
    if (ds.sub) { readForm(top); d.sub = ds.sub; render(); return; }
    if (ds.netrem) { readForm(top); d.remDays = +ds.netrem; render(); return; }
    if (ds.netq) { readForm(top); d.qType = ds.netq; render(); return; }
    if (ds.electype) { readForm(top); d.mType = ds.electype; render(); return; }
    if (ds.elecwarn) { readForm(top); d.warnDays = +ds.elecwarn; render(); return; }
    if (ds.rem) {
      readForm(top);
      const m = +ds.rem;
      d.rem = d.rem || [];
      d.rem = d.rem.includes(m) ? d.rem.filter(x => x !== m) : d.rem.concat([m]).sort((a, b) => a - b);
      render(); return;
    }
    if (ds.pick) {
      readForm(top);
      const ids = await nat('pickPhoto', ds.pick);
      if (Array.isArray(ids) && ids.length) {
        d.photos = (d.photos || []).concat(ids);
        top.added = top.added.concat(ids);
        if (d.kind === 'net' && ds.role === 'qr') d.qr = ids[0];
        render();
      }
      return;
    }
    if (ds.favphoto) {
      readForm(top);
      const p = ds.favphoto;
      if (!(d.photos || []).includes(p)) return;
      d.cover = p;
      // Keep the favourite first, so older app versions also show it as the main picture.
      d.photos = [p].concat(d.photos.filter(x => x !== p));
      N.toast(t('photo_fav_set'));
      render();
      return;
    }
    if (ds.delphoto) {
      readForm(top);
      const p = ds.delphoto;
      const wasNew = top.added.includes(p);
      confirmBox(t('confirm_photo'), t('delete'), () => {
        d.photos = d.photos.filter(x => x !== p);
        if (d.kind === 'net' && d.qr === p) d.qr = '';
        if (d.cover === p) d.cover = '';
        if (wasNew) { N.deletePhotoLocal(p); top.added = top.added.filter(x => x !== p); }
        else {
          // Persist removal right away so the photo is gone everywhere (online + local network sync).
          const orig = S.docs[d.id];
          if (orig) { const c = JSON.parse(JSON.stringify(orig)); c.photos = (c.photos || []).filter(x => x !== p); if (c.kind === 'net') c.qr = d.qr; if (c.cover === p) c.cover = ''; putDoc(c); }
          // Only the main phone may remove the stored picture itself; others just take it out of the record.
          if (isAdmin()) S.photoDel.push(p);
          S.photoUp = S.photoUp.filter(x => x !== p); N.deletePhotoLocal(p); save();
        }
        render();
      }, true);
      return;
    }
  }

  switch (ds.act) {
    case 'settings': push({ type: 'settings' }); break;
    case 'winmode': N.toggleFullScreen(); break;
    case 'exitapp':
      openModal(`<h3>✕ ${esc(t('exit_app'))}</h3>
        <div class="mbtns col"><button class="btn primary" id="m-tray">⬇️ ${esc(t('exit_tray'))}</button><button class="btn danger" id="m-quit">⏻ ${esc(t('exit_quit'))}</button><button class="btn" data-act="mclose">${esc(t('cancel'))}</button></div>`,
        root => {
          root.querySelector('#m-tray').onclick = () => { closeModal(); saveNow(); N.closeWindow(); };
          root.querySelector('#m-quit').onclick = () => { closeModal(); saveNow(); N.quitApp(); };
        });
      break;
    case 'back': pop(); break;
    case 'add':
      if (ui.tab === 'agenda') chooseKind();
      else if (ui.tab === 'net') openEdit(newNet(), true);
      else if (ui.tab === 'elec') openEdit(newElec(), true);
      else openEdit(newDoc({ health: 'appt', visits: 'visit', shop: 'shop', tasks: 'task' }[ui.tab]), true);
      break;
    case 'save': if (top) saveEdit(top); break;
    case 'delete':
      confirmBox(t('confirm_delete', { name: docTitle(top.doc) }), t('delete'), () => {
        deleteDoc(top.doc.id); top.saved = true; pop();
      }, true);
      break;
    case 'sharedoc': {
      readForm(top);
      const d = top.doc;
      const lines = [docTitle(d), d.when ? fmtWhen(d.when) : '', docPlace(d), d.address && d.kind !== 'visit' ? tx(d.address) : '', tx(d.notes)].filter(Boolean);
      N.share(lines.join('\n'));
      break;
    }
    case 'mclose': closeModal(); break;
    case 'syncnow': syncNow(); break;
    case 'ctsend': sendContact(); break;
    case 'lan': LanCore.open(); break;
    case 'clearq': ui.q = ''; render(); break;
    case 'updcheck': checkUpdate(true); break;
    case 'update': doUpdate(); break;
    case 'create': createFamilyDialog(); break;
    case 'join': joinFamilyDialog(); break;
    case 'help': closeModal(); push({ type: 'help' }); break;
    case 'copyrules': N.copy(RULES); N.toast(t('copied')); break;
    case 'invite': N.share(inviteText()); break;
    case 'leave':
      confirmBox(t('confirm_leave'), t('leave_family'), () => { leaveFamily(); render(); }, true);
      break;
    case 'cleardone':
      if (!doneToClear().length) { N.toast(t('clear_none')); break; }
      if (!isAdmin()) { N.toast(t('only_admin')); break; }
      confirmBox(t('confirm_clear_done', { n: doneToClear().length }), t('delete'), () => {
        doneToClear().forEach(d => deleteDoc(d.id));
        render();
      }, true);
      break;
    case 'clearbought':
      confirmBox(t('confirm_clear_bought'), t('delete'), () => {
        docs('shop').filter(d => d.done).forEach(d => deleteDoc(d.id));
        render();
      }, true);
      break;
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset && el.dataset.setting) {
    S.settings[el.dataset.setting] = el.checked;
    saveNow(); render(); return;
  }
  if (el.id === 'meperson') { S.settings.person = el.value; saveNow(); render(); return; }
  if (el.id === 'myname') {
    S.me.name = el.value.trim();
    saveNow();
    if (S.sync.enabled && S.sync.uid) fsCommit([memberWrite(S.sync.uid)]).then(() => syncNow());
  }
});

window.openDoc = id => {
  const d = S.docs[id];
  if (d) { ui.stack = []; openEdit(d, false); }
};

let lastUpdCheck = 0;
window.onResumeApp = () => {
  translateAll();
  // Coming back to the app counts as opening it: look for a new version and say so again.
  if (Date.now() - lastUpdCheck > 30000) { lastUpdCheck = Date.now(); announcedVer = ''; checkUpdate(false); }
  if (S.sync.enabled) syncNow();
  else if (!ui.stack.length) render();
  setTimeout(() => LanCore.autoTry(), 2500);
};

/* ================= Wi‑Fi eşitleme (internetsiz) ================= */

function lanApply(merged, rep) {
  const before = S.docs;
  const next = {};
  Object.entries(merged.docs).forEach(([id, d]) => {
    next[id] = d;
    if (before[id] !== d && S.sync.enabled && (!before[id] || LanCore.canon(before[id]) !== LanCore.canon(d))) S.dirty[id] = 1;
  });
  Object.keys(before).forEach(id => {
    if (next[id]) return;
    delete S.dirty[id];
    if (S.sync.enabled) {
      if (S.sync.adminUid !== S.sync.uid) { S.tomb = S.tomb || {}; S.tomb[id] = Object.assign({}, before[id], { del: true, delBy: S.sync.uid, ua: Date.now() }); delete S.tomb[id].al; }
      else if (!S.delQ.includes(id)) S.delQ.push(id);
    }
  });
  S.docs = next;
  S.lanDel = merged.dels;
  if (merged.conflicts.length) S.lanBackup = merged.conflicts.map(d => ({ at: Date.now(), d })).concat(S.lanBackup || []).slice(0, 300);
  saveNow();
  scheduleSync();
}

LanCore.init({
  app: 'ajandam',
  native: N,
  call: (fn, ...a) => nat(fn, ...a),
  lang: () => S.settings.lang,
  isDesktop,
  account: () => (S.sync.enabled ? S.sync.fid || '' : ''),
  device: () => ({ id: S.me.id, name: S.me.name || (isDesktop() ? 'PC' : 'Telefon') }),
  busy: () => ui.syncing,
  exportState: () => ({ docs: Object.assign({}, S.docs), dels: Object.assign({}, S.lanDel || {}) }),
  applyState: lanApply,
  photoIds: st => [...new Set(Object.values(st.docs).flatMap(d => d.photos || []))],
  hasPhoto: id => (typeof N.hasPhotoLocal === 'function' ? N.hasPhotoLocal(id) : !!N.photoUrl(id)),
  capturePhoto: async () => { const ids = await nat('pickPhoto', 'camera'); const id = Array.isArray(ids) && ids[0]; window.__lanShot = id; return id ? N.photoUrl(id) : ''; },
  capturedDone: () => { if (window.__lanShot) N.deletePhotoLocal(window.__lanShot); window.__lanShot = ''; },
  loadMeta: () => S.lan || {},
  saveMeta: m => { S.lan = m; save(); },
  refresh: () => { const top = ui.stack[ui.stack.length - 1]; if ((top && top.type === 'edit') || $('#modal')) renderSyncDot(); else render(); },
  photosChanged: () => {}
});

/* ================= Start ================= */

load();
applyLang();
if (isDesktop()) document.body.classList.add('desktop');
document.title = t('app_name') + ' v' + N.version();
N.setBarColor('#2E6B5E');
render();
saveNow();
translateAll();
if (typeof N.otaOk === 'function') N.otaOk();
setTimeout(() => { lastUpdCheck = Date.now(); checkUpdate(false); }, 1500);
// Without family sync there is no update check; still say when the version changed.
setTimeout(() => { if (!ui.updatedShown) { ui.updatedShown = true; announceUpdated(); } }, 8000);
const pending = N.takeOpenDoc();
if (pending) window.openDoc(pending);
if (S.sync.enabled) syncNow();
setTimeout(() => LanCore.autoTry(), 4000);
setInterval(() => {
  if (document.hidden && !isDesktop()) return;
  if (S.sync.enabled) syncNow();
  else if (!ui.stack.length && !$('#modal')) render();
}, 60000);

/* No spelling marks in text boxes: on phones tapping a marked word opened a black suggestion box that could not be closed. */
(function noSpellcheck() {
  const off = root => root.querySelectorAll && root.querySelectorAll('input, textarea, [contenteditable]').forEach(el => {
    if (el.getAttribute('spellcheck') !== 'false') el.setAttribute('spellcheck', 'false');
  });
  document.documentElement.spellcheck = false;
  off(document);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) { if (n.matches('input, textarea')) n.setAttribute('spellcheck', 'false'); off(n); } })))
    .observe(document.documentElement, { childList: true, subtree: true });
})();
