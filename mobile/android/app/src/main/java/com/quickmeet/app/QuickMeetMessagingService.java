package com.quickmeet.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * QuickMeetMessagingService — Handles incoming FCM push notifications
 * 
 * This service runs even when the app is killed/closed.
 * 
 * Notification types:
 * - "call"    → High-priority call notification with sound + vibration
 * - "message" → Standard message notification
 * 
 * When app is in foreground: forwards to JS via FirebaseMessagingPlugin
 * When app is in background/killed: shows system notification
 */
public class QuickMeetMessagingService extends FirebaseMessagingService {

    private static final String TAG = "QuickMeetFCM";

    // Notification channels (must match BackgroundService.java)
    private static final String CHANNEL_CALLS = "quickmeet_calls";
    private static final String CHANNEL_MESSAGES = "quickmeet_messages";

    // Notification IDs
    private static final int NOTIF_ID_CALL = 2001;
    private static final int NOTIF_ID_MESSAGE = 2002;
    private static int messageNotifCounter = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
    }

    /**
     * Called when FCM token is refreshed
     */
    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d(TAG, "FCM token refreshed: " + token.substring(0, Math.min(20, token.length())) + "...");
        
        // Notify the Capacitor plugin (if loaded) so JS can re-register
        FirebaseMessagingPlugin.onNewToken(token);
    }

    /**
     * Called when a push notification is received
     */
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Log.d(TAG, "FCM message received from: " + remoteMessage.getFrom());

        Map<String, String> data = remoteMessage.getData();
        String type = data.getOrDefault("type", "message");
        String title = "";
        String body = "";

        // Get title/body from notification payload or data payload
        if (remoteMessage.getNotification() != null) {
            title = remoteMessage.getNotification().getTitle();
            body = remoteMessage.getNotification().getBody();
        }
        if (title == null || title.isEmpty()) {
            title = data.getOrDefault("title", "Quick Meet");
        }
        if (body == null || body.isEmpty()) {
            body = data.getOrDefault("body", "");
        }

        // Forward to JS plugin (works only if app is in foreground with WebView loaded)
        JSObject jsData = new JSObject();
        for (Map.Entry<String, String> entry : data.entrySet()) {
            jsData.put(entry.getKey(), entry.getValue());
        }
        jsData.put("title", title);
        jsData.put("body", body);
        FirebaseMessagingPlugin.onMessageReceived(jsData);

        // Always show notification for calls (even in foreground)
        // For messages, show only if BackgroundService says we're in background
        // or if BackgroundService is not running (app killed)
        BackgroundService service = BackgroundService.getInstance();
        boolean isBackground = (service == null) || !isAppInForeground();

        if ("call".equals(type)) {
            showCallNotification(title, body, data);
        } else if (isBackground) {
            showMessageNotification(title, body, data);
        }
    }

    /**
     * Show a high-priority incoming call notification
     */
    private void showCallNotification(String title, String body, Map<String, String> data) {
        // Launch app intent
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("notification_type", "call");
        intent.putExtra("caller_id", data.getOrDefault("callerId", ""));
        intent.putExtra("caller_name", data.getOrDefault("callerName", ""));
        intent.putExtra("call_type", data.getOrDefault("callType", "audio"));

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true);

        // Answer action
        Intent answerIntent = new Intent(this, NotificationActionReceiver.class);
        answerIntent.setAction("com.quickmeet.ACTION_ANSWER_CALL");
        PendingIntent answerPending = PendingIntent.getBroadcast(
            this, 1, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.addAction(android.R.drawable.ic_menu_call, "Answer", answerPending);

        // Decline action
        Intent declineIntent = new Intent(this, NotificationActionReceiver.class);
        declineIntent.setAction("com.quickmeet.ACTION_DECLINE_CALL");
        PendingIntent declinePending = PendingIntent.getBroadcast(
            this, 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePending);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_ID_CALL, builder.build());
        }

        Log.d(TAG, "Call notification shown: " + title);
    }

    /**
     * Show a message notification
     */
    private void showMessageNotification(String title, String body, Map<String, String> data) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("notification_type", "message");
        intent.putExtra("sender_id", data.getOrDefault("senderId", ""));
        intent.putExtra("sender_name", data.getOrDefault("senderName", ""));

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 100 + messageNotifCounter, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_MESSAGES)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            // Use different ID for each message so they stack
            nm.notify(NOTIF_ID_MESSAGE + messageNotifCounter, builder.build());
            messageNotifCounter = (messageNotifCounter + 1) % 50;
        }

        Log.d(TAG, "Message notification shown: " + title + " — " + body);
    }

    /**
     * Create notification channels (Android 8+)
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // Calls channel — high importance with sound + vibrate
            NotificationChannel callChannel = new NotificationChannel(
                CHANNEL_CALLS, "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            );
            callChannel.setDescription("Incoming call notifications");
            callChannel.enableVibration(true);
            callChannel.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(callChannel);

            // Messages channel
            NotificationChannel msgChannel = new NotificationChannel(
                CHANNEL_MESSAGES, "Messages",
                NotificationManager.IMPORTANCE_HIGH
            );
            msgChannel.setDescription("New message notifications");
            msgChannel.enableVibration(true);
            nm.createNotificationChannel(msgChannel);
        }
    }

    /**
     * Check if app is in foreground
     */
    private boolean isAppInForeground() {
        try {
            android.app.ActivityManager am =
                (android.app.ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return false;

            java.util.List<android.app.ActivityManager.RunningAppProcessInfo> processes =
                am.getRunningAppProcesses();
            if (processes == null) return false;

            String packageName = getPackageName();
            for (android.app.ActivityManager.RunningAppProcessInfo process : processes) {
                if (process.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    && process.processName.equals(packageName)) {
                    return true;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error checking foreground state", e);
        }
        return false;
    }
}
