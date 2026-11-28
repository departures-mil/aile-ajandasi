'use strict';
/*
 * Shows everything people typed (titles, notes, quantities, places, doctors, people, categories...) in the app's
 * current language. Whenever the device is online every text is translated into all three languages in the
 * background and cached on this device, so switching language later works offline too.
 * Engines, in order: Microsoft translator (batched), Google translate, MyMemory. The original text is never changed.
 */
const TX_LANGS = ['tr', 'en', 'ar'];
const txPending = new Map();
let txTimer = null;
let txBusy = false;
let txRetry = 0;
let txRetryAt = 0;

function txKey(lang, text) { return lang + '|' + text; }
function txSkip(text) { return /^[\d\s.,:;×x*\-+/%()#]*$/i.test(text) || /^[\w.+-]+@[\w.-]+$/.test(text) || /^https?:\/\//.test(text); }

function tx(text) {
  if (!text || typeof text !== 'string') return text;
  const v = S.tx[txKey(S.settings.lang, text)];
  if (v !== undefined) return v || text;
  txWant(S.settings.lang, text);
  return text;
}

function txWant(lang, text) {
  if (!text || typeof text !== 'string' || txSkip(text)) return;
  const k = txKey(lang, text);
  if (S.tx[k] !== undefined || txPending.has(k)) return;
  txPending.set(k, { lang, text });
  txSchedule(300);
}

function txSchedule(ms) {
  const at = Math.max(Date.now() + ms, txRetryAt);
  clearTimeout(txTimer);
  txTimer = setTimeout(runTx, at - Date.now());
}

/** Every text a person typed anywhere in the app. */
function txAllTexts() {
  const out = new Set();
  const add = v => { if (v && typeof v === 'string') out.add(v); };
  Object.values(S.docs).forEach(d => {
    if (d.kind === 'lst') { add(d.name); add(d.info); add(d.address); add(d.spec); return; }
    ['title', 'notes', 'qty', 'dept', 'address', 'byName', 'doneBy', 'uby'].forEach(f => add(d[f]));
  });
  (S.sync.members || []).forEach(m => add(m.name));
  add(S.sync.familyName);
  add(S.me.name);
  return [...out];
}

/** Queues every typed text for all languages, current language first. */
function txPrefetchAll() {
  const cur = S.settings.lang;
  const texts = txAllTexts();
  [cur, ...TX_LANGS.filter(l => l !== cur)].forEach(lang => texts.forEach(t => txWant(lang, t)));
}

/* ---------- engines ---------- */

let msTok = null;
let msTokAt = 0;
let msDownUntil = 0;

async function msToken() {
  if (msTok && Date.now() - msTokAt < 8 * 60000) return msTok;
  const r = await nat('http', 'GET', 'https://edge.microsoft.com/translate/auth', '', false);
  const tok = r && r.status === 200 ? String(r.body || '').trim() : '';
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(tok)) { msTok = tok; msTokAt = Date.now(); return tok; }
  return null;
}

/** Array of translations in the same order, or null when the engine is unavailable. */
async function msTranslate(texts, lang) {
  if (typeof N.httpTok !== 'function' || Date.now() < msDownUntil) return null;
  const tok = await msToken();
  if (!tok) { msDownUntil = Date.now() + 120000; return null; }
  const r = await nat('httpTok', 'POST', 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=' + lang,
    JSON.stringify(texts.map(t => ({ Text: t }))), tok);
  if (r.status === 401 || r.status === 403) msTok = null;
  if (r.status !== 200) { msDownUntil = Date.now() + 120000; return null; }
  try {
    const j = JSON.parse(r.body);
    if (!Array.isArray(j) || j.length !== texts.length) return null;
    return j.map((x, i) => {
      const det = x.detectedLanguage && x.detectedLanguage.language;
      const o = x.translations && x.translations[0] && x.translations[0].text;
      return det === lang || !o ? texts[i] : o;
    });
  } catch (e) { return null; }
}

let gDownUntil = 0;

async function googleTranslate(text, lang) {
  if (Date.now() < gDownUntil) return null;
  for (const host of ['translate.googleapis.com', 'translate.google.com']) {
    const r = await nat('http', 'GET', 'https://' + host + '/translate_a/single?client=gtx&sl=auto&tl=' + lang + '&dt=t&q=' + encodeURIComponent(text), '', false);
    if (r.status !== 200) continue;
    try {
      const j = JSON.parse(r.body);
      if (j[2] === lang) return text;
      const out = (j[0] || []).map(s => s[0] || '').join('').trim();
      if (out) return out;
    } catch (e) { /* blocked page, try the next host */ }
  }
  gDownUntil = Date.now() + 120000;
  return null;
}

function guessSource(text, target) {
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/[çğışöüÇĞİŞÖÜ]/.test(text)) return 'tr';
  return target === 'tr' ? 'en' : 'tr';
}

async function myMemory(text, lang) {
  const src = guessSource(text, lang);
  if (src === lang) return text;
  const r = await nat('http', 'GET', 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + src + '|' + lang, '', false);
  if (r.status !== 200) return null;
  try {
    const s = (JSON.parse(r.body).responseData || {}).translatedText || '';
    if (s && !/MYMEMORY|INVALID|QUERY LENGTH/i.test(s)) return s;
  } catch (e) { /* ignore */ }
  return null;
}

/** Translations for a batch; an entry is null when no engine could translate it right now. */
async function translateBatch(texts, lang) {
  const ms = await msTranslate(texts, lang);
  if (ms) return ms;
  const out = [];
  for (const text of texts) {
    let o = await googleTranslate(text, lang);
    if (o === null) o = await myMemory(text, lang);
    out.push(o);
    if (o === null) break;
  }
  while (out.length < texts.length) out.push(null);
  // İnternet yoksa: masaüstünde çevrimdışı yapay zekâ (TranslateGemma / NLLB) kuruluysa onunla
  if (out.some(o => o === null) && window.FCYZ && await FCYZ.ready('mt')) {
    for (let i = 0; i < texts.length; i++) {
      if (out[i] !== null) continue;
      try { const r = await FCYZ.translate(texts[i], 'auto', lang, { domain: 'genel' }); out[i] = r && r.text ? String(r.text).trim() : null; } catch (e) { out[i] = null; }
      if (out[i] === null) break;
    }
  }
  return out;
}

async function runTx() {
  if (txBusy || !txPending.size) return;
  txBusy = true;
  const cur = S.settings.lang;
  const byLang = {};
  txPending.forEach(v => { (byLang[v.lang] = byLang[v.lang] || []).push(v.text); });
  let shown = false;
  let changed = false;
  let failed = false;
  for (const lang of [cur, ...TX_LANGS.filter(l => l !== cur)]) {
    const texts = byLang[lang] || [];
    for (let i = 0; i < texts.length && !failed; i += 40) {
      const chunk = texts.slice(i, i + 40);
      const out = await translateBatch(chunk, lang);
      chunk.forEach((text, j) => {
        if (out[j] === null || out[j] === undefined) { failed = true; return; }
        S.tx[txKey(lang, text)] = out[j] === text ? '' : out[j];
        txPending.delete(txKey(lang, text));
        changed = true;
        if (lang === S.settings.lang) shown = true;
      });
    }
    if (failed) break;
  }
  txBusy = false;
  if (changed) save();
  if (shown) {
    const top = ui.stack[ui.stack.length - 1];
    if (!$('#modal') && !(top && top.type === 'edit')) render();
  }
  if (failed) {
    txRetry = Math.min(Math.max(txRetry * 2, 15000), 300000);
    txRetryAt = Date.now() + txRetry;
    txSchedule(0);
  } else {
    txRetry = 0;
    txRetryAt = 0;
    if (txPending.size) txSchedule(300);
  }
}

/** Language changed or app opened: try right away. */
function translateAll() {
  txRetry = 0;
  txRetryAt = 0;
  msDownUntil = 0;
  gDownUntil = 0;
  txPrefetchAll();
  txSchedule(0);
}

/** Value attributes for an input that shows typed text in the current language. */
function txAttrs(orig) {
  const o = orig || '';
  const s = tx(o) || '';
  return `value="${esc(s)}" data-o="${esc(o)}" data-s="${esc(s)}"`;
}

/** A wrapping, growing text box showing typed text in the current language (single line unless multi). */
function txArea(name, orig, placeholder, multi, id) {
  const o = orig || '';
  const v = tx(o) || '';
  return `<textarea ${name ? `name="${name}"` : ''} ${id ? `id="${id}"` : ''} class="grow${multi ? '' : ' single'}" rows="${multi ? 2 : 1}"`
    + ` data-o="${esc(o)}" data-s="${esc(v)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${esc(v)}</textarea>`;
}

/** What the person typed in such an input: the original text when they left the translation untouched. */
function txRead(el) {
  let v = el.value.trim();
  if (el.classList && el.classList.contains('single')) v = v.replace(/\s*\n\s*/g, ' ');
  if (el.dataset && el.dataset.s !== undefined && v === el.dataset.s.trim()) return el.dataset.o;
  return v;
}
