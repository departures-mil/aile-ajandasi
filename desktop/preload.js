'use strict';
// Gives the shared web UI the same "Android" bridge it uses on phones (+ window.fcHost of the shared core).
const electron = require('electron');
const { ipcRenderer } = electron;

// Ortak çekirdek preload'u (window.fcHost). Bu pencerede contextIsolation kapalı (window.Android köprüsü sayfayla aynı dünyada
// çalışır); contextBridge o kipte kullanılamadığı için fc-preload'un açtığı nesne doğrudan window'a konur.
try {
  if (!process.contextIsolated) {
    const cb = electron.contextBridge;
    const expose = (key, api) => { window[key] = api; };
    try { cb.exposeInMainWorld = expose; } catch (e) { /* salt okunur */ }
    if (cb.exposeInMainWorld !== expose) Object.defineProperty(cb, 'exposeInMainWorld', { value: expose, configurable: true, writable: true });
  }
  require('./cekirdek/electron/fc-preload.js');
} catch (e) { window.__fcPreloadError = String(e && e.message || e); }

const call = (name, ...args) => ipcRenderer.sendSync('sync', name, ...args);
const later = name => (cb, ...args) => {
  ipcRenderer.invoke('async', name, ...args)
    .catch(e => ({ status: 0, body: String(e && e.message || e) }))
    .then(r => window.__cb(cb, typeof r === 'string' ? r : JSON.stringify(r)));
};

function showToast(text) {
  const el = document.createElement('div');
  el.className = 'desk-toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// Yerel ağ eşitleme: telefondan gelen eşitleme isteği arayüzde birleştirilir.
ipcRenderer.on('lanReq', (e, rid, body) => {
  if (window.__lanReq) window.__lanReq(rid, body);
  else call('lanReply', rid, '{"ok":false,"error":"busy"}');
});

window.Android = {
  lanInfo: () => call('lanInfo'),
  lanIps: () => call('lanIps'),
  lanReply: (rid, json) => call('lanReply', rid, json),
  hasPhotoLocal: id => call('hasPhotoLocal', id),
  lanServe: later('lanServe'),
  lanStop: later('lanStop'),
  lanResetKey: later('lanResetKey'),
  lanHttp: later('lanHttp'),
  lanGetPhoto: later('lanGetPhoto'),
  lanPutPhoto: later('lanPutPhoto'),
  lanFind: later('lanFind'),
  platform: () => 'desktop',
  load: () => call('load'),
  save: s => call('save', s),
  photoUrl: id => call('photoUrl', id),
  deletePhotoLocal: id => call('deletePhotoLocal', id),
  pickPhoto: later('pickPhoto'),
  http: later('http'),
  deskInfo: () => call('deskInfo'),
  importLegacy: later('importLegacy'),
  restartApp: () => call('restartApp'),
  otaOk: () => call('otaOk'),
  notifyNow: (title, body, docId) => call('notifyNow', title, body, docId),
  httpTok: later('httpTok'),
  uploadPhoto: later('uploadPhoto'),
  downloadPhoto: later('downloadPhoto'),
  getSync: () => call('getSync'),
  setSync: s => call('setSync', s),
  signIn: later('signIn'),
  uid: () => call('uid'),
  setLang: l => call('setLang', l),
  deviceLang: () => call('deviceLang'),
  takeOpenDoc: () => call('takeOpenDoc'),
  share: text => { call('copy', text); showToast(window.t ? window.t('copied_share') : 'Copied'); },
  openMap: q => call('openMap', q),
  closeWindow: () => call('closeWindow'),
  quitApp: () => call('quitApp'),
  dial: () => {},
  copy: text => call('copy', text),
  paste: () => call('paste'),
  toast: showToast,
  setBarColor: () => {},
  version: () => call('version'),
  isFullScreen: () => call('isFullScreen'),
  toggleFullScreen: () => call('toggleFullScreen')
};

// Asistan Agent: aynı bilgisayardaki programlarla sayaç paylaşımı (fc-agent-main.js)
;(function () {
  const e = require('electron'), un = (p) => p.then((r) => { if (r && r.ok) return r.data; throw new Error((r && r.error) || 'ERR'); });
  const api = { read: () => un(e.ipcRenderer.invoke('fc:agent:read')), write: (k, j) => un(e.ipcRenderer.invoke('fc:agent:write', k, j)), remove: (k) => un(e.ipcRenderer.invoke('fc:agent:remove', k)) };
  try { e.contextBridge.exposeInMainWorld('fcAgentHost', api); } catch (x) { try { window.fcAgentHost = api; } catch (y) {} }
})();
