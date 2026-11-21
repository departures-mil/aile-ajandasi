package com.ajandam.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        final PendingResult pr = goAsync();
        final Context app = c.getApplicationContext();
        new Thread(() -> {
            try {
                Alarms.reschedule(app);
                SyncJob.schedule(app);
            } catch (Exception ignored) {}
            pr.finish();
        }).start();
    }
}
