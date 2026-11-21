package com.ajandam.app;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String INDEX = "https://" + HOST + "/www/index.html";
    static final int REQ_GALLERY = 11, REQ_CAMERA = 12, REQ_NOTIF = 21;

    WebView web;
    final Handler ui = new Handler(Looper.getMainLooper());
    String pendingDoc = "";
    String pickCb = null;
    Uri captureUri = null;
    boolean loaded = false;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Updater.promote(this);
        Notify.ensureChannels(this);
        SyncJob.schedule(this);
        pendingDoc = getIntent() != null && getIntent().hasExtra("docId") ? getIntent().getStringExtra("docId") : "";

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setBackgroundColor(Color.parseColor("#F4F5F2"));
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return serve(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                loaded = true;
            }
        });
        setContentView(web);
        web.loadUrl(INDEX);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
        }
        new Thread(() -> Alarms.reschedule(this)).start();
    }

    /* ---------- serving www + photos ---------- */

    WebResourceResponse serve(String path) {
        if (path == null) return null;
        try {
            if (path.startsWith("/www/")) {
                String rel = path.substring(1);
                if (rel.contains("..")) return null;
                File ota = Updater.otaFile(this, rel);
                InputStream in = ota != null ? new FileInputStream(ota) : getAssets().open(rel);
                return new WebResourceResponse(mime(rel), "utf-8", in);
            }
            if (path.startsWith("/photos/")) {
                String name = path.substring(8);
                File f = Store.photoFile(this, name.endsWith(".jpg") ? name.substring(0, name.length() - 4) : name);
                if (!f.isFile()) return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, new ByteArrayInputStream(new byte[0]));
                return new WebResourceResponse("image/jpeg", null, new FileInputStream(f));
            }
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, new ByteArrayInputStream(new byte[0]));
        }
        return null;
    }

    static String mime(String n) {
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg")) return "image/jpeg";
        if (n.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    /* ---------- lifecycle ---------- */

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.hasExtra("docId")) openDoc(intent.getStringExtra("docId"));
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (loaded) js("window.onResumeApp && window.onResumeApp()");
    }

    @Override
    protected void onPause() {
        super.onPause();
        new Thread(() -> Alarms.reschedule(this)).start();
    }

    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("window.onBack ? window.onBack() : false", v -> {
            if (v == null || "false".equals(v) || "null".equals(v)) moveTaskToBack(true);
        });
    }

    void openDoc(String id) {
        if (id == null || id.isEmpty()) return;
        if (loaded) js("window.openDoc && window.openDoc(" + JSONObject.quote(id) + ")");
        else pendingDoc = id;
    }

    void js(String code) { ui.post(() -> { if (web != null) web.evaluateJavascript(code, null); }); }

    void callback(String cb, String json) { js("window.__cb(" + JSONObject.quote(cb) + "," + JSONObject.quote(json) + ")"); }

    /* ---------- photos ---------- */

    void startPick(String cb, String src) {
        pickCb = cb;
        try {
            if ("camera".equals(src)) {
                File f = new File(getCacheDir(), "capture.jpg");
                try { new FileOutputStream(f).close(); } catch (Exception ignored) {}
                captureUri = FilesProvider.uri("capture.jpg");
                Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                i.putExtra(MediaStore.EXTRA_OUTPUT, captureUri);
                i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivityForResult(i, REQ_CAMERA);
            } else {
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.setType("image/*");
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(i, ""), REQ_GALLERY);
            }
        } catch (Exception e) {
            pickCb = null;
            callback(cb, "[]");
        }
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_GALLERY && req != REQ_CAMERA) return;
        final String cb = pickCb;
        pickCb = null;
        if (cb == null) return;
        final List<Uri> uris = new ArrayList<>();
        if (result == RESULT_OK) {
            if (req == REQ_CAMERA) { if (captureUri != null) uris.add(captureUri); }
            else if (data != null) {
                ClipData cd = data.getClipData();
                if (cd != null) for (int i = 0; i < cd.getItemCount(); i++) uris.add(cd.getItemAt(i).getUri());
                else if (data.getData() != null) uris.add(data.getData());
            }
        }
        new Thread(() -> {
            JSONArray ids = new JSONArray();
            for (Uri u : uris) {
                try { String id = importPhoto(u); if (id != null) ids.put(id); } catch (Exception ignored) {}
            }
            callback(cb, ids.toString());
        }).start();
    }

    String importPhoto(Uri u) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = getContentResolver().openInputStream(u)) { BitmapFactory.decodeStream(in, null, o); }
        int max = Math.max(o.outWidth, o.outHeight);
        if (max <= 0) return null;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = 1;
        while (max / o2.inSampleSize > 2560) o2.inSampleSize *= 2;
        Bitmap bm;
        try (InputStream in = getContentResolver().openInputStream(u)) { bm = BitmapFactory.decodeStream(in, null, o2); }
        if (bm == null) return null;
        int rot = 0;
        try (InputStream in = getContentResolver().openInputStream(u)) {
            int or = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
            rot = or == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : or == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : or == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
        } catch (Exception ignored) {}
        float scale = Math.min(1f, 1280f / Math.max(bm.getWidth(), bm.getHeight()));
        if (scale < 1f || rot != 0) {
            Matrix m = new Matrix();
            if (scale < 1f) m.postScale(scale, scale);
            if (rot != 0) m.postRotate(rot);
            bm = Bitmap.createBitmap(bm, 0, 0, bm.getWidth(), bm.getHeight(), m, true);
        }
        String id = "p" + Long.toString(System.currentTimeMillis(), 36) + Long.toString((long) (Math.random() * 1e9), 36);
        try (FileOutputStream out = new FileOutputStream(Store.photoFile(this, id))) { bm.compress(Bitmap.CompressFormat.JPEG, 72, out); }
        return id;
    }

    /* ---------- bridge ---------- */

    class Bridge {
        void bg(Runnable r) { new Thread(r).start(); }

        @JavascriptInterface public String load() { String s = Store.readText(Store.dataFile(MainActivity.this)); return s == null ? "" : s; }

        @JavascriptInterface public boolean save(String s) {
            try { Store.writeText(Store.dataFile(MainActivity.this), s); } catch (Exception e) { return false; }
            bg(() -> Alarms.reschedule(MainActivity.this));
            return true;
        }

        @JavascriptInterface public String photoUrl(String id) {
            return Store.photoFile(MainActivity.this, id).isFile() ? "https://" + HOST + "/photos/" + id + ".jpg" : "";
        }

        @JavascriptInterface public boolean deletePhotoLocal(String id) { Store.photoFile(MainActivity.this, id).delete(); return true; }

        @JavascriptInterface public void pickPhoto(String cb, String src) { ui.post(() -> startPick(cb, src)); }

        @JavascriptInterface public void http(String cb, String method, String url, String body, boolean auth) {
            bg(() -> {
                String tok = null;
                if (auth) { tok = Store.idToken(MainActivity.this); if (tok == null) { callback(cb, new Store.Resp(-1, Store.lastError).json()); return; } }
                callback(cb, Store.http(method, url, body, null, tok).json());
            });
        }

        @JavascriptInterface public void httpTok(String cb, String method, String url, String body, String token) {
            bg(() -> callback(cb, Store.http(method, url, body, null, token).json()));
        }

        @JavascriptInterface public void signIn(String cb) {
            bg(() -> { String uid = Store.ensureAccount(MainActivity.this); callback(cb, uid != null ? new Store.Resp(200, uid).json() : new Store.Resp(-1, Store.lastError).json()); });
        }

        @JavascriptInterface public void uploadPhoto(String cb, String id, String fid) {
            bg(() -> {
                File f = Store.photoFile(MainActivity.this, id);
                if (!f.isFile()) { callback(cb, new Store.Resp(404, "missing").json()); return; }
                String tok = Store.idToken(MainActivity.this);
                if (tok == null) { callback(cb, new Store.Resp(-1, Store.lastError).json()); return; }
                try {
                    byte[] b = Store.readAll(new FileInputStream(f));
                    String name = "projects/" + Store.syncConfig(MainActivity.this).optString("projectId") + "/databases/(default)/documents/families/" + fid + "/photos/" + id;
                    JSONObject body = new JSONObject().put("writes", new JSONArray().put(new JSONObject().put("update", new JSONObject().put("name", name)
                        .put("fields", new JSONObject().put("data", new JSONObject().put("stringValue", android.util.Base64.encodeToString(b, android.util.Base64.NO_WRAP)))))));
                    Store.Resp r = Store.http("POST", Store.docsBase(MainActivity.this) + ":commit", body.toString(), null, tok);
                    callback(cb, new Store.Resp(r.status, r.status == 200 ? "" : r.body).json());
                } catch (Exception e) { callback(cb, new Store.Resp(0, String.valueOf(e.getMessage())).json()); }
            });
        }

        @JavascriptInterface public void downloadPhoto(String cb, String id, String fid) {
            bg(() -> {
                String tok = Store.idToken(MainActivity.this);
                if (tok == null) { callback(cb, new Store.Resp(-1, Store.lastError).json()); return; }
                Store.Resp r = Store.http("GET", Store.docsBase(MainActivity.this) + "/families/" + fid + "/photos/" + id, null, null, tok);
                if (r.status == 200) {
                    try {
                        String b64 = new JSONObject(r.body).getJSONObject("fields").getJSONObject("data").getString("stringValue");
                        Store.writeBytes(Store.photoFile(MainActivity.this, id), android.util.Base64.decode(b64, android.util.Base64.DEFAULT));
                    } catch (Exception ignored) {}
                }
                callback(cb, new Store.Resp(r.status, "").json());
            });
        }

        @JavascriptInterface public String getSync() { return Store.prefs(MainActivity.this).getString("sync", "{}"); }
        @JavascriptInterface public boolean setSync(String s) { Store.setSyncConfig(MainActivity.this, s); return true; }
        @JavascriptInterface public String uid() { return Store.prefs(MainActivity.this).getString("uid", ""); }
        @JavascriptInterface public boolean setLang(String l) { Store.prefs(MainActivity.this).edit().putString("lang", l).apply(); return true; }
        @JavascriptInterface public String deviceLang() { return Locale.getDefault().getLanguage(); }
        @JavascriptInterface public String takeOpenDoc() { String d = pendingDoc; pendingDoc = ""; return d == null ? "" : d; }

        @JavascriptInterface public void share(String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text);
            ui.post(() -> { try { startActivity(Intent.createChooser(i, "")); } catch (Exception ignored) {} });
        }

        @JavascriptInterface public void openMap(String q) {
            ui.post(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(q)))); }
                catch (Exception e) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=" + Uri.encode(q)))); }
                    catch (Exception x) { toast("Map app not found"); }
                }
            });
        }

        @JavascriptInterface public void dial(String p) {
            ui.post(() -> { try { startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(p)))); } catch (Exception ignored) {} });
        }

        @JavascriptInterface public boolean copy(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("text", text));
            return true;
        }

        @JavascriptInterface public String paste() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                ClipData cd = cm.getPrimaryClip();
                if (cd == null || cd.getItemCount() == 0) return "";
                CharSequence t = cd.getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface public void toast(String s) { ui.post(() -> Toast.makeText(MainActivity.this, s, Toast.LENGTH_SHORT).show()); }

        @JavascriptInterface public void setBarColor(String hex) {
            ui.post(() -> {
                try { int c = Color.parseColor(hex); getWindow().setStatusBarColor(c); getWindow().setNavigationBarColor(c); } catch (Exception ignored) {}
            });
        }

        @JavascriptInterface public String version() { return Updater.wwwVersion(MainActivity.this); }

        @JavascriptInterface public boolean notifyNow(String title, String body, String docId) {
            Notify.show(MainActivity.this, Notify.CH_FAMILY, title, body, docId);
            return true;
        }

        @JavascriptInterface public void checkNotify() {
            bg(() -> { JSONObject docs = Store.data(MainActivity.this).optJSONObject("docs"); if (docs != null) FamilyNotify.run(MainActivity.this, docs); });
        }

        /* updates */
        @JavascriptInterface public void updateCheck(String cb, String apiKey, String projectId) { bg(() -> callback(cb, Updater.check(MainActivity.this))); }
        @JavascriptInterface public void updateApply(String cb, String apiKey, String projectId) { bg(() -> callback(cb, Updater.apply(MainActivity.this))); }
        @JavascriptInterface public void updateApk(String cb, String apiKey, String projectId) { bg(() -> callback(cb, Updater.apk(MainActivity.this))); }
        @JavascriptInterface public boolean otaOk() { Updater.otaOk(MainActivity.this); return true; }

        @JavascriptInterface public boolean restartApp() {
            Updater.promote(MainActivity.this);
            ui.post(() -> { loaded = false; web.loadUrl(INDEX); });
            return true;
        }
    }
}
