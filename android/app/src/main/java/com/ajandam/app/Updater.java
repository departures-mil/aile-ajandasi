package com.ajandam.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Iterator;
import java.util.zip.GZIPInputStream;

/**
 * In-app updates, published into the family's own Firestore documents:
 *   families/{fid}/photos/upd_latest          field "data": JSON {code, version, notes, parts, sha, sig, apkCode, apkVersion, apkParts, apkSha, apkSig}
 *   families/{fid}/photos/upd_b{code}_{i}     field "data": base64 piece of the gzipped {code, version, files:{...}} bundle
 *   families/{fid}/photos/upd_apk{apkCode}_{i} field "data": base64 piece of the APK
 * Everything is checked against PUBKEY (ECDSA P-256, SHA-256) before it is used.
 */
public final class Updater {
    private Updater() {}

    public static final String PUBKEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMdYJKGu2BpJT/N9oK9TMsUfmeJqMStUAtvlsA9wHYfk9Z6cJo5zdvTBSJpChyTNe3nGbSP/DJI7YTrnr2zij7w==";
    /** Code of the www bundled in this APK's assets (bumped together with the published bundle it matches). */
    public static final int BUILTIN_WWW_CODE = 35;
    public static final String BUILTIN_WWW_VERSION = "5.2";

    public static File otaDir(Context c) { return new File(c.getFilesDir(), "ota"); }
    static File otaNew(Context c) { return new File(c.getFilesDir(), "ota-new"); }
    static File otaPrev(Context c) { return new File(c.getFilesDir(), "ota-prev"); }

    public static int nativeCode(Context c) {
        try {
            android.content.pm.PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) { return 0; }
    }

    public static int wwwCode(Context c) {
        File meta = new File(otaDir(c), "meta.json");
        try { if (meta.isFile()) return new JSONObject(Store.readText(meta)).optInt("code", BUILTIN_WWW_CODE); } catch (Exception ignored) {}
        return BUILTIN_WWW_CODE;
    }

    public static String wwwVersion(Context c) {
        File meta = new File(otaDir(c), "meta.json");
        try { if (meta.isFile()) return new JSONObject(Store.readText(meta)).optString("version", BUILTIN_WWW_VERSION); } catch (Exception ignored) {}
        return BUILTIN_WWW_VERSION;
    }

    /** Called at every start: swaps in a downloaded bundle and rolls back one that never reported otaOk. */
    public static synchronized void promote(Context c) {
        SharedPreferences p = Store.prefs(c);
        // A new APK carries newer files than an older downloaded bundle: drop the older one.
        try {
            File meta = new File(otaDir(c), "meta.json");
            if (meta.isFile() && new JSONObject(Store.readText(meta)).optInt("code", 0) < BUILTIN_WWW_CODE) Store.deleteTree(otaDir(c));
        } catch (Exception ignored) {}
        if (otaNew(c).isDirectory()) {
            Store.deleteTree(otaPrev(c));
            if (otaDir(c).isDirectory()) otaDir(c).renameTo(otaPrev(c));
            if (otaNew(c).renameTo(otaDir(c))) p.edit().putBoolean("otaTrial", true).putInt("otaBoots", 0).apply();
            else Store.deleteTree(otaNew(c));
        }
        if (p.getBoolean("otaTrial", false)) {
            int boots = p.getInt("otaBoots", 0) + 1;
            if (boots > 3) { // the new bundle never came up: back to the previous one (or the built-in files)
                Store.deleteTree(otaDir(c));
                if (otaPrev(c).isDirectory()) otaPrev(c).renameTo(otaDir(c));
                p.edit().putBoolean("otaTrial", false).putInt("otaBoots", 0).putBoolean("otaBad", true).apply();
            } else p.edit().putInt("otaBoots", boots).apply();
        }
    }

    public static void otaOk(Context c) {
        SharedPreferences p = Store.prefs(c);
        if (p.getBoolean("otaTrial", false)) { p.edit().putBoolean("otaTrial", false).putInt("otaBoots", 0).apply(); Store.deleteTree(otaPrev(c)); }
    }

    /** The www file to serve for a request path like "www/app.js": downloaded bundle first, then the APK's assets. */
    public static File otaFile(Context c, String rel) {
        File f = new File(otaDir(c), rel);
        return f.isFile() ? f : null;
    }

    /* ---------- GitHub (5.2 / APK 22): güncellemeler önce GitHub'dan, olmazsa ailenin Firebase'inden ---------- */
    static final String GH = "https://raw.githubusercontent.com/departures-mil/aile-ajandasi/main/guncelleme/";

    static byte[] ghGet(String name) throws Exception {
        java.net.HttpURLConnection con = (java.net.HttpURLConnection) new java.net.URL(GH + name).openConnection();
        con.setConnectTimeout(20000);
        con.setReadTimeout(90000);
        con.setUseCaches(false);
        try {
            int st = con.getResponseCode();
            if (st != 200) throw new Exception("HTTP " + st);
            return Store.readAll(con.getInputStream());
        } finally { con.disconnect(); }
    }

    /** GitHub bildirgesi (yeniyse) ya da ailenin Firebase'indeki; "_gh" alanı kaynağı söyler. */
    static JSONObject upd(Context c) throws Exception {
        JSONObject g = null;
        try { g = new JSONObject(new String(ghGet("upd_latest.json?t=" + System.currentTimeMillis()), "UTF-8")); g.put("_gh", true); }
        catch (Exception ignored) { g = null; }
        JSONObject f = null;
        try { f = familyUpd(c); } catch (Exception e) { if (g == null) throw e; }
        if (g == null) return f;
        if (f != null && f.optInt("code", 0) > g.optInt("code", 0) && f.optInt("apkCode", 0) >= g.optInt("apkCode", 0)) return f;
        return g;
    }

    /* ---------- Firestore ---------- */

    static JSONObject familyUpd(Context c) throws Exception {
        JSONObject cfg = Store.syncConfig(c);
        String fid = cfg.optString("fid");
        if (fid.isEmpty() || !cfg.optBoolean("enabled")) throw new Exception("no family");
        String tok = Store.idToken(c);
        if (tok == null) throw new Exception(Store.lastError);
        Store.Resp r = Store.http("GET", Store.docsBase(c) + "/families/" + fid + "/photos/upd_latest", null, null, tok);
        if (r.status == 404) return new JSONObject();
        if (r.status != 200) throw new Exception("HTTP " + r.status);
        JSONObject fields = new JSONObject(r.body).optJSONObject("fields");
        String s = Store.plain(fields).optString("data", "");
        return s.isEmpty() ? new JSONObject() : new JSONObject(s);
    }

    static byte[] parts(Context c, String prefix, int n) throws Exception {
        String fid = Store.syncConfig(c).optString("fid");
        String tok = Store.idToken(c);
        if (tok == null) throw new Exception(Store.lastError);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            Store.Resp r = Store.http("GET", Store.docsBase(c) + "/families/" + fid + "/photos/" + prefix + "_" + i, null, null, tok);
            if (r.status != 200) throw new Exception("missing part " + i + " (HTTP " + r.status + ")");
            sb.append(new JSONObject(r.body).getJSONObject("fields").getJSONObject("data").getString("stringValue"));
        }
        return Base64.decode(sb.toString(), Base64.DEFAULT);
    }

    static String sha256(byte[] b) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : d) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    static boolean verify(byte[] data, String sigB64) throws Exception {
        PublicKey pk = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(Base64.decode(PUBKEY, Base64.DEFAULT)));
        Signature s = Signature.getInstance("SHA256withECDSA");
        s.initVerify(pk);
        s.update(data);
        return s.verify(Base64.decode(sigB64, Base64.DEFAULT));
    }

    /* ---------- bridge calls ---------- */

    public static String check(Context c) {
        try {
            JSONObject u = upd(c);
            int code = u.optInt("code", 0), apkCode = u.optInt("apkCode", 0);
            boolean needApk = apkCode > nativeCode(c);
            boolean available = needApk || code > wwwCode(c);
            String version = needApk ? u.optString("apkVersion", u.optString("version")) : u.optString("version");
            return new JSONObject().put("ok", true).put("available", available).put("needApk", needApk)
                .put("version", version).put("code", code).put("notes", u.optString("notes", ""))
                .put("current", wwwVersion(c)).put("size", needApk ? u.optInt("apkBytes", 0) : u.optInt("bytes", 0)).toString();
        } catch (Exception e) {
            return err(e);
        }
    }

    public static String apply(Context c) {
        try {
            JSONObject u = upd(c);
            int code = u.optInt("code", 0);
            if (code <= 0) throw new Exception("no update");
            byte[] gz = u.optBoolean("_gh") ? ghGet(u.getString("file")) : parts(c, "upd_b" + code, u.optInt("parts", 1));
            if (!sha256(gz).equals(u.optString("sha"))) throw new Exception("checksum");
            if (!verify(gz, u.optString("sig"))) throw new Exception("signature");
            byte[] raw = Store.readAll(new GZIPInputStream(new ByteArrayInputStream(gz)));
            JSONObject bundle = new JSONObject(new String(raw, "UTF-8"));
            JSONObject files = bundle.getJSONObject("files");
            File dir = otaNew(c);
            Store.deleteTree(dir);
            Iterator<String> it = files.keys();
            int n = 0;
            while (it.hasNext()) {
                String rel = it.next();
                if (rel.contains("..") || !rel.startsWith("www/")) continue;
                Store.writeText(new File(dir, rel), files.getString(rel));
                n++;
            }
            if (n == 0) throw new Exception("empty bundle");
            Store.writeText(new File(dir, "meta.json"), new JSONObject().put("code", bundle.optInt("code", code)).put("version", bundle.optString("version", u.optString("version"))).toString());
            return new JSONObject().put("ok", true).put("version", bundle.optString("version")).toString();
        } catch (Exception e) {
            Store.deleteTree(otaNew(c));
            return err(e);
        }
    }

    public static String apk(Context c) {
        try {
            JSONObject u = upd(c);
            int apkCode = u.optInt("apkCode", 0);
            if (apkCode <= nativeCode(c)) throw new Exception("no update");
            if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
                throw new Exception("install permission");
            }
            byte[] apk = u.optBoolean("_gh") && u.has("apkFile") ? ghGet(u.getString("apkFile")) : parts(c, "upd_apk" + apkCode, u.optInt("apkParts", 1));
            if (!sha256(apk).equals(u.optString("apkSha"))) throw new Exception("checksum");
            if (!verify(apk, u.optString("apkSig"))) throw new Exception("signature");
            File f = new File(c.getCacheDir(), "update.apk");
            Store.writeBytes(f, apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(FilesProvider.uri("update.apk"), "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            c.startActivity(i);
            return new JSONObject().put("ok", true).put("version", u.optString("apkVersion", u.optString("version"))).toString();
        } catch (Exception e) {
            return err(e);
        }
    }

    static String err(Exception e) {
        try { return new JSONObject().put("ok", false).put("error", String.valueOf(e.getMessage())).toString(); }
        catch (Exception x) { return "{\"ok\":false,\"error\":\"?\"}"; }
    }
}
