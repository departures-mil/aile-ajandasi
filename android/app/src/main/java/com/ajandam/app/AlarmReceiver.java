package com.ajandam.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        String key = i.getStringExtra("key");
        String doc = i.getStringExtra("doc");
        // Skip if the item was completed or deleted since the alarm was set.
        if (doc != null && !doc.isEmpty()) {
            org.json.JSONObject docs = Store.data(c).optJSONObject("docs");
            org.json.JSONObject d = docs != null ? docs.optJSONObject(doc) : null;
            if (d != null && (d.optBoolean("done") || d.optBoolean("del"))) return;
        }
        if (key != null) Alarms.markFired(c, key);
        Notify.show(c, Notify.CH_REMIND, i.getStringExtra("title"), i.getStringExtra("body"), doc);
    }
}
