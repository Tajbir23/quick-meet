package com.quickmeet.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Foreground Service for Quick Meet
 * 
 * Keeps the app alive in background so that:
 * - Socket.io connection stays active (incoming calls, messages)
 * - File transfers continue when app is backgrounded
 * - WebView JS execution is not suspended by Android
 * 
 * Shows a persistent notification in the notification bar.
 */
public class BackgroundService extends Service {
    private static final String TAG = "QM-BackgroundService";
    
    // Notification channels
    public static final String CHANNEL_BG = "quickmeet_background";
    public static final String CHANNEL_CALL = "quickmeet_calls";
    public static final String CHANNEL_TRANSFER = "quickmeet_transfer";
    
    // Notification IDs
    public static final int NOTIFICATION_BG = 1001;
    public static final int NOTIFICATION_CALL = 1002;
    public static final int NOTIFICATION_TRANSFER = 1003;
    
    private PowerManager.WakeLock wakeLock;
    private static BackgroundService instance;
    private NotificationManager notificationManager;
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        createNotificationChannels();
        acquireWakeLock();
        Log.i(TAG, "BackgroundService created");
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = "Quick Meet";
        String body = "Connected — waiting for calls & messages";
        
        if (intent != null) {
            String t = intent.getStringExtra("title");
            String b = intent.getStringExtra("body");
            if (t != null) title = t;
            if (b != null) body = b;
        }
        
        Notification notification = buildBackgroundNotification(title, body);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ requires foreground service type
            startForeground(NOTIFICATION_BG, notification, 
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_BG, notification);
        }
        
        Log.i(TAG, "BackgroundService started foreground");
        return START_STICKY;
    }
    
    /**
     * Build the persistent background notification
     */
    private Notification buildBackgroundNotification(String title, String body) {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        
        return new NotificationCompat.Builder(this, CHANNEL_BG)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }
    
    /**
     * Update the persistent background notification content
     */
    public void updateBackgroundNotification(String title, String body) {
        Notification notification = buildBackgroundNotification(title, body);
        notificationManager.notify(NOTIFICATION_BG, notification);
    }
    
    /**
     * Show incoming call notification with high priority (heads-up)
     */
    public void showCallNotification(String callerName, String callType) {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        
        String title = "Incoming " + (callType != null && callType.equals("video") ? "Video" : "Voice") + " Call";
        String body = callerName + " is calling...";
        
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_CALL)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true) // Launches on lock screen
            .setAutoCancel(false)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVibrate(new long[]{0, 500, 200, 500, 200, 500})
            .build();
        
        notificationManager.notify(NOTIFICATION_CALL, notification);
        Log.i(TAG, "Call notification shown: " + callerName);
    }
    
    /**
     * Dismiss the call notification
     */
    public void dismissCallNotification() {
        notificationManager.cancel(NOTIFICATION_CALL);
    }
    
    /**
     * Show file transfer notification  
     */
    public void showTransferNotification(String title, String body, int progress) {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_TRANSFER)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(pendingIntent)
            .setAutoCancel(false)
            .setOngoing(progress >= 0 && progress < 100)
            .setSilent(progress > 0) // Only sound on first notification
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS);
        
        if (progress >= 0 && progress < 100) {
            builder.setProgress(100, progress, false);
        } else if (progress == 100) {
            builder.setSmallIcon(android.R.drawable.stat_sys_download_done);
            builder.setAutoCancel(true);
            builder.setOngoing(false);
        }
        
        notificationManager.notify(NOTIFICATION_TRANSFER, builder.build());
    }
    
    /**
     * Show incoming file transfer request notification with high priority
     */
    public void showIncomingTransferNotification(String senderName, String fileName, String fileSize) {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_CALL) // Use call channel for high priority
            .setContentTitle("Incoming File from " + senderName)
            .setContentText(fileName + " (" + fileSize + ")")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(pendingIntent)
            .setFullScreenIntent(pendingIntent, true)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVibrate(new long[]{0, 300, 150, 300})
            .build();
        
        notificationManager.notify(NOTIFICATION_TRANSFER, notification);
        Log.i(TAG, "Incoming transfer notification: " + fileName + " from " + senderName);
    }
    
    /**
     * Dismiss the transfer notification
     */
    public void dismissTransferNotification() {
        notificationManager.cancel(NOTIFICATION_TRANSFER);
    }
    
    /**
     * Get the instance of the running service
     */
    public static BackgroundService getInstance() {
        return instance;
    }
    
    /**
     * Create notification channels (Android 8.0+)
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Background channel - low priority, silent
            NotificationChannel bgChannel = new NotificationChannel(
                CHANNEL_BG,
                "Background Service",
                NotificationManager.IMPORTANCE_LOW
            );
            bgChannel.setDescription("Keeps Quick Meet connected for calls and file transfers");
            bgChannel.setShowBadge(false);
            bgChannel.enableVibration(false);
            bgChannel.setSound(null, null);
            notificationManager.createNotificationChannel(bgChannel);
            
            // Call channel - high priority with sound and vibration
            NotificationChannel callChannel = new NotificationChannel(
                CHANNEL_CALL,
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            );
            callChannel.setDescription("Notifications for incoming voice and video calls");
            callChannel.setShowBadge(true);
            callChannel.enableVibration(true);
            callChannel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500});
            callChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(callChannel);
            
            // Transfer channel - default priority
            NotificationChannel transferChannel = new NotificationChannel(
                CHANNEL_TRANSFER,
                "File Transfers",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            transferChannel.setDescription("File transfer progress and notifications");
            transferChannel.setShowBadge(true);
            notificationManager.createNotificationChannel(transferChannel);
        }
    }
    
    /**
     * Acquire partial wake lock to keep CPU running
     */
    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK, 
                "QuickMeet::BackgroundWakeLock"
            );
            wakeLock.acquire();
            Log.i(TAG, "WakeLock acquired");
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire WakeLock", e);
        }
    }
    
    /**
     * Get PendingIntent to launch the main activity
     */
    private PendingIntent getLaunchPendingIntent() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
    
    @Override
    public void onDestroy() {
        Log.i(TAG, "BackgroundService destroyed");
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception e) {
                Log.e(TAG, "WakeLock release error", e);
            }
        }
        instance = null;
        super.onDestroy();
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
