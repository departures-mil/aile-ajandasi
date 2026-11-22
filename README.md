# Ajandam (Aile Ajandası)

Aile ajandası: Windows masaüstü (Electron, taşınabilir) + Android. Kayıtlar ailenin Firebase'i ve aynı Wi‑Fi üzerinden
eşitlenir; **kayıtlar bu depoda bulunmaz**.

- `www/` ortak arayüz, `desktop/` masaüstü kabuğu, `android/` Android kaynağı (yayındaki APK 4.7'nin kaynağı, Wi‑Fi eşitleme `LanSync.java` dahil; 2026-11-22'de özel `ajandam` deposundan alındı).
- `guncelleme/upd_latest.json` + `bundle-<code>.gz` — ECDSA imzalı güncelleme. Masaüstü buradan güncellenir.
- Telefon uygulaması (APK 4.7) güncellemeyi henüz ailenin Firebase'inden alır; `tools/yayinla.py --firebase` aynı paketi oraya da koyar.
- İmza anahtarları (`keys/`) depoda yoktur.

## Yeni sürüm
`python3 tools/yayinla.py --version 4.9 --notes "Ne değişti" --firebase` → `git add -A && git commit && git push`

## Not (2026-11-22)
4.8 iki ayrı oturumda iki kez yapıldı: özel `departures-mil/ajandam` deposunda "Bakım sekmesi", bu depoda "masaüstü güncellemeleri GitHub'dan".
4.9 (admin iletişimi) Bakım sekmesini içermediği için telefonda kaybolmuştu; 5.0'da ikisi birleştirildi. Geliştirme yalnız bu depoda yapılır;
`ajandam` deposu eskidir (yalnız arşiv). Yayından önce `git pull` ve Firebase'deki `upd_latest` sürümünü kontrol edin.
