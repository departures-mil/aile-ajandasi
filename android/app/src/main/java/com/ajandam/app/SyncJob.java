package com.ajandam.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

import org.json.JSONObject;

import java.util.List;

/** Background pull (about hourly): reminders and "for you" notifications for items others added while the app was closed. */
public class SyncJob extends JobService {
    static final int JOB_ID = 1001;

    public static void schedule(Context c) {
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == JOB_ID) return;
            JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(c, SyncJob.class))
                .setPeriodic(60 * 60 * 1000L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build();
            js.schedule(info);
        } catch (Exception ignored) {}
    }

    /** Pulls all family docs; returns {id: doc} or null. */
    public static JSONObject pull(Context c) {
        try {
            JSONObject cfg = Store.syncConfig(c);
            if (!cfg.optBoolean("enabled") || cfg.optString("fid").isEmpty()) return null;
            String tok = Store.idToken(c);
            if (tok == null) return null;
            List<JSONObject> remote = Store.listAll(c, "families/" + cfg.optString("fid") + "/docs", tok);
            JSONObject docs = new JSONObject();
            for (JSONObject x : remote) {
                try {
                    String name = x.getString("name");
                    String id = name.substring(name.lastIndexOf('/') + 1);
                    JSONObject f = x.getJSONObject("fields");
                    docs.put(id, new JSONObject(f.getJSONObject("json").getString("stringValue")));
                } catch (Exception ignored) {}
            }
            return docs;
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try {
                JSONObject docs = pull(this);
                if (docs != null) {
                    FamilyNotify.run(this, docs);
                    Alarms.reschedule(this, docs);
                } else {
                    Alarms.reschedule(this);
                }
            } catch (Exception ignored) {}
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }
}
