# Ajandam (Aile Ajandası)

Aile ajandası: Windows masaüstü (Electron, taşınabilir) + Android. Kayıtlar ailenin Firebase'i ve aynı Wi‑Fi üzerinden
eşitlenir; **kayıtlar bu depoda bulunmaz**.

- `www/` ortak arayüz, `desktop/` masaüstü kabuğu, `android/` Android kaynağı (**4.6 kaynağı**; yayındaki APK 4.7).
- `guncelleme/upd_latest.json` + `bundle-<code>.gz` — ECDSA imzalı güncelleme. Masaüstü buradan güncellenir.
- Telefon uygulaması (APK 4.7) güncellemeyi henüz ailenin Firebase'inden alır; `tools/yayinla.py --firebase` aynı paketi oraya da koyar.
- İmza anahtarları (`keys/`) depoda yoktur.

## Yeni sürüm
`python3 tools/yayinla.py --version 4.9 --notes "Ne değişti" --firebase` → `git add -A && git commit && git push`
