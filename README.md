# Ajandam (Aile Ajandası)

## 5.7.0 — ortak çekirdek (GÜNCEL DÜZEN; aşağıdaki eski notlardan önceliklidir)
- Sürüm tek: `desktop/package.json` → `node tools/surum.js X.Y.Z` (www/surum.js, package.json, Android versionName/versionCode = X*10000+Y*100+Z).
- Güncelleme yalnız **GitHub Releases** (`latest.json` + delta yama, ortak çekirdek `FC.updater`): masaüstü `win-app` (app.asar) +
  `win-setup` (NSIS, kullanıcı başına, tek tık), telefon `android` (APK; yama = kurulu APK + FCD1 → yeni APK, `FcBridge.java`).
  Yayın: main'de Actions → release → Run workflow (test → derleme → release). Testler geçmezse yayın olmaz.
- Masaüstü veri yeri: kurulu sürüm `%APPDATA%\Ajandam\data`. Eski taşınabilir sürüm `exe yanındaki data\`; kurulu sürüm ilk açılışta
  `%APPDATA%\Ajandam\eski-konum.json`'daki yerden veriyi KOPYALAR (orijinale dokunmaz) ya da Ayarlar → "Eski Ajandam klasöründen veri al".
- Ortak arayüz `www/` (çekirdek `www/cekirdek/`, kabuk `www/kabuk.js`); `node tools/hazirla.js` → `desktop/www` + Android assets (depoda tutulmaz).
- Eşitleme kuralı: hiçbir kayıt silinmez/üstüne yazılmaz — başka cihazda silinen → Arşiv, çakışma → yedek (Ayarlar → Arşiv ve yedekler).
- **Eski kanal köprüsü** (`guncelleme/`, ECDSA): yalnız ≤5.6 kurulumları için. Release'ten SONRA Milen'in bilgisayarında:
  `python tools/kopru.py --firebase` (anahtar `keys/update-private.pem`, depoda yok).
- APK imza şifresi depoda YOK: ortam değişkeni `AJANDAM_KS_PASS` (+ `AJANDAM_KS_FILE`, `AJANDAM_KEY_ALIAS`) ya da gitignore'lu
  `android/keystore.properties`; CI secret'ları `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`.
- Test: `npm test` (node duman testi + 3 Electron açılış testi, xvfb). Ekran: `node tools/ekran.js <klasör>`.

## Eski notlar (5.6 ve öncesi)

Aile ajandası: Windows masaüstü (Electron, taşınabilir) + Android. Kayıtlar ailenin Firebase'i ve aynı Wi‑Fi üzerinden
eşitlenir; **kayıtlar bu depoda bulunmaz**.

- `www/` ortak arayüz, `desktop/` masaüstü kabuğu, `android/` Android kaynağı (yayındaki APK 4.7'nin kaynağı, Wi‑Fi eşitleme `LanSync.java` dahil; 2026-11-22'de özel `ajandam` deposundan alındı).
- `guncelleme/upd_latest.json` + `bundle-<code>.gz` — ECDSA imzalı güncelleme. Masaüstü buradan güncellenir.
- Telefon uygulaması (APK 4.7) güncellemeyi ailenin Firebase'inden alır. 5.1'den itibaren **bilgisayardaki Ajandam** GitHub'daki imzalı paketi
  ailenin Firebase'ine kendisi aktarır (açılıştan 1 dk sonra ve 6 saatte bir; `desktop/main.js` relayUpdateToFamily). Elle: `tools/yayinla.py --firebase`.
- İmza anahtarları (`keys/`) depoda yoktur.

## Yeni sürüm
`python3 tools/yayinla.py --version 4.9 --notes "Ne değişti" --firebase` → `git add -A && git commit && git push`

## Not (2026-11-22)
4.8 iki ayrı oturumda iki kez yapıldı: özel `departures-mil/ajandam` deposunda "Bakım sekmesi", bu depoda "masaüstü güncellemeleri GitHub'dan".
4.9 (admin iletişimi) Bakım sekmesini içermediği için telefonda kaybolmuştu; 5.0'da ikisi birleştirildi. Geliştirme yalnız bu depoda yapılır;
`ajandam` deposu eskidir (yalnız arşiv). Yayından önce `git pull` ve Firebase'deki `upd_latest` sürümünü kontrol edin.

## 5.4 (2026-11-22)
- Ayarlar > Kullanım Limitleri (`www/kullanim.js` = duyurular/istemci/kullanim.js, `www/kullanim-baslat.js`); `nat('http')` cevapları sayılır.
- Ortak Firebase projesi (`aileajandasi-f65c9`) programdan çıkarıldı: her aile kendi ücretsiz hesabını kurar (❓ yardım / duyurular/firebase-kurulum.md).
  Eski ortak projede yalnız yöneticinin ailesi (`YONETICI_AILE` = R69ZH34686) kalır; diğer ailelerin eşitlemesi kapatılır, kayıtları telefonda kalır.

## Asistan Agent
5.7.0'dan itibaren ortak çekirdeğin içindeki `FC.agent` kullanılır (`www/cekirdek/fc-core.js`; ✦ üst çubukta, Ayarlar'da kendi kartı,
Electron sayaç paylaşımı `fc-electron-main.js`, Android bildirimi `AndroidBridge.notify`). Ayrı `fc-agent.js` / `agent-baslat.js` /
`fc-agent-main.js` (2026-11-24 ara commit'i) bu yüzden kaldırıldı.
