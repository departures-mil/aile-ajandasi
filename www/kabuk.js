/* Ajandam — ortak çekirdek kabuğu (www/cekirdek/fc-core.js). app.js'ten ÖNCE yüklenir; app.js'in genel değişkenlerine
   (S, N, t, render, syncNow, LanCore…) yalnız çağrı anında erişir.
   Burada: sağ üst sıra (🔔 · Ayarlar · Eşitle · Wi-Fi · Güncelle · Tema · Dil | Küçült · Orta · Tam ekran · Kapat),
   "klasik" renk şeması (5.6'nın yeşil renkleri), Ayarlar'ın çekirdek kartları (Görünüm … Admin ile iletişim EN SON),
   Kullanım Limitleri sayacı, ilk açılış rehberi (ailenin kendi Firebase'i), "neler yeni", çökme raporu ve ESKİ KABUK KÖPRÜLERİ.

   Kabuklar:
   - Masaüstü 5.7+ (kurulu)      : window.fcHost (çekirdek preload) + window.Android (uygulama köprüsü), güncelleme win-app
   - Masaüstü taşınabilir (≤5.6 klasörü, eski kanalla gelen yeni main.js): fcHost var, Android.deskInfo().mode = 'portable'
                                   → "Kurulum programına geçin" penceresi; Güncelle = win-setup indir + kur (veri korunur)
   - Masaüstü eski kabuk (main.js güncellenmemiş / çekirdek yüklenemedi): fcHost yok → kurulum bağlantısı
   - Android 5.7+                : window.AndroidBridge (FcBridge.java) — APK yama/tam güncelleme
   - Android eski APK (≤5.2)     : AndroidBridge yok → "Yeni sürüm gerekli" penceresi, APK bağlantısı (aynı imza, veriler kalır) */
(function () {
  'use strict';
  var OWNER = 'departures-mil', REPO = 'aile-ajandasi', APP = 'aile-ajandasi', PREFIX = 'Ajandam';
  var REL = window.APP_RELEASE || { version: '0.0.0', notes: {} };
  var VER = REL.version;
  var A = window.Android || null;
  var DESK = !!(A && typeof A.platform === 'function' && A.platform() === 'desktop');
  var INFO = null;
  try { if (DESK && typeof A.deskInfo === 'function') INFO = JSON.parse(A.deskInfo() || 'null'); } catch (e) { INFO = null; }
  var LEGACY_DESK = DESK && !window.fcHost;                                   // eski main.js ya da çekirdek yüklenemedi
  var PORTABLE = DESK && !LEGACY_DESK && !!(INFO && INFO.mode === 'portable');
  var LEGACY_ANDROID = !!(A && !DESK && !window.AndroidBridge && typeof A.load === 'function');
  var ui = FC.ui;
  // Çekirdeğin 'settings' simgesi tema (güneş) simgesine çok benziyor; Ayarlar için dişli çark
  ui.icons.cog = '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>';

  window.__ajErrors = [];
  window.addEventListener('error', function (e) { if (e && e.message) window.__ajErrors.push(String(e.message)); });

  /* ---------- metinler ---------- */
  FC.i18n.add({
    tr: {
      'aj.settings': 'Ayarlar', 'aj.syncSetup': 'Aile eşitlemesi kapalı. Ayarlar → Aile eşitlemesi bölümünden ailenizi kurun ya da davet koduyla katılın.',
      'aj.newSetup': 'Yeni kurulum gerekli', 'aj.newApk': 'Yeni telefon sürümü gerekli',
      'aj.setupDesc': 'Ajandam {0} artık bir kurulum programıyla gelir: tam ekran açılış, sağ üstte her zaman görünen Güncelle düğmesi (yalnızca değişen kısımlar indirilir) ve yeni görünüm. Bir kez kurun; sonraki güncellemeler kendiliğinden gelir.',
      'aj.setupKeep': 'Kayıtlarınız korunur: yeni Ajandam bu klasördeki verileri ilk açılışta kendisi kopyalar. Bu klasör ve içindeki data klasörü olduğu gibi kalır.',
      'aj.setupOne': 'Kur (tek tuş)', 'aj.setupDl': 'Kurulum dosyasını indir', 'aj.releases': 'Sürümler sayfası', 'aj.later': 'Daha sonra',
      'aj.setupHint': 'Kurulum birkaç saniye sürer, masaüstüne "Ajandam" kısayolu ekler ve yeni sürümü açar. Sonra bu eski programı kullanmayın.',
      'aj.setupLegacyHint': 'İndirilen dosyayı açın. Kurulumdan sonra yeni Ajandam eski kayıtlarınızı bulamazsa: Ayarlar → "Eski Ajandam klasöründen veri al" ile şu klasörü seçin:',
      'aj.apkDesc': 'Ajandam {0} telefonda yeni bir uygulama sürümüyle gelir: sağ üstte her zaman görünen Güncelle düğmesi, güncellemeler GitHub\'dan (yalnızca değişen kısımlar), yeni görünüm.',
      'aj.apkKeep': 'Kayıtlarınız korunur: yeni sürüm bu uygulamanın üstüne kurulur (aynı imza), hiçbir şey silinmez.',
      'aj.apkDl': 'Yeni sürümü indir (APK)', 'aj.apkHint': 'Açılan sayfada Ajandam-…-android.apk dosyasını indirin. İndirme bitince bildirimden dosyayı açın ve "Güncelle" deyin. Gerekirse "bilinmeyen kaynaklara izin ver" seçeneğini açın.',
      'aj.arch': 'Arşiv ve yedekler', 'aj.archDesc': 'Eşitlemede hiçbir kayıt kalıcı olarak silinmez: başka cihazda silinen kayıtlar buraya arşivlenir, aynı anda iki yerde değişen kayıtların eski hali yedeklenir. İstediğinizi geri yükleyebilirsiniz.',
      'aj.archived': 'Arşivlenen kayıtlar', 'aj.conflicts': 'Çakışma yedekleri', 'aj.restore': 'Geri yükle', 'aj.restored': 'Geri yüklendi', 'aj.none': 'Yok',
      'aj.from.cloud': 'bulut', 'aj.from.lan': 'Wi-Fi', 'aj.show': 'Göster', 'aj.hide': 'Gizle',
      'aj.legacy': 'Eski Ajandam klasöründen veri al', 'aj.legacyDesc': 'Bilgisayarda daha önce taşınabilir (kurulumsuz) Ajandam kullandıysanız, o klasörü seçin; kayıtlar, fotoğraflar ve aile bağlantısı buraya kopyalanır. Şu anki veriler önce yedek klasörüne alınır.',
      'aj.legacyPick': 'Klasör seç…', 'aj.legacyNotFound': 'Seçilen klasörde Ajandam verisi (data.json) bulunamadı.', 'aj.legacyOk': 'Veriler alındı; program yeniden başlıyor…',
      'aj.migrated': 'Eski taşınabilir Ajandam\'daki kayıtlarınız bu kuruluma kopyalandı. Eski klasör olduğu gibi duruyor; isterseniz sonra silebilirsiniz.',
      'aj.obFbDesc': 'Ajandam bir aile programıdır ve HER AİLE KENDİ ücretsiz Firebase hesabını kullanır: kayıtlarınız yalnızca sizin ailenizin projesinde durur, kimseyle paylaşılmaz ve başka ailelerin kullanımı sizin günlük sınırınızı tüketmez. Ailede bir kişi (genellikle ana telefon) bir kez Firebase projesi kurar, yapılandırmayı buraya yapıştırır ve aileyi oluşturur.',
      'aj.obFbLater': 'Ailenizde Ajandam zaten kuruluysa bu adımı ATLAYIN: Ayarlar → "Aileye katıl" ile ana telefondaki davet kodunu girmeniz yeterli. Eşitleme olmadan da program bu cihazda tam çalışır; aynı Wi-Fi üzerinden de eşitleyebilirsiniz.'
    },
    en: {
      'aj.settings': 'Settings', 'aj.syncSetup': 'Family sync is off. Set up your family or join with an invite code in Settings → Family sync.',
      'aj.newSetup': 'New installer required', 'aj.newApk': 'New phone version required',
      'aj.setupDesc': 'Ajandam {0} now comes with an installer: full-screen start, an Update button that is always visible at the top right (only the changed parts are downloaded) and a new look. Install it once; later updates arrive automatically.',
      'aj.setupKeep': 'Your records are kept: the new Ajandam copies the data in this folder on its first start. This folder and its data folder stay as they are.',
      'aj.setupOne': 'Install (one click)', 'aj.setupDl': 'Download the installer', 'aj.releases': 'Releases page', 'aj.later': 'Later',
      'aj.setupHint': 'Installation takes a few seconds, adds an "Ajandam" shortcut to the desktop and opens the new version. Do not use this old program afterwards.',
      'aj.setupLegacyHint': 'Open the downloaded file. If the new Ajandam does not find your old records after installing, choose Settings → "Import data from an old Ajandam folder" and select this folder:',
      'aj.apkDesc': 'Ajandam {0} comes as a new app version on the phone: an Update button that is always visible at the top right, updates from GitHub (only the changed parts) and a new look.',
      'aj.apkKeep': 'Your records are kept: the new version installs over this app (same signature); nothing is deleted.',
      'aj.apkDl': 'Download the new version (APK)', 'aj.apkHint': 'On the page that opens, download Ajandam-…-android.apk. When the download finishes, open the file from the notification and choose "Update". If asked, allow installing from unknown sources.',
      'aj.arch': 'Archive and backups', 'aj.archDesc': 'Sync never deletes a record for good: records deleted on another device are archived here, and when a record changed in two places at once the older version is backed up. You can restore any of them.',
      'aj.archived': 'Archived records', 'aj.conflicts': 'Conflict backups', 'aj.restore': 'Restore', 'aj.restored': 'Restored', 'aj.none': 'None',
      'aj.from.cloud': 'cloud', 'aj.from.lan': 'Wi-Fi', 'aj.show': 'Show', 'aj.hide': 'Hide',
      'aj.legacy': 'Import data from an old Ajandam folder', 'aj.legacyDesc': 'If you used the portable (no-install) Ajandam on this computer before, choose its folder; records, photos and the family connection are copied here. The current data is moved to a backup folder first.',
      'aj.legacyPick': 'Choose folder…', 'aj.legacyNotFound': 'No Ajandam data (data.json) was found in the chosen folder.', 'aj.legacyOk': 'Data imported; the program is restarting…',
      'aj.migrated': 'Your records from the old portable Ajandam were copied into this installation. The old folder is untouched; you can delete it later if you like.',
      'aj.obFbDesc': 'Ajandam is a family program and EACH FAMILY USES ITS OWN free Firebase account: your records stay only in your family\'s project, are not shared with anyone, and other families\' use never eats into your daily limit. One person in the family (usually the main phone) creates a Firebase project once, pastes its configuration here and creates the family.',
      'aj.obFbLater': 'If Ajandam is already set up in your family, SKIP this step: just enter the invite code from the main phone in Settings → "Join a family". Without sync the program still works fully on this device, and you can also sync over the same Wi-Fi.'
    },
    ar: {
      'aj.settings': 'الإعدادات', 'aj.syncSetup': 'مزامنة العائلة متوقفة. أنشئ عائلتك أو انضم برمز الدعوة من الإعدادات ← مزامنة العائلة.',
      'aj.newSetup': 'يلزم مثبّت جديد', 'aj.newApk': 'يلزم إصدار جديد للهاتف',
      'aj.setupDesc': 'يأتي Ajandam {0} الآن بملف تثبيت: فتح بملء الشاشة، وزر «تحديث» ظاهر دائماً في أعلى اليمين (تُنزَّل الأجزاء المتغيرة فقط)، ومظهر جديد. ثبّته مرة واحدة؛ وستصل التحديثات التالية تلقائياً.',
      'aj.setupKeep': 'سجلاتك محفوظة: ينسخ Ajandam الجديد بيانات هذا المجلد عند أول تشغيل. يبقى هذا المجلد ومجلد data كما هما.',
      'aj.setupOne': 'تثبيت (بضغطة واحدة)', 'aj.setupDl': 'تنزيل ملف التثبيت', 'aj.releases': 'صفحة الإصدارات', 'aj.later': 'لاحقاً',
      'aj.setupHint': 'يستغرق التثبيت بضع ثوانٍ ويضيف اختصار «Ajandam» على سطح المكتب ويفتح الإصدار الجديد. لا تستخدم هذا البرنامج القديم بعد ذلك.',
      'aj.setupLegacyHint': 'افتح الملف الذي نزّلته. إذا لم يجد Ajandam الجديد سجلاتك القديمة بعد التثبيت، فاختر الإعدادات ← «استيراد البيانات من مجلد Ajandam قديم» وحدد هذا المجلد:',
      'aj.apkDesc': 'يأتي Ajandam {0} على الهاتف بإصدار تطبيق جديد: زر «تحديث» ظاهر دائماً في أعلى اليمين، وتحديثات من GitHub (الأجزاء المتغيرة فقط)، ومظهر جديد.',
      'aj.apkKeep': 'سجلاتك محفوظة: يُثبَّت الإصدار الجديد فوق هذا التطبيق (التوقيع نفسه)، ولا يُحذف شيء.',
      'aj.apkDl': 'تنزيل الإصدار الجديد (APK)', 'aj.apkHint': 'في الصفحة التي تُفتح نزّل الملف Ajandam-…-android.apk. عند انتهاء التنزيل افتح الملف من الإشعار واختر «تحديث». إذا طُلب منك فاسمح بالتثبيت من مصادر غير معروفة.',
      'aj.arch': 'الأرشيف والنسخ الاحتياطية', 'aj.archDesc': 'لا تحذف المزامنة أي سجل نهائياً: السجلات المحذوفة على جهاز آخر تُؤرشف هنا، وعندما يتغير سجل في مكانين معاً تُحفظ نسخته الأقدم احتياطياً. يمكنك استعادة أي منها.',
      'aj.archived': 'السجلات المؤرشفة', 'aj.conflicts': 'نسخ التعارض الاحتياطية', 'aj.restore': 'استعادة', 'aj.restored': 'تمت الاستعادة', 'aj.none': 'لا يوجد',
      'aj.from.cloud': 'السحابة', 'aj.from.lan': 'Wi-Fi', 'aj.show': 'عرض', 'aj.hide': 'إخفاء',
      'aj.legacy': 'استيراد البيانات من مجلد Ajandam قديم', 'aj.legacyDesc': 'إذا استخدمت سابقاً نسخة Ajandam المحمولة (بدون تثبيت) على هذا الحاسوب فاختر مجلدها؛ تُنسخ السجلات والصور واتصال العائلة إلى هنا. تُنقل البيانات الحالية أولاً إلى مجلد احتياطي.',
      'aj.legacyPick': 'اختيار مجلد…', 'aj.legacyNotFound': 'لم يُعثر على بيانات Ajandam ‏(data.json) في المجلد المحدد.', 'aj.legacyOk': 'تم استيراد البيانات؛ يُعاد تشغيل البرنامج…',
      'aj.migrated': 'نُسخت سجلاتك من Ajandam المحمول القديم إلى هذا التثبيت. المجلد القديم لم يُمسّ؛ يمكنك حذفه لاحقاً إن شئت.',
      'aj.obFbDesc': 'Ajandam برنامج عائلي، وكل عائلة تستخدم حساب Firebase المجاني الخاص بها: تبقى سجلاتك في مشروع عائلتك فقط، ولا تُشارك مع أحد، ولا يستهلك استخدام العائلات الأخرى حدّك اليومي. يُنشئ شخص واحد في العائلة (عادةً الهاتف الرئيسي) مشروع Firebase مرة واحدة، ويلصق إعداداته هنا وينشئ العائلة.',
      'aj.obFbLater': 'إذا كان Ajandam مُعدّاً في عائلتك مسبقاً فتخطَّ هذه الخطوة: يكفي إدخال رمز الدعوة من الهاتف الرئيسي في الإعدادات ← «الانضمام إلى عائلة». يعمل البرنامج بالكامل على هذا الجهاز دون مزامنة، ويمكنك أيضاً المزامنة عبر شبكة Wi-Fi نفسها.'
    }
  });
  // İlk açılış rehberinin Firebase adımı bu uygulamada aileye göre anlatılır
  ['tr', 'en', 'ar'].forEach(function (l) { var o = {}; o[l] = { 'fc.ob.fbDesc': FC.t('aj.obFbDesc', null, l), 'fc.ob.fbLater': FC.t('aj.obFbLater', null, l) }; FC.i18n.add(o); });
  function T(k) { var a = [].slice.call(arguments, 1); return FC.t(k).replace(/\{(\d)\}/g, function (m, i) { return a[+i] != null ? a[+i] : m; }); }

  /* ---------- "klasik" şema: 5.6'nın style.css renkleri (yalnız açık temalıydı; koyu hali aynı yeşilin koyu karşılığı) ---------- */
  FC.look.registerScheme('klasik', {
    label: { tr: 'Klasik (eski görünüm)', en: 'Classic (previous look)', ar: 'الكلاسيكي (المظهر السابق)' },
    light: {
      '--bg': '#F4F5F2', '--bg-grid': '#0000', '--panel': '#ffffff', '--panel-solid': '#ffffff', '--panel-hover': '#EEF2EF',
      '--border': '#E5E8E4', '--border-strong': '#A9C4BC', '--border-w': '1px', '--text': '#1E2522', '--muted': '#6B7570', '--label': '#3A4541',
      '--nav-text': '#1E2522', '--nav-title': '#6B7570', '--accent': '#2E6B5E', '--accent-2': '#E85D4A', '--on-accent': '#ffffff',
      '--primary-1': '#2E6B5E', '--primary-2': '#28604F', '--grad-primary': '#2E6B5E', '--active-1': '#2E6B5E29', '--active-2': '#2E6B5E14', '--active-line': '#2E6B5E',
      '--accent-soft': '#E4F0EC', '--accent-line': '#2E6B5E59', '--focus': '#2E6B5E', '--focus-w': '2px', '--focus-ring': '#2E6B5E33',
      '--danger': '#C7392B', '--warn': '#B36B00', '--ok': '#237A3E', '--ok-text': '#237A3E', '--danger-text': '#C7392B', '--warn-text': '#8A5200',
      '--ok-soft': '#E3F5EA', '--ok-line': '#3BA55C', '--danger-soft': '#FDECEA', '--danger-line': '#F2C4BF', '--warn-soft': '#FFF4E5', '--warn-line': '#F0C36D',
      '--sidebar-bg': '#ffffff', '--topbar-bg': '#2E6B5E', '--topbar-text': '#ffffff', '--modal-bg': '#ffffff', '--modal-border': '#E5E8E4', '--backdrop': '#00000066',
      '--toast-bg': '#1E2522', '--toast-text': '#ffffff', '--toast-line': '#1E2522', '--toast-err-bg': '#C7392B', '--toast-err-text': '#ffffff', '--toast-err-line': '#C7392B',
      '--badge-text': '#3A4541', '--badge-bg': '#EEF2EF', '--badge-line': '#E5E8E4', '--on-badge': '#ffffff',
      '--bar-track': '#E5E8E4', '--scroll-thumb': '#9AA59F80', '--glow-1': '#0000', '--glow-2': '#0000',
      '--shadow-pop': '0 8px 24px #00000026', '--shadow-modal': '0 20px 60px #0000004d', '--shadow-toast': '0 8px 24px #0000004d',
      '--fab': '#E85D4A', '--chip-on': '#2E6B5E'
    },
    dark: {
      '--bg': '#121815', '--bg-grid': '#0000', '--panel': '#1B2420', '--panel-solid': '#1B2420', '--panel-hover': '#24302B',
      '--border': '#2C3934', '--border-strong': '#3F6B5F', '--border-w': '1px', '--text': '#E7ECE9', '--muted': '#9AA8A1', '--label': '#C9D3CE',
      '--nav-text': '#E7ECE9', '--nav-title': '#9AA8A1', '--accent': '#5FB39F', '--accent-2': '#F07B6A', '--on-accent': '#0E1A16',
      '--primary-1': '#2E6B5E', '--primary-2': '#28604F', '--grad-primary': '#3B8574', '--active-1': '#5FB39F40', '--active-2': '#5FB39F1f', '--active-line': '#5FB39F',
      '--accent-soft': '#1F3A33', '--accent-line': '#5FB39F73', '--focus': '#5FB39F', '--focus-w': '2px', '--focus-ring': '#5FB39F4d',
      '--danger': '#F07B6A', '--warn': '#F0B85A', '--ok': '#5CC27E', '--ok-text': '#5CC27E', '--danger-text': '#F59A8C', '--warn-text': '#F0B85A',
      '--ok-soft': '#16301F', '--ok-line': '#2F7A47', '--danger-soft': '#3A1A16', '--danger-line': '#7A2C22', '--warn-soft': '#3A2C0C', '--warn-line': '#92600E',
      '--sidebar-bg': '#121815', '--topbar-bg': '#1E4A40', '--topbar-text': '#ffffff', '--modal-bg': '#1B2420', '--modal-border': '#2C3934', '--backdrop': '#000000a6',
      '--toast-bg': '#0B100E', '--toast-text': '#ffffff', '--toast-line': '#2C3934', '--toast-err-bg': '#7A2C22', '--toast-err-text': '#ffffff', '--toast-err-line': '#C7392B',
      '--badge-text': '#C9D3CE', '--badge-bg': '#24302B', '--badge-line': '#2C3934', '--on-badge': '#ffffff',
      '--bar-track': '#2C3934', '--scroll-thumb': '#4B5A5380', '--glow-1': '#0000', '--glow-2': '#0000',
      '--shadow-pop': '0 8px 24px #00000080', '--shadow-modal': '0 20px 60px #000000a6', '--shadow-toast': '0 8px 24px #00000080',
      '--fab': '#E85D4A', '--chip-on': '#3B8574'
    }
  });

  /* ---------- 5.6'dan gelen kullanıcı ---------- */
  var OLD_USER = false;
  try { OLD_USER = !!(A && typeof A.load === 'function' && A.load()); } catch (e) { }
  try {
    if (OLD_USER && FC.storage.get('whatsnew.seen', null) == null) FC.storage.set('whatsnew.seen', '5.6.0');   // "neler yeni" görünsün
    if (OLD_USER && FC.storage.get('onboarding.done', null) == null) FC.storage.set('onboarding.done', true);    // eski kullanıcıya rehber açılmaz
    var oldAnn = JSON.parse(localStorage.getItem('admin_duyuru_gorulen') || 'null');                           // eski duyuru istemcisinin görülenleri
    if (Array.isArray(oldAnn) && FC.storage.get('ann.seen', null) == null) FC.storage.set('ann.seen', oldAnn);
  } catch (e) { }

  /* ---------- çekirdeği başlat ---------- */
  FC.init({
    app: APP, repo: REPO, version: VER,
    setupChannel: DESK && !PORTABLE ? 'win-setup' : undefined,
    announcements: true, whatsnew: false, onboarding: false,
    update: !(LEGACY_DESK || LEGACY_ANDROID)
  });
  // Taşınabilir kip aynı sürümü (5.7.0) çalıştırır ama kurulum programına geçmesi gerekir: güncelleyici win-setup'ı "eski" sürüm gibi ister
  if (PORTABLE) FC.updater.start({ repo: REPO, app: APP, version: '0.0.0', channel: 'win-setup' });
  var OB = {
    firebase: true, ai: false, store: false,
    onFirebase: function (c) { OB._fb = c; },
    onClose: function () {
      var c = OB._fb; OB._fb = null;
      if (!c || typeof S === 'undefined' || S.sync.enabled) return;
      S.sync.apiKey = c.apiKey; S.sync.projectId = c.projectId;
      try { save(); } catch (e) { }
      setTimeout(function () { if (typeof createFamilyDialog === 'function') createFamilyDialog(); }, 200);
    }
  };

  /* ---------- Kullanım Limitleri: köprüden geçen Firestore REST isteklerini say (ailenin KENDİ projesi) ---------- */
  function countHttp(method, url, body, status, resp) {
    try {
      url = String(url || '');
      if (!/^https:\/\/firestore\.googleapis\.com\/v1\//.test(url) || /comm-calc-103111111/.test(url)) return;
      var m = /\/projects\/([^/]+)\//.exec(url); if (m && status > 0 && status < 400) FC.usage.setProject(decodeURIComponent(m[1]));
      if (status === 429 || /RESOURCE_EXHAUSTED/.test(String(resp || ''))) { FC.usage.count('firebase.full'); return; }
      if (!(status >= 200 && status < 300)) return;
      var path = url.split('?')[0];
      method = String(method || 'GET').toUpperCase();
      if (/:commit$|:batchWrite$/.test(path)) {
        var b = null; try { b = JSON.parse(body || 'null'); } catch (e) { }
        ((b && b.writes) || []).forEach(function (w) { FC.usage.count(w && w['delete'] ? 'firebase.delete' : 'firebase.write'); });
        return;
      }
      var j = null; try { j = typeof resp === 'string' ? JSON.parse(resp || 'null') : resp; } catch (e) { }
      if (/:runQuery$|:batchGet$/.test(path)) { FC.usage.count('firebase.read', Math.max(1, (Array.isArray(j) ? j : []).filter(function (x) { return x && (x.document || x.found); }).length)); return; }
      if (method === 'GET') {
        var segs = (path.split('/documents')[1] || '').split('/').filter(Boolean).length;
        FC.usage.count('firebase.read', segs % 2 === 1 ? Math.max(1, ((j && j.documents) || []).length) : 1);
        return;
      }
      FC.usage.count(method === 'DELETE' ? 'firebase.delete' : 'firebase.write');
    } catch (e) { }
  }

  /* ---------- üst çubuk ---------- */
  var tb = null, lastSync = null;
  function settingsBtn() {
    var b = ui.el('button.btn.small.top-act.aj-settings', { type: 'button' });
    function draw() { b.innerHTML = ui.icon('cog') + '<span class="top-act-label">' + ui.esc(T('aj.settings')) + '</span>'; b.title = T('aj.settings'); b.setAttribute('aria-label', T('aj.settings')); }
    b.addEventListener('click', function () {
      if (typeof push === 'function' && typeof window.__ajTop === 'function' && window.__ajTop() !== 'settings') push({ type: 'settings' });
    });
    draw(); FC.i18n.onChange(draw);
    return b;
  }
  function topbar() {
    var bar = document.getElementById('topbar'); if (!bar || tb) return;
    var vb = document.getElementById('verBadge'); if (vb) vb.textContent = 'v' + VER;
    tb = FC.topbar.mount(bar, {
      before: [FC.announcements.button(), settingsBtn()],
      sync: { state: 'off', onClick: function (st) { if (typeof S !== 'undefined' && S.sync.enabled) syncNow(); else { ui.toast(T('aj.syncSetup'), 'info'); if (typeof push === 'function' && window.__ajTop() !== 'settings') push({ type: 'settings' }); } } },
      lan: { state: 'off', onClick: function () { if (window.LanCore) LanCore.open(); } }
    });
    if (lastSync) tb.setSync(lastSync[0], lastSync[1]);
    measure();
    if (window.ResizeObserver) new ResizeObserver(measure).observe(bar);
  }
  function measure() { var bar = document.getElementById('topbar'); if (bar) document.documentElement.style.setProperty('--aj-top', bar.offsetHeight + 'px'); }
  function setSync(state, pending) { lastSync = [state, pending]; if (tb) tb.setSync(state, pending); }
  function setLan(state) { if (tb) tb.setLan(state); }

  /* ---------- Android durum çubuğu rengi = üst çubuk ---------- */
  function barColor() {
    try {
      if (!A || DESK || typeof A.setBarColor !== 'function') return;
      var c = getComputedStyle(document.documentElement).getPropertyValue('--topbar-bg').trim() || getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      var d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); var rgb = getComputedStyle(d).color; d.remove();
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb); if (!m) return;
      A.setBarColor('#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + (+x).toString(16)).slice(-2); }).join(''));
    } catch (e) { }
  }
  FC.look.onChange(function () { setTimeout(barColor, 30); });

  /* ---------- dil (uygulama ↔ çekirdek iki yönlü) ---------- */
  function initialLang(appLang) {
    var fl = FC.storage.get('lang', null);
    if (fl) return fl;
    if (appLang) FC.i18n.set(appLang);
    return appLang;
  }
  function langChanged(l) { if (FC.i18n.lang() !== l) FC.i18n.set(l); }
  FC.i18n.onChange(function (l) {
    if (typeof S === 'undefined' || !S || S.settings.lang === l) return;
    S.settings.lang = l; applyLang(); if (typeof translateAll === 'function') translateAll(); saveNow(); render();
  });

  /* ---------- ayarlar: çekirdek kartları (Görünüm · Asistan Agent · Kullanım Limitleri · Hata raporu · Hakkında · Admin ile iletişim EN SON) ---------- */
  var grid = null;
  function mountSettings(host) {
    if (!host) return;
    if (!grid) {
      grid = ui.el('div.settings-grid.aj-core');
      var cards = [];
      if (DESK && INFO && INFO.mode === 'installed' && typeof A.importLegacy === 'function') cards.push(legacyCard());
      if (window.FCYZ && FCYZ.available()) { // çevrimdışı yapay zekâ: internetsiz çeviri paketleri
        var yz = document.createElement('div'), lg = document.documentElement.lang || 'tr';
        yz.className = 'card'; yz.id = 'yerelZeka';
        var h = document.createElement('h3'); h.textContent = FCYZ.title({ lang: lg }); yz.appendChild(h);
        yz.appendChild(FCYZ.card({ lang: lg, packs: ['llm', 'mt'] })); cards.push(yz);
      }
      FC.settings.build(grid, { cards: cards, usage: { firebase: true, ai: false, project: function () { try { return S.sync.enabled ? S.sync.projectId : ''; } catch (e) { return ''; } } }, about: { version: VER }, onboarding: OB });
    }
    host.appendChild(grid);
  }
  function legacyCard() {
    var c = ui.card({ key: 'aj-legacy', title: T('aj.legacy'), icon: 'box', desc: T('aj.legacyDesc') });
    var b = ui.el('button.btn.small', { type: 'button', html: ui.icon('box') + ui.esc(T('aj.legacyPick')) });
    b.addEventListener('click', function () {
      nat('importLegacy').then(function (r) {
        if (r && r.ok) { try { saveNow(); } catch (e) { } ui.toast(T('aj.legacyOk'), 'info'); }
        else if (r && r.error === 'notfound') ui.toast(T('aj.legacyNotFound'), 'error');
        else if (r && r.error && r.error !== 'cancel') ui.toast(String(r.error), 'error');
      });
    });
    c.appendChild(ui.el('div.fc-row', null, [b]));
    FC.i18n.onChange(function () { c.querySelector('.card-title span').textContent = T('aj.legacy'); c.querySelector('.card-desc').textContent = T('aj.legacyDesc'); b.lastChild.textContent = T('aj.legacyPick'); });
    return c;
  }

  /* ---------- açılış (app.js ilk çizimden sonra çağırır) ---------- */
  function started() {
    topbar(); barColor();
    if (LEGACY_DESK || PORTABLE) { setTimeout(setupBridge, 900); return; }
    if (LEGACY_ANDROID) { setTimeout(apkBridge, 900); return; }
    if (INFO && INFO.migrated && !FC.storage.get('aj.migratedShown', false)) {
      FC.storage.set('aj.migratedShown', true);
      ui.modal({ title: 'Ajandam', icon: 'check', cls: 'small', body: ui.el('div.notice.ok', { text: T('aj.migrated') }) });
    }
    var wn = FC.whatsnew.start({ version: VER, notes: function (v) { return v === VER ? REL.notes : null; } });
    if (!wn) setTimeout(function () { FC.onboarding.maybeStart(OB); }, 700);
  }

  /* ---------- eski kabuk köprüleri ---------- */
  function assetUrl(ch, ext) { return 'https://github.com/' + OWNER + '/' + REPO + '/releases/download/v' + VER + '/' + PREFIX + '-' + VER + '-' + ch + ext; }
  function releasesUrl() { return 'https://github.com/' + OWNER + '/' + REPO + '/releases/latest'; }
  function open(u) { try { if (window.fcHost && fcHost.openExternal) return fcHost.openExternal(u); } catch (e) { } window.open(u, '_blank'); }
  function oldFolder() {
    if (INFO && INFO.data) return INFO.data;
    try { var p = decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, '$1'); var i = p.toLowerCase().lastIndexOf('/resources/'); return (i > 0 ? p.slice(0, i) : p.replace(/\/[^/]*$/, '')).replace(/\//g, '\\') + '\\data'; } catch (e) { return ''; }
  }
  function setupBridge() {
    var body = ui.el('div');
    body.appendChild(ui.el('p', { text: T('aj.setupDesc', VER) }));
    body.appendChild(ui.el('div.notice.ok', null, [ui.el('span', { html: ui.icon('check') }), ui.el('span', { text: T('aj.setupKeep') })]));
    body.appendChild(ui.el('p.muted', { text: T(PORTABLE ? 'aj.setupHint' : 'aj.setupLegacyHint'), style: 'margin-top:12px' }));
    if (!PORTABLE) body.appendChild(ui.el('p.mono.ltr', { text: oldFolder() }));
    var btns = [{ label: T('aj.later'), cls: 'ghost' }, 'spacer', { label: T('aj.releases'), onClick: function () { open(releasesUrl()); return false; } }];
    if (PORTABLE) btns.push({ label: T('aj.setupOne'), icon: 'download', cls: 'primary', onClick: function () { try { saveNow(); } catch (e) { } FC.updater.run().catch(function () { }); return true; } });
    else btns.push({ label: T('aj.setupDl'), icon: 'download', cls: 'primary', onClick: function () { try { saveNow(); } catch (e) { } open(assetUrl('win-setup', '.exe')); return false; } });
    ui.modal({ title: T('aj.newSetup'), icon: 'download', body: body, buttons: btns });
  }
  function apkBridge() {
    var body = ui.el('div');
    body.appendChild(ui.el('p', { text: T('aj.apkDesc', VER) }));
    body.appendChild(ui.el('div.notice.ok', null, [ui.el('span', { html: ui.icon('check') }), ui.el('span', { text: T('aj.apkKeep') })]));
    body.appendChild(ui.el('p.muted', { text: T('aj.apkHint'), style: 'margin-top:12px' }));
    ui.modal({ title: T('aj.newApk'), icon: 'download', body: body, buttons: [
      { label: T('aj.later'), cls: 'ghost' }, 'spacer',
      { label: T('aj.apkDl'), icon: 'download', cls: 'primary', onClick: function () { try { saveNow(); } catch (e) { } open(releasesUrl()); return false; } }   // sürümler sayfası: APK o sürümde yoksa da kırık bağlantı olmaz
    ] });
  }
  // Eski kabukta "Güncelle" de köprüye götürür
  if (LEGACY_DESK || LEGACY_ANDROID) {
    FC.updater.run = function () { (LEGACY_DESK ? setupBridge : apkBridge)(); return Promise.resolve('legacy'); };
    FC.updater.check = function () { (LEGACY_DESK ? setupBridge : apkBridge)(); return Promise.resolve(null); };
  }

  window.Kabuk = {
    version: VER, desk: DESK, portable: PORTABLE, legacyDesk: LEGACY_DESK, legacyAndroid: LEGACY_ANDROID, info: INFO,
    topbar: topbar, setSync: setSync, setLan: setLan, countHttp: countHttp, initialLang: initialLang, langChanged: langChanged,
    mountSettings: mountSettings, started: started, setupBridge: setupBridge, apkBridge: apkBridge, assetUrl: assetUrl, OB: OB
  };
})();
