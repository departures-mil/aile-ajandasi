"""Ajandam APK'sını Gradle ve Android SDK olmadan üretir (depo kökünden):
  python3 tools/apk.py <ajandam-release.jks> <şifre> <çıktı.apk>
  (şifre "-" ise AJANDAM_KS_PASS ortam değişkeninden okunur; şifreyi komut satırına/depoya yazmayın)
aapt2 (build-tools 34), android.jar (platform 34), d8 (r8.jar) ve apksig ilk çalıştırmada ~/.cache/og-apk/ altına iner.
Sürüm android/app/build.gradle'dan (versionCode = NATIVE_CODE, versionName) okunur; android/app/src/main/assets/www, www/ klasöründen yenilenir.
İmza anahtarı depoda DEĞİL: C:\\Claude Programlarım\\_Anahtarlar\\Ajandam (alias ajandam).
"""
import glob, os, re, shutil, struct, subprocess, sys, tempfile, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "android", "app", "src", "main")
CACHE = os.path.expanduser("~/.cache/og-apk")
URLS = {
    "apksig.jar": "https://dl.google.com/android/maven2/com/android/tools/build/apksig/8.7.3/apksig-8.7.3.jar",
    "r8.jar": "https://dl.google.com/android/maven2/com/android/tools/r8/8.5.35/r8-8.5.35.jar",
}


def cached(name):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if os.path.exists(p):
        return p
    if name == "android.jar":
        z = p + ".zip"
        urllib.request.urlretrieve("https://dl.google.com/android/repository/platform-34-ext7_r02.zip", z)
        with zipfile.ZipFile(z) as zf:
            open(p, "wb").write(zf.read(next(n for n in zf.namelist() if n.endswith("/android.jar"))))
        os.remove(z)
    elif name == "bt/aapt2":
        z = os.path.join(CACHE, "bt.zip")
        urllib.request.urlretrieve("https://dl.google.com/android/repository/build-tools_r34-linux.zip", z)
        os.makedirs(os.path.join(CACHE, "bt"), exist_ok=True)
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.endswith("/aapt2") or "/lib64/" in n and not n.endswith("/"):
                    open(os.path.join(CACHE, "bt", os.path.basename(n)), "wb").write(zf.read(n))
        os.chmod(p, 0o755)
        os.remove(z)
    else:
        urllib.request.urlretrieve(URLS[name], p)
    return p


def run(*cmd, **kw):
    r = subprocess.run(list(cmd), capture_output=True, text=True, **kw)
    out = "\n".join(l for l in (r.stdout + r.stderr).splitlines() if "JAVA_" not in l)
    if r.returncode:
        raise SystemExit("HATA: " + " ".join(cmd[:3]) + "\n" + out)
    return out


def align(src, dst, n=4):
    zin = zipfile.ZipFile(src)
    with zipfile.ZipFile(dst, "w") as zout:
        for i in zin.infolist():
            data = zin.read(i.filename)
            zi = zipfile.ZipInfo(i.filename, date_time=i.date_time)
            zi.compress_type, zi.external_attr = i.compress_type, i.external_attr
            if i.compress_type == zipfile.ZIP_STORED:
                off = zout.fp.tell() + 30 + len(i.filename.encode("utf-8"))
                pad = (-(off + 6)) % n
                zi.extra = struct.pack("<HHH", 0xD935, 2 + pad, n) + b"\0" * pad
            zout.writestr(zi, data, compress_type=i.compress_type)


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    ks, pw, out = sys.argv[1:]
    if pw == "-":
        pw = os.environ.get("AJANDAM_KS_PASS", "")
    g = open(os.path.join(ROOT, "android", "app", "build.gradle"), encoding="utf-8").read()
    vcode = re.search(r"versionCode\s+(\d+)", g).group(1)
    vname = re.search(r'versionName\s+"([^"]+)"', g).group(1)
    aapt2, ajar, r8, apksig = cached("bt/aapt2"), cached("android.jar"), cached("r8.jar"), cached("apksig.jar")
    # www/ (alt klasörler dahil: cekirdek/) → assets/www (twemoji yerinde kalır)
    subprocess.run(["node", os.path.join(ROOT, "tools", "hazirla.js")], check=True)
    env = dict(os.environ, LD_LIBRARY_PATH=os.path.dirname(aapt2))
    with tempfile.TemporaryDirectory() as t:
        flat = os.path.join(t, "res.zip")
        run(aapt2, "compile", "--dir", os.path.join(APP, "res"), "-o", flat, env=env)
        base = os.path.join(t, "base.apk")
        man = os.path.join(t, "AndroidManifest.xml")   # Gradle'daki namespace → manifest package
        m = open(os.path.join(APP, "AndroidManifest.xml"), encoding="utf-8").read()
        if "package=" not in m:
            m = m.replace("<manifest ", '<manifest package="com.ajandam.app" ', 1)
        open(man, "w", encoding="utf-8").write(m)
        run(aapt2, "link", "-o", base, "-I", ajar, "--manifest", man, "--version-code", vcode, "--version-name", vname,
            "--min-sdk-version", "24", "--target-sdk-version", "34", "--java", os.path.join(t, "gen"), "-A", os.path.join(APP, "assets"),
            flat, env=env)
        cls = os.path.join(t, "cls")
        srcs = glob.glob(os.path.join(APP, "java", "**", "*.java"), recursive=True) + glob.glob(os.path.join(t, "gen", "**", "*.java"), recursive=True)
        run("javac", "-nowarn", "--release", "11", "-cp", ajar, "-d", cls, *srcs)
        dex = os.path.join(t, "dex")
        os.makedirs(dex)
        run("java", "-cp", r8, "com.android.tools.r8.D8", "--release", "--min-api", "24", "--lib", ajar, "--output", dex,
            *glob.glob(os.path.join(cls, "**", "*.class"), recursive=True))
        unsigned = os.path.join(t, "u.apk")
        with zipfile.ZipFile(base) as zin, zipfile.ZipFile(unsigned, "w", zipfile.ZIP_DEFLATED) as zout:
            for i in zin.infolist():
                zout.writestr(i, zin.read(i.filename), compress_type=zipfile.ZIP_STORED if i.filename == "resources.arsc" or i.filename.endswith(".png") else zipfile.ZIP_DEFLATED)
            zout.write(os.path.join(dex, "classes.dex"), "classes.dex")
        aligned = os.path.join(t, "a.apk")
        align(unsigned, aligned)
        run("javac", "-nowarn", "-cp", apksig, "-d", t, os.path.join(ROOT, "tools", "apk", "Imzala.java"))
        print(run("java", "-cp", apksig + os.pathsep + t, "Imzala", ks, pw, os.environ.get("AJANDAM_KEY_ALIAS", "ajandam"), aligned, os.path.abspath(out)).strip())
    print(f"APK: {out} (versionCode {vcode}, {vname}, {os.path.getsize(out) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
