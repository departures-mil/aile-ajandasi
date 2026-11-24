package com.ajandam.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import com.departuresmil.ortak.FcDelta;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Ortak çekirdeğin Android köprüsü (window.AndroidBridge; web/js/host.js kendiliğinden tanır).
 *   moveTaskToBack · openExternal · appVersion · notify (Asistan Agent)
 *   updateBegin(kind 'patch'|'full', metaJson) · updateChunk(base64) · updateFinish() → {"ok":true} | {"ok":false,"error":"…"}
 * Yama: kurulu APK (applicationInfo.sourceDir) + FCD1 yama → yeni APK; SHA-256 meta.targetSha256 ile doğrulanır,
 * sonra paket yükleyici açılır (aynı imza: veriler kalır). Tam dosya: gelen APK doğrulanıp aynı yoldan kurulur.
 * Ayrıca GitHub Releases indirmeleri WebView'den (CORS'suz) yerel olarak yapılır: ghProxy().
 */
final class FcBridge {
    private final Activity act;
    private File incoming;
    private FileOutputStream out;
    private String kind = "full";
    private JSONObject meta = new JSONObject();

    FcBridge(Activity a) { act = a; }

    static File dir(Activity a) { File d = new File(a.getCacheDir(), "fc-update"); d.mkdirs(); return d; }

    /** Açılışta eski güncelleme dosyalarını temizler. */
    static void cleanup(Activity a) {
        File[] fs = dir(a).listFiles();
        if (fs != null) for (File f : fs) f.delete();
        new File(a.getCacheDir(), "update.apk").delete();
    }

    @JavascriptInterface public void moveTaskToBack() { act.runOnUiThread(() -> act.moveTaskToBack(true)); }

    @JavascriptInterface public void openExternal(String url) {
        if (url == null || !url.startsWith("https://")) return;
        act.runOnUiThread(() -> { try { act.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {} });
    }

    @JavascriptInterface public String appVersion() {
        try { return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    @JavascriptInterface public void notify(String title, String body) {
        try { Notify.show(act, Notify.CH_FAMILY, title, body, ""); } catch (Exception ignored) {}
    }

    @JavascriptInterface public synchronized boolean updateBegin(String k, String metaJson) {
        try {
            close();
            if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i);
                return false;
            }
            kind = "patch".equals(k) ? "patch" : "full";
            meta = new JSONObject(metaJson == null ? "{}" : metaJson);
            incoming = new File(dir(act), kind + ".bin");
            out = new FileOutputStream(incoming);
            return true;
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface public synchronized boolean updateChunk(String b64) {
        try { out.write(Base64.decode(b64, Base64.DEFAULT)); return true; } catch (Exception e) { return false; }
    }

    @JavascriptInterface public synchronized String updateFinish() {
        try {
            close();
            File apk = new File(act.getCacheDir(), "update.apk");
            apk.delete();
            if ("patch".equals(kind)) {
                ApplicationInfo ai = act.getApplicationInfo();
                if (ai.sourceDir == null || (Build.VERSION.SDK_INT >= 21 && ai.splitSourceDirs != null && ai.splitSourceDirs.length > 0)) throw new Exception("NO_PATCH_SOURCE");
                FcDelta.apply(new File(ai.sourceDir), incoming, apk, null);
            } else if (!incoming.renameTo(apk)) throw new Exception("MOVE_FAILED");
            String want = meta.optString("targetSha256", "").toLowerCase();
            if (!want.isEmpty() && !FcDelta.hex(FcDelta.sha256(apk)).equals(want)) { apk.delete(); throw new Exception("BAD_HASH"); }
            incoming.delete();
            act.runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(FilesProvider.uri("update.apk"), "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { act.startActivity(i); } catch (Exception ignored) {}
            });
            return "{\"ok\":true}";
        } catch (Exception e) {
            if (incoming != null) incoming.delete();
            try { return new JSONObject().put("ok", false).put("error", String.valueOf(e.getMessage())).toString(); } catch (Exception x) { return "{\"ok\":false,\"error\":\"FAILED\"}"; }
        }
    }

    private void close() { try { if (out != null) out.close(); } catch (Exception ignored) {} out = null; }

    /* ---------- GitHub Releases indirmeleri (latest.json, yama, APK) ----------
       Sayfa https://appassets.androidplatform.net'ten açılır; github.com yönlendirmesi CORS başlığı vermediği için fetch
       başarısız olur. Bu adreslere giden GET istekleri burada yerel olarak yapılır ve CORS izniyle sayfaya verilir. */
    static boolean isGitHub(Uri u) {
        String h = u.getHost();
        return "https".equals(u.getScheme()) && h != null && (h.equals("github.com") || h.equals("objects.githubusercontent.com") || h.equals("release-assets.githubusercontent.com"))
            && (u.getPath() == null || u.getPath().startsWith("/departures-mil/") || !h.equals("github.com"));
    }

    static WebResourceResponse ghProxy(WebResourceRequest req) {
        if (!"GET".equalsIgnoreCase(req.getMethod()) || !isGitHub(req.getUrl())) return null;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(req.getUrl().toString()).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setUseCaches(false);
            int st = c.getResponseCode();
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-store");
            long len = c.getContentLengthLong();
            if (len >= 0) h.put("Content-Length", String.valueOf(len));
            InputStream in = st >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) in = new ByteArrayInputStream(new byte[0]);
            String type = c.getContentType() == null ? "application/octet-stream" : c.getContentType().split(";")[0];
            String reason = c.getResponseMessage() == null || c.getResponseMessage().isEmpty() ? (st == 200 ? "OK" : "Error") : c.getResponseMessage();
            return new WebResourceResponse(type, null, st, reason, h, in);
        } catch (Exception e) {
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse("text/plain", "utf-8", 502, "Bad Gateway", h, new ByteArrayInputStream(new byte[0]));
        }
    }
}
