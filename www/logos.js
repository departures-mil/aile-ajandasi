'use strict';
/*
 * Category logos. Matching happens while the name is typed:
 *  1. the built-in library (Twemoji pictures + Unicode keywords in Turkish, English and Arabic), works offline;
 *  2. extra colourful icons from the internet (Iconify), added when the device is online.
 * A chosen logo is stored on the category as "tw:<file>" (built-in) or a data URI (internet).
 */

// Shop words that the Unicode keywords do not cover, mapped to English keywords.
const LOGO_WORDS = {
  'eczane': 'pill', 'eczacı': 'pill', 'nalbur': 'hammer', 'hırdavat': 'toolbox', 'avm': 'shopping bags', 'alışveriş merkezi': 'shopping bags', 'elektronik': 'computer', 'matbaa': 'printer', 'perde': 'window', 'halı': 'yarn',
  'kasap': 'meat', 'kırtasiye': 'pencil', 'manav': 'vegetable', 'bakkal': 'convenience store', 'şarküteri': 'cheese',
  'kuruyemiş': 'peanuts', 'züccaciye': 'cooking', 'mobilya': 'couch', 'optik': 'glasses', 'gözlükçü': 'glasses',
  'kozmetik': 'lipstick', 'parfümeri': 'perfume', 'akaryakıt': 'fuel', 'benzinlik': 'fuel', 'oto': 'automobile',
  'tamirci': 'wrench', 'sanayi': 'wrench', 'elektrikçi': 'light bulb', 'tesisatçı': 'wrench', 'boyacı': 'paintbrush',
  'kuru temizleme': 'shirt', 'çamaşırhane': 'washing', 'veteriner': 'paw', 'petshop': 'dog', 'pet shop': 'dog',
  'pastane': 'cake', 'tatlıcı': 'cake', 'kafe': 'coffee', 'lokanta': 'restaurant', 'kargo': 'package',
  'postane': 'postbox', 'kuyumcu': 'ring', 'saatçi': 'watch', 'bijuteri': 'gem', 'tekstil': 'thread',
  'manifatura': 'thread', 'perdeci': 'window', 'halıcı': 'carpet', 'ayakkabıcı': 'shoe', 'butik': 'dress',
  'giyim': 't-shirt', 'bebek mağazası': 'baby bottle', 'hastane': 'hospital', 'klinik': 'hospital',
  'diş': 'tooth', 'hardware': 'hammer', 'mall': 'shopping bags', 'pharmacy': 'pill', 'butcher': 'meat', 'stationery': 'pencil', 'greengrocer': 'vegetable', 'tailor': 'thread', 'market': 'shopping cart', 'süpermarket': 'shopping cart', 'pazar': 'basket', 'fırın': 'bread',
  'صيدلية': 'pill', 'ملحمة': 'meat', 'جزار': 'meat', 'خضار': 'vegetable', 'سوبرماركت': 'shopping cart',
  'بقالة': 'shopping cart', 'مول': 'shopping', 'قرطاسية': 'pencil', 'أدوات': 'hammer', 'خياط': 'thread',
  'مخبز': 'bread', 'حلويات': 'cake', 'مجوهرات': 'ring', 'عطور': 'perfume'
};

function foldText(s) {
  return s.replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıIİ]/g, 'i').replace(/[öÖ]/g, 'o')
    .replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u').replace(/[âÂ]/g, 'a').replace(/[îÎ]/g, 'i').replace(/[ûÛ]/g, 'u')
    .replace(/[ً-ْ]/g, '').toLowerCase();
}

// Common Turkish endings (çiçekçi -> çiçek, kitaplar -> kitap, gelinlik -> gelin).
const TR_SUFFIXES = ['çiler', 'ciler', 'çılar', 'cılar', 'lıklar', 'likler', 'lık', 'lik', 'luk', 'lük', 'lar', 'ler',
  'çi', 'çı', 'ci', 'cı', 'çu', 'cu', 'çü', 'cü', 'si', 'sı', 'su', 'sü', 'ı', 'i', 'u', 'ü'];

function queryTerms(name) {
  const low = name.toLocaleLowerCase('tr-TR').trim();
  const tokens = low.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 2);
  const terms = new Set([low, ...tokens]);
  tokens.forEach(w => TR_SUFFIXES.forEach(sfx => {
    if (w.endsWith(sfx) && w.length - sfx.length >= 3) terms.add(w.slice(0, -sfx.length));
  }));
  Object.keys(LOGO_WORDS).forEach(k => {
    if ((k.includes(' ') && low.includes(k)) || tokens.some(w => w === k || (k.length >= 4 && w.startsWith(k)))) {
      terms.add(LOGO_WORDS[k]);
      LOGO_WORDS[k].split(' ').forEach(x => terms.add(x));
    }
  });
  return [...terms].filter(Boolean).map(foldText);
}

let foldedIndex = null;
function emojiIndex() {
  if (!foldedIndex) {
    foldedIndex = EMOJI_INDEX.map(([file, nNames, kws]) => {
      const list = kws.split('|').map(foldText);
      return { file, names: list.slice(0, nNames), kws: list };
    });
  }
  return foldedIndex;
}

/** Built-in logos best matching the name, as "tw:<file>" references. */
function localLogos(name, max = 8) {
  const terms = queryTerms(name);
  if (!terms.length) return [];
  const scored = [];
  emojiIndex().forEach(e => {
    let score = 0;
    terms.forEach((q, i) => {
      let best = 0;
      e.kws.forEach(kw => {
        let s = 0;
        if (kw === q) s = i === 0 ? 100 : 50;
        else if (q.length >= 4 && kw.length >= 4 && (kw.startsWith(q) || q.startsWith(kw))) s = 18;
        else if (q.length >= 4 && kw.includes(' ') && kw.split(' ').includes(q)) s = 14;
        if (s && e.names.includes(kw)) s += 15;
        if (s > best) best = s;
      });
      score += best;
    });
    if (score > 0) scored.push([score, e.file]);
  });
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, max).map(x => 'tw:' + x[1]);
}

/** File name of the built-in picture for an emoji character, if there is one. */
let emojiFiles = null;
function twemojiFor(emoji) {
  if (!emoji) return '';
  if (!emojiFiles) emojiFiles = new Set(EMOJI_INDEX.map(e => e[0]));
  const cps = Array.from(emoji).map(c => c.codePointAt(0));
  const a = cps.filter(c => c !== 0xfe0f).map(c => c.toString(16)).join('-');
  const b = cps.map(c => c.toString(16)).join('-');
  return emojiFiles.has(a) ? a : emojiFiles.has(b) ? b : '';
}

function logoSrc(logo) { return logo.startsWith('tw:') ? 'twemoji/' + logo.slice(3) + '.svg' : logo; }

/* ---------- internet (extra results) ---------- */

async function translateToEnglish(name, lang) {
  if (lang === 'en') return '';
  const r = await nat('http', 'GET', 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(name) + '&langpair=' + (lang === 'ar' ? 'ar' : 'tr') + '|en', '', false);
  if (r.status !== 200) return '';
  try {
    const s = (JSON.parse(r.body).responseData || {}).translatedText || '';
    return /[a-z]/i.test(s) && !/MYMEMORY|INVALID/i.test(s) ? s.toLowerCase().replace(/^(the|a|an) /, '') : '';
  } catch (e) { return ''; }
}

const ICON_SETS = 'fluent-emoji-flat,noto,twemoji,openmoji';
// Hospitals and doctors also search the medical icon sets.
const MED_ICON_SETS = 'healthicons,medical-icon,fluent-emoji-flat,noto,twemoji,openmoji,streamline-color,fluent-color';

async function iconifySearch(term, sets) {
  // The Iconify search API rejects limits below 32.
  const r = await nat('http', 'GET', 'https://api.iconify.design/search?query=' + encodeURIComponent(term) + '&limit=32&prefixes=' + (sets || ICON_SETS), '', false);
  if (r.status !== 200) return [];
  try { return JSON.parse(r.body).icons || []; } catch (e) { return []; }
}

async function iconSvg(fullName) {
  const [prefix, nm] = fullName.split(':');
  const r = await nat('http', 'GET', `https://api.iconify.design/${prefix}/${nm}.svg?height=64`, '', false);
  if (r.status !== 200 || !/^\s*<svg/.test(r.body) || r.body.length > 40000) return '';
  // One-colour icons draw in the text colour, which an <img> cannot pass on: give them the app's green.
  const svg = r.body.replace(/currentColor/g, '#2E6B5E');
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

/** Extra logos from the internet (empty when offline). */
async function onlineLogos(name, lang, max = 4, opts = {}) {
  const terms = (opts.terms || []).slice();
  const en = lang === 'en' ? name.toLowerCase() : await translateToEnglish(name, lang);
  if (en) [en, ...en.split(/\s+/).filter(w => w.length > 2)].forEach(w => { if (!terms.includes(w)) terms.push(w); });
  queryTerms(name).filter(w => /^[a-z ]+$/.test(w) && w.length > 2).forEach(w => { if (!terms.includes(w)) terms.push(w); });
  const names = [];
  for (const term of terms.slice(0, opts.terms ? 6 : 4)) {
    if (names.length >= max) break;
    (await iconifySearch(term, opts.sets)).forEach(n => { if (!names.includes(n)) names.push(n); });
  }
  const out = [];
  for (const n of names.slice(0, max)) {
    const svg = await iconSvg(n);
    if (svg) out.push(svg);
  }
  return out;
}

/* ---------- Medical specialities (hospitals and doctors) ---------- */

// key, labels tr/en/ar, emoji, English search words for logos, words that recognise it in a typed name.
const SPECIALTIES = [
  ['dental', 'Diş', 'Dentist', 'أسنان', '🦷', ['tooth', 'dental', 'dentist'], ['diş', 'dis', 'dent', 'أسنان', 'اسنان']],
  ['eye', 'Göz', 'Eye', 'عيون', '👁️', ['eye', 'ophthalmology', 'glasses'], ['göz', 'goz', 'eye', 'optik', 'عيون', 'عين']],
  ['heart', 'Kalp', 'Cardiology', 'قلب', '🫀', ['heart', 'cardiology', 'heartbeat'], ['kalp', 'kardiyo', 'cardio', 'heart', 'قلب']],
  ['child', 'Çocuk', 'Paediatrics', 'أطفال', '👶', ['baby', 'pediatrics', 'child'], ['çocuk', 'cocuk', 'pediatr', 'paediatr', 'child', 'أطفال', 'اطفال']],
  ['women', 'Kadın doğum', 'Gynaecology', 'نسائية وتوليد', '🤰', ['pregnant', 'gynecology', 'obstetrics'], ['kadın', 'kadin', 'doğum', 'jinekolog', 'gyn', 'نسائية', 'ولادة', 'توليد']],
  ['ent', 'KBB', 'ENT', 'أنف وأذن وحنجرة', '👂', ['ear', 'nose', 'throat'], ['kbb', 'kulak', 'burun', 'boğaz', 'ent', 'أذن', 'اذن', 'انف', 'حنجرة']],
  ['ortho', 'Ortopedi', 'Orthopaedics', 'عظام', '🦴', ['bone', 'orthopedics', 'crutch'], ['ortoped', 'kemik', 'bone', 'عظام']],
  ['skin', 'Cildiye', 'Dermatology', 'جلدية', '🧴', ['skin', 'dermatology', 'lotion'], ['cilt', 'cildiye', 'dermato', 'skin', 'جلدية', 'جلد']],
  ['neuro', 'Nöroloji', 'Neurology', 'أعصاب', '🧠', ['brain', 'neurology', 'nerve'], ['nöro', 'noro', 'beyin', 'neuro', 'أعصاب', 'اعصاب', 'دماغ']],
  ['psy', 'Psikiyatri', 'Psychiatry', 'طب نفسي', '💭', ['psychology', 'mental health', 'psychiatry'], ['psik', 'ruh sağ', 'psych', 'نفسي', 'نفسية']],
  ['internal', 'Dahiliye', 'Internal medicine', 'باطنية', '🩺', ['stethoscope', 'internal medicine', 'stomach'], ['dahiliye', 'iç hastalık', 'internal', 'باطنية', 'باطني']],
  ['lab', 'Laboratuvar', 'Laboratory', 'مختبر', '🧪', ['test tube', 'laboratory', 'microscope'], ['lab', 'tahlil', 'مختبر', 'تحليل']],
  ['radio', 'Radyoloji', 'Radiology', 'أشعة', '🩻', ['x-ray', 'radiology', 'mri'], ['radyo', 'röntgen', 'rontgen', 'x-ray', 'أشعة', 'اشعة']],
  ['physio', 'Fizik tedavi', 'Physiotherapy', 'علاج طبيعي', '🦽', ['physiotherapy', 'rehabilitation', 'massage'], ['fizik', 'physio', 'علاج طبيعي']],
  ['pharmacy', 'Eczane', 'Pharmacy', 'صيدلية', '💊', ['pill', 'pharmacy', 'medicine'], ['eczane', 'pharma', 'صيدلية']],
  ['hospital', 'Hastane', 'Hospital', 'مستشفى', '🏥', ['hospital', 'ambulance', 'clinic'], ['hastane', 'hospital', 'klinik', 'clinic', 'مستشفى', 'مشفى', 'عيادة']],
  ['emergency', 'Acil', 'Emergency', 'طوارئ', '🚑', ['ambulance', 'emergency', 'first aid'], ['acil', 'emergency', 'طوارئ', 'اسعاف', 'إسعاف']],
  ['general', 'Aile hekimi', 'Family doctor', 'طبيب عام', '🧑‍⚕️', ['doctor', 'health worker', 'medical'], ['aile hekim', 'pratisyen', 'general', 'family doctor', 'طبيب عام']],
  ['vet', 'Veteriner', 'Vet', 'بيطري', '🐾', ['paw', 'veterinary', 'pet'], ['veteriner', 'vet', 'بيطري']]
];

function specLabel(sp, lang) { return sp[{ tr: 1, en: 2, ar: 3 }[lang] || 1]; }

/** The speciality a typed text names (in any of the three languages), if any. */
function guessSpec(text) {
  const low = foldText(String(text || ''));
  if (!low.trim()) return null;
  return SPECIALTIES.find(sp => [sp[1], sp[2], sp[3]].some(l => low.includes(foldText(l)))) ||
    SPECIALTIES.find(sp => sp[6].some(w => low.includes(foldText(w)))) || null;
}

/** Built-in logos for a speciality: its own picture first, then pictures for its search words. */
function specLogos(sp) {
  const out = [];
  const add = l => { if (l && !out.includes(l)) out.push(l); };
  const tw = twemojiFor(sp[4]);
  if (tw) add('tw:' + tw);
  ['🩺', '🏥', '🧑‍⚕️', '👨‍⚕️', '👩‍⚕️', '💉', '🩹', '⚕️'].forEach(e => { const f = twemojiFor(e); if (f) add('tw:' + f); });
  return out;
}
