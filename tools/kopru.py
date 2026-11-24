#!/usr/bin/env python3
"""Ajandam — ESKİ GÜNCELLEME KANALI KÖPRÜSÜ (5.6 ve öncesi kurulumlar için). Depo kökünden, GitHub Release YAYINLANDIKTAN SONRA:

    python tools/kopru.py            # imzala + guncelleme/ yaz + git commit + push
    python tools/kopru.py --firebase # ayrıca kendi ailenin Firebase'ine koy (Firebase'den güncellenen eski telefonlar için)
    python tools/kopru.py --dry-run --out /tmp/k   # imzasız deneme (test), hiçbir şey yayınlanmaz

Eski kurulumlar ne yapar:
  - Masaüstü ≤5.6 (taşınabilir): raw guncelleme/upd_latest.json okur, code > 39 ise bundle-<code>.gz'yi indirir, ECDSA imzasını
    doğrular, içindeki www/* ve desktop/* METİN dosyalarını program klasörüne yazar ve yeniden başlar (main.js dahil).
    → Yeni main.js taşınabilir kipte açılır (veri yeri değişmez), "Yeni kurulum gerekli" penceresi tek tuşla kurulum
      programını (GitHub Releases, win-setup) indirir ve kurar; kurulu sürüm veriyi kopyalar.
  - Telefon APK 5.2: aynı dosyayı GitHub'dan, APK 4.7: ailenin Firebase'inden okur (masaüstü 5.1+ oraya aktarır);
    yalnız www/* dosyalarını alır → yeni arayüz eski APK'da açılır ve yeni APK'nın bağlantısını gösterir (aynı imza, veri kalır).
İmza anahtarı (keys/update-private.pem) depoda YOK; geliştiricinin bilgisayarında: C:\\Claude Programlarım\\_Anahtarlar\\Ajandam
"""
import argparse, gzip, hashlib, json, os, subprocess, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = os.path.join(ROOT, 'guncelleme')
TEXT = ('.js', '.css', '.html', '.json', '.txt')
OLD_CODE = 39   # 5.6


def collect_files():
    """Eski güncelleyiciler dosyaları METİN olarak yazar: ikili dosyalar (yazı tipleri, png) alınmaz (yazı tipi yoksa sistem yazısı)."""
    files = {}
    for sub, skip_dirs in (('www', {'twemoji'}), ('desktop', {'www', 'data', 'node_modules'})):
        base = os.path.join(ROOT, sub)
        for d, dirs, names in os.walk(base):
            dirs[:] = sorted(x for x in dirs if not (d == base and x in skip_dirs))
            for n in sorted(names):
                if n.endswith(TEXT) or n == 'VERSION':
                    p = os.path.join(d, n)
                    rel = sub + '/' + os.path.relpath(p, base).replace(os.sep, '/')
                    files[rel] = open(p, encoding='utf-8').read()
    return files


def release_ok(version):
    url = f'https://github.com/departures-mil/aile-ajandasi/releases/download/v{version}/latest.json'
    try:
        man = json.load(urllib.request.urlopen(url, timeout=30))
    except Exception as e:
        raise SystemExit(f'v{version} release bulunamadı ({e}). Önce GitHub Release yayınlanmalı.')
    if man.get('version') != version or 'win-setup' not in man.get('assets', {}):
        raise SystemExit('latest.json beklenen sürüm/kanal (win-setup) değil: ' + json.dumps(man)[:300])
    return man


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--firebase', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-git', action='store_true')
    ap.add_argument('--out', default=G)
    ap.add_argument('--key', default=os.path.join(ROOT, 'keys', 'update-private.pem'))
    ap.add_argument('--prefs', default=os.path.join(ROOT, 'keys', 'publisher-prefs.json'))
    a = ap.parse_args()
    pkg = json.load(open(os.path.join(ROOT, 'desktop', 'package.json'), encoding='utf-8'))
    version, code = pkg['version'], int(pkg.get('buildCode', OLD_CODE + 1))
    if code <= OLD_CODE:
        raise SystemExit('desktop/package.json buildCode > 39 olmalı')
    notes = json.load(open(os.path.join(ROOT, 'release-notes.json'), encoding='utf-8'))
    if not a.dry_run:
        release_ok(version)
    files = collect_files()
    bundle = {'code': code, 'version': version, 'files': files}
    gz = gzip.compress(json.dumps(bundle, ensure_ascii=False, sort_keys=True).encode('utf-8'), 9, mtime=0)
    sha = hashlib.sha256(gz).hexdigest()
    sig = ''
    if not a.dry_run:
        sys.path.insert(0, os.path.join(ROOT, 'tools'))
        import publish  # cryptography gerekir
        if not os.path.exists(a.key):
            raise SystemExit('İmza anahtarı yok: ' + a.key + '  (C:\\Claude Programlarım\\_Anahtarlar\\Ajandam\\update-private.pem → keys/)')
        sig = publish.sign(a.key, gz)
    os.makedirs(a.out, exist_ok=True)
    for f in os.listdir(a.out):
        if f.startswith('bundle-'):
            os.remove(os.path.join(a.out, f))
    name = f'bundle-{code}.gz'
    open(os.path.join(a.out, name), 'wb').write(gz)
    msg = (f'Ajandam {version}: yeni kurulum programı ve tek tuşla güncelleme (GitHub). Bu güncellemeden sonra program sizi '
           f'yeni sürüme yönlendirir; kayıtlarınız korunur.\n' + notes['tr'])
    man = {'code': code, 'version': version, 'notes': msg, 'file': name, 'bytes': len(gz), 'sha': sha, 'sig': sig, 'published': int(time.time() * 1000)}
    json.dump(man, open(os.path.join(a.out, 'upd_latest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'köprü paketi: code {code} v{version}, {len(files)} dosya, {len(gz):,} bayt' + (' (İMZASIZ deneme)' if a.dry_run else ''))
    if a.dry_run:
        return
    if a.firebase:
        fs = publish.FS(a.prefs)
        fb = json.loads(fs.get('upd_latest') or '{}')
        sizes = publish.upload(fs, f'upd_b{code}', gz)
        fb.update({'code': code, 'version': version, 'notes': msg, 'parts': len(sizes), 'partChars': sizes, 'bytes': len(gz), 'sha': sha, 'sig': sig, 'published': man['published']})
        fs.put('upd_latest', json.dumps(fb, ensure_ascii=False))
        print('ailenin Firebase\'ine de konuldu')
    if not a.no_git:
        subprocess.run(['git', 'add', 'guncelleme'], cwd=ROOT, check=True)
        subprocess.run(['git', 'commit', '-m', f'Eski kanal köprüsü: guncelleme/upd_latest.json → {version} (code {code})'], cwd=ROOT, check=True)
        subprocess.run(['git', 'push'], cwd=ROOT, check=True)
        print('GitHub\'a gönderildi. Eski masaüstü ve telefon kurulumları birkaç saat içinde yeni sürüme yönlendirilir.')


if __name__ == '__main__':
    main()
