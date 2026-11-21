package com.ajandam.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Files, preferences, HTTP and the anonymous Firebase account. Same flow as the desktop app (main.js). */
public final class Store {
    private Store() {}

    public static final class Resp {
        public final int status;
        public final String body;
        Resp(int status, String body) { this.status = status; this.body = body == null ? "" : body; }
        public String json() {
            try { return new JSONObject().put("status", status).put("body", body).toString(); }
            catch (Exception e) { return "{\"status\":0,\"body\":\"\"}"; }
        }
    }

    /* ---------- files ---------- */

    public static File dataFile(Context c) { return new File(c.getFilesDir(), "data.json"); }
    public static File photoDir(Context c) { File f = new File(c.getFilesDir(), "photos"); if (!f.exists()) f.mkdirs(); return f; }
    public static File photoFile(Context c, String id) { return new File(photoDir(c), String.valueOf(id).replaceAll("[^A-Za-z0-9_-]", "") + ".jpg"); }

    public static String readText(File f) {
        if (f == null || !f.isFile()) return null;
        try (FileInputStream in = new FileInputStream(f)) { return new String(readAll(in), StandardCharsets.UTF_8); }
        catch (Exception e) { return null; }
    }

    public static void writeText(File f, String s) throws Exception {
        writeBytes(f, s.getBytes(StandardCharsets.UTF_8));
    }

    public static void writeBytes(File f, byte[] b) throws Exception {
        File dir = f.getParentFile();
        if (dir != null && !dir.exists()) dir.mkdirs();
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(b); out.getFD().sync(); }
        if (!tmp.renameTo(f)) {
            // Windows-style fallback: delete then rename
            f.delete();
            if (!tmp.renameTo(f)) throw new Exception("rename failed");
        }
    }

    public static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    public static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    /* ---------- prefs ---------- */

    public static SharedPreferences prefs(Context c) { return c.getSharedPreferences("prefs", Context.MODE_PRIVATE); }

    public static JSONObject syncConfig(Context c) {
        try { return new JSONObject(prefs(c).getString("sync", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    public static void setSyncConfig(Context c, String s) {
        JSONObject n;
        try { n = new JSONObject(s); } catch (Exception e) { return; }
        JSONObject o = syncConfig(c);
        SharedPreferences.Editor ed = prefs(c).edit();
        if (!n.optString("apiKey").equals(o.optString("apiKey")) || !n.optString("projectId").equals(o.optString("projectId"))) {
            ed.remove("uid").remove("refresh").remove("idToken").remove("idExp");
        }
        ed.putString("sync", n.toString()).apply();
    }

    public static String docsBase(Context c) {
        return "https://firestore.googleapis.com/v1/projects/" + syncConfig(c).optString("projectId") + "/databases/(default)/documents";
    }

    public static JSONObject data(Context c) {
        try { String s = readText(dataFile(c)); return s == null ? new JSONObject() : new JSONObject(s); }
        catch (Exception e) { return new JSONObject(); }
    }

    /* ---------- http ---------- */

    public static Resp http(String method, String url, String body, String contentType, String token) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(20000);
            con.setReadTimeout(60000);
            String m = method == null ? "GET" : method.toUpperCase();
            if (m.equals("PATCH")) { con.setRequestMethod("POST"); con.setRequestProperty("X-HTTP-Method-Override", "PATCH"); }
            else con.setRequestMethod(m);
            if (token != null && !token.isEmpty()) con.setRequestProperty("Authorization", "Bearer " + token);
            if (body != null && !body.isEmpty()) {
                byte[] b = body.getBytes(StandardCharsets.UTF_8);
                con.setRequestProperty("Content-Type", contentType == null ? "application/json; charset=utf-8" : contentType);
                con.setDoOutput(true);
                con.setFixedLengthStreamingMode(b.length);
                try (OutputStream out = con.getOutputStream()) { out.write(b); }
            }
            int status = con.getResponseCode();
            InputStream in = status >= 400 ? con.getErrorStream() : con.getInputStream();
            String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
            return new Resp(status, text);
        } catch (Exception e) {
            return new Resp(0, String.valueOf(e.getMessage()));
        } finally {
            if (con != null) con.disconnect();
        }
    }

    public static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    /* ---------- anonymous account ---------- */

    public static volatile String lastError = "";

    public static synchronized String ensureAccount(Context c) {
        SharedPreferences p = prefs(c);
        if (p.contains("uid") && p.contains("refresh")) return p.getString("uid", "");
        String key = syncConfig(c).optString("apiKey");
        if (key.isEmpty()) { lastError = "no apiKey"; return null; }
        Resp r = http("POST", "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + enc(key), "{\"returnSecureToken\":true}", null, null);
        if (r.status != 200) { lastError = r.body; return null; }
        try {
            JSONObject j = new JSONObject(r.body);
            long exp = System.currentTimeMillis() + (j.optLong("expiresIn", 3600) - 120) * 1000;
            p.edit().putString("uid", j.getString("localId")).putString("refresh", j.getString("refreshToken"))
                .putString("idToken", j.getString("idToken")).putLong("idExp", exp).apply();
            return j.getString("localId");
        } catch (Exception e) { lastError = String.valueOf(e.getMessage()); return null; }
    }

    public static synchronized String idToken(Context c) {
        if (ensureAccount(c) == null) return null;
        SharedPreferences p = prefs(c);
        String tok = p.getString("idToken", "");
        if (!tok.isEmpty() && p.getLong("idExp", 0) > System.currentTimeMillis()) return tok;
        String key = syncConfig(c).optString("apiKey");
        Resp r = http("POST", "https://securetoken.googleapis.com/v1/token?key=" + enc(key),
            "grant_type=refresh_token&refresh_token=" + enc(p.getString("refresh", "")), "application/x-www-form-urlencoded", null);
        if (r.status != 200) { lastError = r.body; return null; }
        try {
            JSONObject j = new JSONObject(r.body);
            long exp = System.currentTimeMillis() + (j.optLong("expires_in", 3600) - 120) * 1000;
            p.edit().putString("idToken", j.getString("id_token")).putString("refresh", j.getString("refresh_token")).putLong("idExp", exp).apply();
            return j.getString("id_token");
        } catch (Exception e) { lastError = String.valueOf(e.getMessage()); return null; }
    }

    /** All documents of a Firestore collection (paged). */
    public static List<JSONObject> listAll(Context c, String path, String token) throws Exception {
        List<JSONObject> out = new ArrayList<>();
        String tok = "";
        do {
            Resp r = http("GET", docsBase(c) + "/" + path + "?pageSize=300" + (tok.isEmpty() ? "" : "&pageToken=" + enc(tok)), null, null, token);
            if (r.status != 200) throw new Exception("HTTP " + r.status);
            JSONObject j = new JSONObject(r.body);
            JSONArray docs = j.optJSONArray("documents");
            if (docs != null) for (int i = 0; i < docs.length(); i++) out.add(docs.getJSONObject(i));
            tok = j.optString("nextPageToken", "");
        } while (!tok.isEmpty());
        return out;
    }

    /** Converts a Firestore "fields" object into plain JSON (strings, ints, bools, arrays, maps). */
    public static JSONObject plain(JSONObject fields) {
        JSONObject out = new JSONObject();
        if (fields == null) return out;
        java.util.Iterator<String> it = fields.keys();
        while (it.hasNext()) {
            String k = it.next();
            try { out.put(k, plainValue(fields.getJSONObject(k))); } catch (Exception ignored) {}
        }
        return out;
    }

    private static Object plainValue(JSONObject v) throws Exception {
        if (v.has("stringValue")) return v.getString("stringValue");
        if (v.has("integerValue")) return Long.parseLong(v.getString("integerValue"));
        if (v.has("doubleValue")) return v.getDouble("doubleValue");
        if (v.has("booleanValue")) return v.getBoolean("booleanValue");
        if (v.has("mapValue")) return plain(v.getJSONObject("mapValue").optJSONObject("fields"));
        if (v.has("arrayValue")) {
            JSONArray a = new JSONArray();
            JSONArray vals = v.getJSONObject("arrayValue").optJSONArray("values");
            if (vals != null) for (int i = 0; i < vals.length(); i++) a.put(plainValue(vals.getJSONObject(i)));
            return a;
        }
        return JSONObject.NULL;
    }
}
