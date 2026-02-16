package com.quickmeet.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Boot Receiver for Quick Meet
 * 
 * Automatically starts the foreground service when the device boots up,
 * so the user stays connected for calls & messages without manually
 * opening the app (like Messenger/WhatsApp behavior).
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "QM-BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {

            Log.i(TAG, "Boot/package event received: " + action);

            try {
                Intent serviceIntent = new Intent(context, BackgroundService.class);
                serviceIntent.putExtra("title", "Quick Meet");
                serviceIntent.putExtra("body", "Connected — waiting for calls & messages");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
                Log.i(TAG, "Background service started from boot");
            } catch (Exception e) {
                Log.e(TAG, "Failed to start service from boot: " + e.getMessage());
            }
        }
    }
}
