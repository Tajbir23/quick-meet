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
 * Like Messenger — always connected even when app is not open.
 */
public class BackgroundService extends Service {
    private static final String TAG = "QM-BackgroundService";
    
    // Notification channels
    public static final String CHANNEL_BG = "quickmeet_background";
    public static final String CHANNEL_CALL = "quickmeet_calls";
    public static final String CHANNEL_TRANSFER = "quickmeet_transfer";
    public static final String CHANNEL_MESSAGE = "quickmeet_messages";
    
    // Notification IDs
    public static final int NOTIFICATION_BG = 1001;
    public static final int NOTIFICATION_CALL = 1002;
    public static final int NOTIFICATION_TRANSFER = 1003;
    public static final int NOTIFICATION_MESSAGE = 1004;
    
    // Pending intent request codes (must be unique)
    private static final int RC_LAUNCH = 0;
    private static final int RC_ANSWER = 1;
    private static final int RC_DECLINE = 2;
    private static final int RC_ACCEPT_TRANSFER = 3;
    private static final int RC_REJECT_TRANSFER = 4;
    
    private PowerManager.WakeLock wakeLock;
    private static BackgroundService instance;
    private NotificationManager notificationManager;
    
    // Queue for pending notification actions (answer_call, decline_call, etc.)
    private volatile String pendingAction = null;
    
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
     * Show incoming call notification with Answer/Decline action buttons
     */
    public void showCallNotification(String callerName, String callType) {
        PendingIntent launchIntent = getLaunchPendingIntent();
        
        // Action: Answer Call
        Intent answerIntent = new Intent(this, NotificationActionReceiver.class);
        answerIntent.setAction(NotificationActionReceiver.ACTION_ANSWER_CALL);
        PendingIntent answerPending = PendingIntent.getBroadcast(
            this, RC_ANSWER, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        // Action: Decline Call
        Intent declineIntent = new Intent(this, NotificationActionReceiver.class);
        declineIntent.setAction(NotificationActionReceiver.ACTION_DECLINE_CALL);
        PendingIntent declinePending = PendingIntent.getBroadcast(
            this, RC_DECLINE, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        String title = "Incoming " + (callType != null && callType.equals("video") ? "Video" : "Voice") + " Call";
        String body = callerName + " is calling...";
        
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_CALL)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(launchIntent)
            .setFullScreenIntent(launchIntent, true)
            .setAutoCancel(false)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVibrate(new long[]{0, 500, 200, 500, 200, 500})
            .addAction(android.R.drawable.ic_menu_call, "\u2713 Answer", answerPending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "\u2715 Decline", declinePending)
            .build();
        
        notificationManager.notify(NOTIFICATION_CALL, notification);
        Log.i(TAG, "Call notification shown with actions: " + callerName);
    }
    
    /**
     * Show ongoing call notification (visible in notification panel, no sound/vibration)
     */
    public void showOngoingCallNotification(String callerName, String callType) {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        
        // Action: End Call
        Intent declineIntent = new Intent(this, NotificationActionReceiver.class);
        declineIntent.setAction(NotificationActionReceiver.ACTION_DECLINE_CALL);
        PendingIntent endCallPending = PendingIntent.getBroadcast(
            this, RC_DECLINE, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        String type = (callType != null && callType.equals("video")) ? "Video" : "Voice";
        String title = type + " Call";
        String body = "In call with " + callerName;
        
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_CALL)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentIntent(pendingIntent)
            .setAutoCancel(false)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setUsesChronometer(true)
            .setWhen(System.currentTimeMillis())
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End Call", endCallPending)
            .build();
        
        notificationManager.notify(NOTIFICATION_CALL, notification);
        Log.i(TAG, "Ongoing call notification shown: " + callerName);
    }
    
    /**
     * Dismiss the call notification
     */
    public void dismissCallNotification() {
        notificationManager.cancel(NOTIFICATION_CALL);
    }
    
    /**
     * Show file transfer progress notification (persistent until 100%)
     */
    public void showTransferNotification(String title, String body, int progress) {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_TRANSFER)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(pendingIntent)
            .setAutoCancel(false)
            .setOngoing(true) // Always ongoing — persistent until complete
            .setSilent(true) // Silent to avoid spam during progress updates
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS);
        
        if (progress >= 0 && progress < 100) {
            builder.setProgress(100, progress, false);
        } else if (progress == 100) {
            builder.setSmallIcon(android.R.drawable.stat_sys_download_done);
            builder.setAutoCancel(true);
            builder.setOngoing(false); // Allow dismiss after completion
            builder.setPriority(NotificationCompat.PRIORITY_DEFAULT);
            builder.setProgress(0, 0, false);
        }
        
        notificationManager.notify(NOTIFICATION_TRANSFER, builder.build());
    }
    
    /**
     * Show incoming file transfer request with Accept/Reject action buttons
     */
    public void showIncomingTransferNotification(String senderName, String fileName, String fileSize) {
        PendingIntent launchIntent = getLaunchPendingIntent();
        
        // Action: Accept Transfer
        Intent acceptIntent = new Intent(this, NotificationActionReceiver.class);
        acceptIntent.setAction(NotificationActionReceiver.ACTION_ACCEPT_TRANSFER);
        PendingIntent acceptPending = PendingIntent.getBroadcast(
            this, RC_ACCEPT_TRANSFER, acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        // Action: Reject Transfer
        Intent rejectIntent = new Intent(this, NotificationActionReceiver.class);
        rejectIntent.setAction(NotificationActionReceiver.ACTION_REJECT_TRANSFER);
        PendingIntent rejectPending = PendingIntent.getBroadcast(
            this, RC_REJECT_TRANSFER, rejectIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_CALL)
            .setContentTitle("Incoming File from " + senderName)
            .setContentText(fileName + " (" + fileSize + ")")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(launchIntent)
            .setFullScreenIntent(launchIntent, true)
            .setAutoCancel(false)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVibrate(new long[]{0, 300, 150, 300})
            .addAction(android.R.drawable.ic_menu_save, "\u2713 Accept", acceptPending)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "\u2715 Reject", rejectPending)
            .build();
        
        notificationManager.notify(NOTIFICATION_TRANSFER, notification);
        Log.i(TAG, "Incoming transfer notification with actions: " + fileName + " from " + senderName);
    }
    
    /**
     * Show message notification
     */
    public void showMessageNotification(String senderName, String message) {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_MESSAGE)
            .setContentTitle(senderName)
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVibrate(new long[]{0, 200})
            .build();
        
        notificationManager.notify(NOTIFICATION_MESSAGE, notification);
    }
    
    /**
     * Dismiss the transfer notification
     */
    public void dismissTransferNotification() {
        notificationManager.cancel(NOTIFICATION_TRANSFER);
    }
    
    /**
     * Dismiss message notification
     */
    public void dismissMessageNotification() {
        notificationManager.cancel(NOTIFICATION_MESSAGE);
    }
    
    /**
     * Set a pending action from notification button press
     */
    public void setPendingAction(String action) {
        this.pendingAction = action;
        Log.i(TAG, "Pending action set: " + action);
    }
    
    /**
     * Get and clear the pending action (polled from JS)
     */
    public String consumePendingAction() {
        String action = this.pendingAction;
        this.pendingAction = null;
        return action;
    }
    
    /**
     * Get the instance of the running service
     */
    public static BackgroundService getInstance() {
        return instance;
    }
    
    /**
     * Check if battery optimization is disabled for this app
     */
    public static boolean isBatteryOptimizationDisabled(Context context) {
        PowerManager pm = (PowerManager) context.getSystemService(POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(context.getPackageName());
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
            
            // Transfer channel - low priority (silent progress)
            NotificationChannel transferChannel = new NotificationChannel(
                CHANNEL_TRANSFER,
                "File Transfers",
                NotificationManager.IMPORTANCE_LOW
            );
            transferChannel.setDescription("File transfer progress and notifications");
            transferChannel.setShowBadge(true);
            transferChannel.enableVibration(false);
            notificationManager.createNotificationChannel(transferChannel);
            
            // Message channel - high priority
            NotificationChannel messageChannel = new NotificationChannel(
                CHANNEL_MESSAGE,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH
            );
            messageChannel.setDescription("New message notifications");
            messageChannel.setShowBadge(true);
            messageChannel.enableVibration(true);
            messageChannel.setVibrationPattern(new long[]{0, 200});
            notificationManager.createNotificationChannel(messageChannel);
        }
    }
    
    /**
     * Acquire partial wake lock with 4-hour timeout to prevent battery drain.
     * Service is START_STICKY so Android will restart it if killed.
     */
    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK, 
                "QuickMeet::BackgroundWakeLock"
            );
            wakeLock.acquire(4 * 60 * 60 * 1000L); // 4 hour timeout
            Log.i(TAG, "WakeLock acquired (4h timeout)");
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
            this, RC_LAUNCH, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
    
    @Override
    public void onDestroy() {
        Log.i(TAG, "BackgroundService destroyed — will be restarted by START_STICKY");
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
