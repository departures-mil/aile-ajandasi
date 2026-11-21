package com.ajandam.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.DateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;

/**
 * "{name} added this for you" notifications, same rules as checkNotify() in app.js:
 * items for my person in this phone's language; on an admin phone everything others added, in Turkish.
 * The seen-map lives in prefs so the foreground (local data) and background (remote pull) runs never repeat each other.
 */
public final class FamilyNotify {
    private FamilyNotify() {}

    static String forYou(String lang) { return "ar".equals(lang) ? "أضاف {name} هذا لك" : "en".equals(lang) ? "{name} added this for you" : "{name} sizin için ekledi"; }
    static String added(String lang) { return "ar".equals(lang) ? "أضاف {name} شيئاً جديداً" : "en".equals(lang) ? "{name} added something new" : "{name} yeni bir şey ekledi"; }
    static String someone(String lang) { return "ar".equals(lang) ? "شخص ما" : "en".equals(lang) ? "Someone" : "Biri"; }
    static String icon(String kind, String sub) {
        if ("appt".equals(kind)) return "hospital".equals(sub) ? "🏥" : "🩺";
        if ("visit".equals(kind)) return "🏠";
        if ("shop".equals(kind)) return "🛒";
        if ("task".equals(kind)) return "✅";
        return "";
    }

    /** docs: {id: doc}. Uses settings/me/sync from the local data file. */
    public static synchronized void run(Context c, JSONObject docs) {
        if (docs == null) return;
        JSONObject data = Store.data(c);
        JSONObject sync = data.optJSONObject("sync");
        if (sync == null || !sync.optBoolean("enabled")) return;
        JSONObject settings = data.optJSONObject("settings") != null ? data.optJSONObject("settings") : new JSONObject();
        JSONObject meObj = data.optJSONObject("me") != null ? data.optJSONObject("me") : new JSONObject();
        JSONObject tx = data.optJSONObject("tx") != null ? data.optJSONObject("tx") : new JSONObject();
        String lang = settings.optString("lang", "tr");
        if (lang.isEmpty()) lang = "tr";
        String meId = meObj.optString("id");
        String uid = Store.prefs(c).getString("uid", sync.optString("uid"));
        boolean admin = !uid.isEmpty() && (uid.equals(sync.optString("adminUid")) || contains(sync.optJSONArray("admins"), uid));
        String me = myPerson(docs, data.optJSONObject("docs"), settings, meObj.optString("name"));

        SharedPreferences p = Store.prefs(c);
        boolean init = p.getBoolean("ntfInit", false);
        JSONObject seen;
        try { seen = new JSONObject(p.getString("ntfSeen", "{}")); } catch (Exception e) { seen = new JSONObject(); }
        JSONObject next = new JSONObject();

        Iterator<String> it = docs.keys();
        while (it.hasNext()) {
            String id = it.next();
            JSONObject d = docs.optJSONObject(id);
            if (d == null || "lst".equals(d.optString("kind")) || d.optBoolean("del")) continue;
            String forv = d.optString("for", "");
            boolean had = seen.has(id);
            String prev = seen.optString(id, "");
            try { next.put(id, forv); } catch (Exception ignored) {}
            if (!init || d.optBoolean("done")) continue;
            String editor = d.has("ubid") ? d.optString("ubid") : d.optString("by");
            if (editor.equals(meId)) continue;
            boolean forMe = !me.isEmpty() && forv.equals(me);
            if (!had) {
                if (forMe) Notify.show(c, Notify.CH_FAMILY, fmt(forYou(lang), d, lang, tx), body(d, docs, lang, tx), id);
                else if (admin && !d.optString("by").equals(meId)) Notify.show(c, Notify.CH_FAMILY, fmt(added("tr"), d, "tr", tx), body(d, docs, "tr", tx), id);
            } else if (forMe && !prev.equals(forv)) {
                Notify.show(c, Notify.CH_FAMILY, fmt(forYou(lang), d, lang, tx), body(d, docs, lang, tx), id);
            }
        }
        p.edit().putString("ntfSeen", next.toString()).putBoolean("ntfInit", true).apply();
    }

    static boolean contains(JSONArray a, String s) {
        if (a == null) return false;
        for (int i = 0; i < a.length(); i++) if (s.equals(a.optString(i))) return true;
        return false;
    }

    static String inLang(JSONObject tx, String text, String lang) {
        String v = tx.optString(lang + "|" + text, "");
        return v.isEmpty() ? text : v;
    }

    static String fmt(String pattern, JSONObject d, String lang, JSONObject tx) {
        String by = d.optString("byName", "");
        if (by.isEmpty()) by = d.optString("uby", "");
        return pattern.replace("{name}", by.isEmpty() ? someone(lang) : inLang(tx, by, lang));
    }

    static String body(JSONObject d, JSONObject docs, String lang, JSONObject tx) {
        String title = d.optString("title", "");
        if (!title.isEmpty()) title = inLang(tx, title, lang);
        else {
            StringBuilder sb = new StringBuilder();
            for (String k : new String[]{"doctor", "place"}) {
                JSONObject l = docs.optJSONObject(d.optString(k, ""));
                if (l != null && !l.optString("name").isEmpty()) { if (sb.length() > 0) sb.append(" · "); sb.append(inLang(tx, l.optString("name"), lang)); }
            }
            title = sb.toString();
        }
        String s = icon(d.optString("kind"), d.optString("sub")) + " " + title;
        long when = d.optLong("when", 0);
        if (when > 0) {
            Locale loc = "ar".equals(lang) ? new Locale("ar") : "en".equals(lang) ? Locale.UK : new Locale("tr", "TR");
            s += "\n" + DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, loc).format(new Date(when));
        }
        return s;
    }

    /** settings.person, else the person list item named like me. */
    static String myPerson(JSONObject docs, JSONObject localDocs, JSONObject settings, String myName) {
        String pid = settings.optString("person", "");
        if (!pid.isEmpty() && (docs.has(pid) || (localDocs != null && localDocs.has(pid)))) return pid;
        String me = myName == null ? "" : myName.trim().toLowerCase(new Locale("tr", "TR"));
        if (me.isEmpty()) return "";
        for (JSONObject src : new JSONObject[]{docs, localDocs}) {
            if (src == null) continue;
            Iterator<String> it = src.keys();
            while (it.hasNext()) {
                String id = it.next();
                JSONObject d = src.optJSONObject(id);
                if (d != null && "lst".equals(d.optString("kind")) && "person".equals(d.optString("list"))
                    && d.optString("name", "").trim().toLowerCase(new Locale("tr", "TR")).equals(me)) return id;
            }
        }
        return "";
    }
}
