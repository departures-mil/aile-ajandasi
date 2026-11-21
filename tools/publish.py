#!/usr/bin/env python3
"""
Ajandam — publishes a signed update into the family's Firestore, so every phone and computer
shows "New version ready — Update" and installs it with one button.

  python3 publish.py --version 4.1 --notes "Ne değişti"            # web arayüzü + masaüstü (www/ + desktop/)
  python3 publish.py --version 4.1 --notes "..." --apk app.apk     # + yeni APK (Java tarafı değiştiyse)
  python3 publish.py --show                                        # yayındaki sürümü göster

Where things go (all in families/{fid}/photos/, the only collection every family member may write):
  upd_latest          {data: JSON manifest}
  upd_b{code}_{i}     {data: base64 piece of gzip(JSON {code, version, files})}
  upd_apk{code}_{i}   {data: base64 piece of the APK}
The manifest's sha/sig cover the gzip bundle and the APK; apps check them with the public key built into them.

Needs: keys/update-private.pem (ECDSA P-256) and a prefs.json of a family device (uid + refresh token + sync).
"""
import argparse, base64, gzip, hashlib, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PART = 700_000  # characters of base64 per Firestore document (limit is ~1 MB)


def load_prefs(path):
    p = json.load(open(path, encoding='utf-8'))
    cfg = json.loads(p['sync'])
    return p, cfg


class FS:
    def __init__(self, prefs_path):
        self.p, self.cfg = load_prefs(prefs_path)
        self.base = f"https://firestore.googleapis.com/v1/projects/{self.cfg['projectId']}/databases/(default)/documents/families/{self.cfg['fid']}/photos"
        self.tok = None

    def token(self):
        if self.tok:
            return self.tok
        body = urllib.parse.urlencode({'grant_type': 'refresh_token', 'refresh_token': self.p['refresh']}).encode()
        r = urllib.request.urlopen(urllib.request.Request(
            'https://securetoken.googleapis.com/v1/token?key=' + self.cfg['apiKey'], data=body,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}))
        self.tok = json.load(r)['id_token']
        return self.tok

    def req(self, method, doc, data=None):
        url = f'{self.base}/{doc}'
        body = json.dumps({'fields': {'data': {'stringValue': data}}}).encode() if data is not None else None
        h = {'Authorization': 'Bearer ' + self.token(), 'Content-Type': 'application/json'}
        for attempt in range(4):
            try:
                r = urllib.request.urlopen(urllib.request.Request(url, data=body, headers=h, method=method), timeout=120)
                return r.status, r.read().decode()
            except urllib.error.HTTPError as e:
                if e.code in (404, 403, 400):
                    return e.code, e.read().decode()
                err = e
            except Exception as e:  # network hiccup
                err = e
            time.sleep(2 + attempt * 3)
        raise SystemExit(f'HTTP error on {doc}: {err}')

    def get(self, doc):
        s, b = self.req('GET', doc)
        if s == 404:
            return None
        if s != 200:
            raise SystemExit(f'GET {doc}: HTTP {s} {b[:200]}')
        return json.loads(b).get('fields', {}).get('data', {}).get('stringValue', '')

    def put(self, doc, data):
        s, b = self.req('PATCH', doc, data)
        if s != 200:
            raise SystemExit(f'PATCH {doc}: HTTP {s} {b[:200]}')


def sign(key_path, data):
    key = serialization.load_pem_private_key(open(key_path, 'rb').read(), password=None)
    sig = key.sign(data, ec.ECDSA(hashes.SHA256()))
    key.public_key().verify(sig, data, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(sig).decode()


def upload(fs, prefix, blob):
    """Returns the part sizes (base64 characters) so apps can show 'x / y MB' while downloading."""
    b64 = base64.b64encode(blob).decode()
    parts = [b64[i:i + PART] for i in range(0, len(b64), PART)] or ['']
    for i, part in enumerate(parts):
        fs.put(f'{prefix}_{i}', part)
        print(f'  {prefix}_{i}  ({len(part):,} chars)')
    return [len(p) for p in parts]


def collect_files():
    files = {}
    www = os.path.join(ROOT, 'www')
    for name in sorted(os.listdir(www)):
        f = os.path.join(www, name)
        if os.path.isfile(f) and re.search(r'\.(js|css|html|json)$', name):
            files['www/' + name] = open(f, encoding='utf-8').read()
    desk = os.path.join(ROOT, 'desktop')
    for name in ('main.js', 'preload.js', 'package.json'):
        files['desktop/' + name] = open(os.path.join(desk, name), encoding='utf-8').read()
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--version')
    ap.add_argument('--notes', default='')
    ap.add_argument('--apk', help='signed APK to publish as well')
    ap.add_argument('--apk-only', action='store_true', help='publish only the APK, keep the current bundle')
    ap.add_argument('--prefs', default=os.path.join(ROOT, 'keys', 'publisher-prefs.json'))
    ap.add_argument('--key', default=os.path.join(ROOT, 'keys', 'update-private.pem'))
    ap.add_argument('--show', action='store_true')
    a = ap.parse_args()

    fs = FS(a.prefs)
    cur = fs.get('upd_latest')
    cur = json.loads(cur) if cur else {}
    if a.show:
        print(json.dumps(cur, indent=2, ensure_ascii=False))
        return
    if not a.version:
        raise SystemExit('--version gerekli')

    man = dict(cur)
    if not a.apk_only:
        code = max(int(cur.get('code', 22)), 22) + 1
        # desktop/package.json must carry the same build code and version as the bundle
        pkg_path = os.path.join(ROOT, 'desktop', 'package.json')
        pkg = json.load(open(pkg_path, encoding='utf-8'))
        pkg['buildCode'] = code
        pkg['version'] = a.version if a.version.count('.') >= 2 else a.version + '.0'
        open(pkg_path, 'w', encoding='utf-8').write(json.dumps(pkg, indent=2, ensure_ascii=False) + '\n')
        bundle = {'code': code, 'version': a.version, 'files': collect_files()}
        gz = gzip.compress(json.dumps(bundle, ensure_ascii=False).encode('utf-8'), 9, mtime=0)
        print(f'bundle code {code}: {len(bundle["files"])} files, {len(gz):,} bytes gzip')
        sizes = upload(fs, f'upd_b{code}', gz)
        man.update({'code': code, 'version': a.version, 'notes': a.notes, 'parts': len(sizes), 'partChars': sizes, 'bytes': len(gz),
                    'sha': hashlib.sha256(gz).hexdigest(), 'sig': sign(a.key, gz)})

    if a.apk:
        apk = open(a.apk, 'rb').read()
        badge = os.popen(f'aapt dump badging "{a.apk}" 2>/dev/null').read() if os.system('which aapt >/dev/null 2>&1') == 0 else ''
        m = re.search(r"versionCode='(\d+)' versionName='([^']*)'", badge)
        if not m:
            raise SystemExit('APK versionCode okunamadı (aapt gerekli)')
        apk_code, apk_ver = int(m.group(1)), m.group(2)
        print(f'apk code {apk_code} (v{apk_ver}): {len(apk):,} bytes')
        sizes = upload(fs, f'upd_apk{apk_code}', apk)
        man.update({'apkCode': apk_code, 'apkVersion': apk_ver, 'apkParts': len(sizes), 'apkBytes': len(apk),
                    'apkSha': hashlib.sha256(apk).hexdigest(), 'apkSig': sign(a.key, apk)})
        if a.apk_only:
            man['notes'] = a.notes or man.get('notes', '')

    man['published'] = int(time.time() * 1000)
    fs.put('upd_latest', json.dumps(man, ensure_ascii=False))
    print('yayında:', json.dumps({k: v for k, v in man.items() if 'sig' not in k.lower() and 'sha' not in k.lower()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
