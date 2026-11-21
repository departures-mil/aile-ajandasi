package com.ajandam.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/** Exact reminders from the saved data (docs[].al.t, texts preferably from alx in this phone's language). */
public final class Alarms {
    private Alarms() {}

    public static final String ACTION = "com.ajandam.app.REMIND.";
    private static final int MAX = 60;

    static final class Entry {
        final String key; final long t; final String doc; final String title; final String body;
        Entry(String key, long t, String doc, String title, String body) { this.key = key; this.t = t; this.doc = doc; this.title = title; this.body = body; }
    }

    /** Entries from one data/doc map: docs {id: doc} plus optional alx {id: {ti,b}}. */
    static List<Entry> entries(JSONObject docs, JSONObject alx, boolean onlyMine, String me) {
        List<Entry> out = new ArrayList<>();
        if (docs == null) return out;
        Iterator<String> it = docs.keys();
        while (it.hasNext()) {
            String id = it.next();
            JSONObject d = docs.optJSONObject(id);
            if (d == null || d.optBoolean("del") || d.optBoolean("done")) continue;
            JSONObject al = d.optJSONObject("al");
            if (al == null) continue;
            JSONArray t = al.optJSONArray("t");
            if (t == null) continue;
            if (onlyMine && !me.isEmpty() && !me.equals(d.optString("by")) && !me.equals(d.optString("for"))) continue;
            JSONObject lx = alx != null && alx.optJSONObject(id) != null ? alx.optJSONObject(id) : al;
            for (int i = 0; i < t.length(); i++) {
                long ms = t.optLong(i, 0);
                if (ms <= 0) continue;
                out.add(new Entry(id + ":" + ms, ms, id, lx.optString("ti", al.optString("ti")), lx.optString("b", al.optString("b"))));
            }
        }
        return out;
    }

    public static synchronized void reschedule(Context c) { reschedule(c, null); }

    /** Reschedules everything; extraDocs (from a background pull) are merged with the local data. */
    public static synchronized void reschedule(Context c, JSONObject extraDocs) {
        JSONObject data = Store.data(c);
        JSONObject settings = data.optJSONObject("settings");
        boolean onlyMine = settings != null && settings.optBoolean("onlyMine");
        String me = data.optJSONObject("me") != null ? data.optJSONObject("me").optString("id") : "";
        List<Entry> all = entries(data.optJSONObject("docs"), data.optJSONObject("alx"), onlyMine, me);
        Set<String> have = new HashSet<>();
        for (Entry e : all) have.add(e.key);
        if (extraDocs != null) for (Entry e : entries(extraDocs, data.optJSONObject("alx"), onlyMine, me)) if (!have.contains(e.key)) { all.add(e); have.add(e.key); }

        long now = System.currentTimeMillis();
        SharedPreferences p = Store.prefs(c);
        Set<String> fired = new HashSet<>(p.getStringSet("fired", new HashSet<>()));
        Set<String> old = new HashSet<>(p.getStringSet("alarmKeys", new HashSet<>()));
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);

        // fire the ones that are a little late (phone was off), drop the rest of the past
        List<Entry> future = new ArrayList<>();
        for (Entry e : all) {
            if (e.t > now) future.add(e);
            else if (e.t > now - 30 * 60000 && !fired.contains(e.key)) {
                fired.add(e.key);
                Notify.show(c, Notify.CH_REMIND, e.title, e.body, e.doc);
            }
        }
        Collections.sort(future, (a, b) -> Long.compare(a.t, b.t));
        if (future.size() > MAX) future = future.subList(0, MAX);

        Set<String> keep = new HashSet<>();
        for (Entry e : future) {
            keep.add(e.key);
            PendingIntent pi = pending(c, e.key, e.doc, e.title, e.body);
            try {
                if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, e.t, pi);
                else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, e.t, pi);
            } catch (SecurityException se) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, e.t, pi);
            }
        }
        for (String k : old) if (!keep.contains(k)) {
            try { am.cancel(pending(c, k, "", "", "")); } catch (Exception ignored) {}
        }
        // forget fired keys older than two days
        Set<String> fired2 = new HashSet<>();
        for (String k : fired) { try { if (Long.parseLong(k.substring(k.lastIndexOf(':') + 1)) > now - 2 * 86400000L) fired2.add(k); } catch (Exception ignored) {} }
        p.edit().putStringSet("alarmKeys", keep).putStringSet("fired", fired2).apply();
    }

    static PendingIntent pending(Context c, String key, String doc, String title, String body) {
        Intent i = new Intent(c, AlarmReceiver.class);
        i.setAction(ACTION + key);
        i.putExtra("key", key).putExtra("doc", doc).putExtra("title", title).putExtra("body", body);
        return PendingIntent.getBroadcast(c, key.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void markFired(Context c, String key) {
        SharedPreferences p = Store.prefs(c);
        Set<String> fired = new HashSet<>(p.getStringSet("fired", new HashSet<>()));
        fired.add(key);
        p.edit().putStringSet("fired", fired).apply();
    }
}
