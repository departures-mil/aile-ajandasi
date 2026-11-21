#!/usr/bin/env python3
"""Ajandam — yeni sürümü yayınlar (depo kökünden):
  python3 tools/yayinla.py --version 4.9 --notes "Ne değişti" [--firebase]

- GitHub: guncelleme/upd_latest.json + guncelleme/bundle-<code>.gz (masaüstü buradan güncellenir).
- --firebase: aynı imzalı paketi ailenin Firestore'una da koyar. Telefon uygulaması (4.7 APK) henüz
  Firebase'den güncellendiği için telefonda değişiklik varsa bu bayrak gerekir.
Gerekenler (depoda YOK, geliştiricinin bilgisayarında): keys/update-private.pem, keys/publisher-prefs.json
Sonra: git add -A && git commit -m "Ajandam X" && git push
"""
import argparse, gzip, hashlib, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import publish  # noqa: E402  (sign, upload, FS)

G = os.path.join(ROOT, 'guncelleme')


def collect_files():
    files = {}
    for sub, pat in (('www', r'\.(js|css|html|json)$'), ('desktop', r'\.(js|json)$')):
        d = os.path.join(ROOT, sub)
        for name in sorted(os.listdir(d)):
            f = os.path.join(d, name)
            if os.path.isfile(f) and re.search(pat, name):
                files[f'{sub}/{name}'] = open(f, encoding='utf-8').read()
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--version', required=True)
    ap.add_argument('--notes', default='')
    ap.add_argument('--firebase', action='store_true')
    ap.add_argument('--key', default=os.path.join(ROOT, 'keys', 'update-private.pem'))
    ap.add_argument('--prefs', default=os.path.join(ROOT, 'keys', 'publisher-prefs.json'))
    a = ap.parse_args()
    os.makedirs(G, exist_ok=True)
    yol = os.path.join(G, 'upd_latest.json')
    cur = json.load(open(yol, encoding='utf-8')) if os.path.exists(yol) else {}
    fs = publish.FS(a.prefs) if a.firebase else None
    fb = json.loads(fs.get('upd_latest') or '{}') if fs else {}
    code = max(int(cur.get('code', 30)), int(fb.get('code', 0)), 30) + 1
    pkg_path = os.path.join(ROOT, 'desktop', 'package.json')
    pkg = json.load(open(pkg_path, encoding='utf-8'))
    pkg['buildCode'] = code
    pkg['version'] = a.version if a.version.count('.') >= 2 else a.version + '.0'
    open(pkg_path, 'w', encoding='utf-8').write(json.dumps(pkg, indent=2, ensure_ascii=False) + '\n')
    bundle = {'code': code, 'version': a.version, 'files': collect_files()}
    gz = gzip.compress(json.dumps(bundle, ensure_ascii=False).encode('utf-8'), 9, mtime=0)
    sig = publish.sign(a.key, gz)
    sha = hashlib.sha256(gz).hexdigest()
    for f in os.listdir(G):
        if f.startswith('bundle-'):
            os.remove(os.path.join(G, f))
    name = f'bundle-{code}.gz'
    open(os.path.join(G, name), 'wb').write(gz)
    man = {'code': code, 'version': a.version, 'notes': a.notes, 'file': name, 'bytes': len(gz), 'sha': sha, 'sig': sig,
           'published': int(time.time() * 1000)}
    json.dump(man, open(yol, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'GitHub hazır: code {code} v{a.version}, {len(gz):,} bayt')
    if fs:
        sizes = publish.upload(fs, f'upd_b{code}', gz)
        fbm = dict(fb)
        fbm.update({'code': code, 'version': a.version, 'notes': a.notes, 'parts': len(sizes), 'partChars': sizes,
                    'bytes': len(gz), 'sha': sha, 'sig': sig, 'published': man['published']})
        fs.put('upd_latest', json.dumps(fbm, ensure_ascii=False))
        print('Firebase da yayında (telefonlar için)')


if __name__ == '__main__':
    main()
