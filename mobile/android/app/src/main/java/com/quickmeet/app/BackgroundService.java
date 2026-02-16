package com.quickmeet.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.security.cert.X509Certificate;

import android.media.AudioManager;

/**
 * Foreground Service for Quick Meet
 * 
 * Keeps the app alive in background so that:
 * - Socket.io connection stays active (incoming calls, messages)
 * - File transfers continue when app is backgrounded
 * - WebView JS execution is not suspended by Android
 * - **IMPORTANT**: During active calls, the service upgrades to
 *   phoneCall|microphone foreground service type + acquires audio focus
 *   so Android doesn't suspend WebRTC audio when minimized.
 * - Polls server for pending notifications every 5 seconds
 *   using native HTTP (works even when WebView JS is suspended)
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
    
    // Polling config
    private static final long POLL_INTERVAL_MS = 5000; // 5 seconds
    private static final String PREFS_NAME = "QuickMeetPrefs";
    private static final String PREF_AUTH_TOKEN = "auth_token";
    private static final String PREF_SERVER_URL = "server_url";
    
    private PowerManager.WakeLock wakeLock;
    private static BackgroundService instance;
    private NotificationManager notificationManager;
    
    // Audio focus for keeping WebRTC audio alive in background
    private AudioManager audioManager;
    private Object audioFocusRequest; // AudioFocusRequest (API 26+), stored as Object for compatibility
    private boolean hasAudioFocus = false;
    private boolean isInCall = false;
    
    // Queue for pending notification actions (answer_call, decline_call, etc.)
    private volatile String pendingAction = null;
    
    // Polling thread
    private HandlerThread pollingThread;
    private Handler pollingHandler;
    private boolean isPolling = false;
    
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notificationManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        createNotificationChannels();
        acquireWakeLock();
        startPolling();
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
            // DATA_SYNC = 1
            startForeground(NOTIFICATION_BG, notification, 1);
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
     * Show ongoing call notification (visible in notification panel, no sound/vibration).
     * Also upgrades the foreground service type and acquires audio focus
     * so WebRTC audio keeps playing when app is minimized.
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
        
        // Mark as in-call and upgrade foreground service + audio focus
        isInCall = true;
        upgradeToCallForegroundService(notification);
        acquireAudioFocus();
        
        Log.i(TAG, "Ongoing call notification shown + foreground upgraded: " + callerName);
    }
    
    /**
     * Dismiss the call notification.
     * Also downgrades the foreground service type and releases audio focus.
     */
    public void dismissCallNotification() {
        notificationManager.cancel(NOTIFICATION_CALL);
        
        // Downgrade foreground service type and release audio focus
        if (isInCall) {
            isInCall = false;
            releaseAudioFocus();
            downgradeFromCallForegroundService();
            Log.i(TAG, "Call ended — foreground downgraded, audio focus released");
        }
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
    
    // ========== Call-mode foreground service upgrade/downgrade ==========
    
    /**
     * Upgrade the foreground service type to include phoneCall + microphone.
     * This tells Android to keep audio processing alive even when the app is in background.
     * Must be called when a call starts (from showOngoingCallNotification).
     */
    @SuppressWarnings("all")
    private void upgradeToCallForegroundService(Notification callNotification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Foreground service type constants (raw int values for compilation safety):
                // DATA_SYNC=1, PHONE_CALL=4, MICROPHONE=128
                int serviceType = 1 | 4 | 128;
                startForeground(NOTIFICATION_BG, callNotification, serviceType);
                Log.i(TAG, "Foreground service upgraded to phoneCall|microphone|dataSync");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to upgrade foreground service type", e);
        }
    }
    
    /**
     * Downgrade the foreground service type back to dataSync only.
     * Called when a call ends.
     */
    @SuppressWarnings("all")
    private void downgradeFromCallForegroundService() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Rebuild the background notification and re-start foreground with just dataSync
                Notification bgNotification = buildBackgroundNotification();
                // DATA_SYNC = 1
                startForeground(NOTIFICATION_BG, bgNotification, 1);
                Log.i(TAG, "Foreground service downgraded to dataSync only");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to downgrade foreground service type", e);
        }
    }
    
    /**
     * Acquire audio focus to prevent Android from killing audio processing.
     * Uses USAGE_VOICE_COMMUNICATION so the system treats this like a phone call.
     */
    @SuppressWarnings("all")
    private void acquireAudioFocus() {
        try {
            if (hasAudioFocus || audioManager == null) return;
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.media.AudioAttributes audioAttributes = new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                
                android.media.AudioFocusRequest afr = new android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(audioAttributes)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(new AudioManager.OnAudioFocusChangeListener() {
                        @Override
                        public void onAudioFocusChange(int focusChange) {
                            Log.d(TAG, "Audio focus changed: " + focusChange);
                        }
                    })
                    .build();
                
                audioFocusRequest = afr;
                int result = audioManager.requestAudioFocus(afr);
                hasAudioFocus = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
                
                // Also set MODE_IN_COMMUNICATION to keep audio path active
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                
                Log.i(TAG, "Audio focus " + (hasAudioFocus ? "acquired" : "denied") + " (voice communication mode)");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire audio focus", e);
        }
    }
    
    /**
     * Release audio focus when call ends.
     */
    @SuppressWarnings("all")
    private void releaseAudioFocus() {
        try {
            if (audioManager != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest((android.media.AudioFocusRequest) audioFocusRequest);
                    audioFocusRequest = null;
                }
                audioManager.setMode(AudioManager.MODE_NORMAL);
                hasAudioFocus = false;
                Log.i(TAG, "Audio focus released, mode set to NORMAL");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to release audio focus", e);
        }
    }
    
    /**
     * Build the background (non-call) notification.
     * Used when downgrading from call mode back to normal background mode.
     */
    private Notification buildBackgroundNotification() {
        PendingIntent pendingIntent = getLaunchPendingIntent();
        return new NotificationCompat.Builder(this, CHANNEL_BG)
            .setContentTitle("Quick Meet")
            .setContentText("Connected — ready for calls and messages")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setAutoCancel(false)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
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
     * Check if currently in a call.
     * Used by MainActivity to decide whether to keep WebView alive in background.
     */
    public boolean isCallActive() {
        return isInCall;
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
    
    /**
     * Start native HTTP polling for pending notifications.
     * Runs on a separate HandlerThread so it doesn't block the main thread.
     * Polls /api/push/pending?token=JWT every 5 seconds.
     */
    private void startPolling() {
        if (isPolling) return;
        isPolling = true;
        
        pollingThread = new HandlerThread("QM-PollingThread");
        pollingThread.start();
        pollingHandler = new Handler(pollingThread.getLooper());
        
        pollingHandler.post(pollRunnable);
        Log.i(TAG, "Notification polling started (every " + POLL_INTERVAL_MS + "ms)");
    }
    
    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!isPolling) return;
            try {
                pollPendingNotifications();
            } catch (Exception e) {
                Log.w(TAG, "Poll error: " + e.getMessage());
            }
            if (isPolling && pollingHandler != null) {
                pollingHandler.postDelayed(this, POLL_INTERVAL_MS);
            }
        }
    };
    
    /**
     * Stop the polling thread
     */
    private void stopPolling() {
        isPolling = false;
        if (pollingHandler != null) {
            pollingHandler.removeCallbacksAndMessages(null);
            pollingHandler = null;
        }
        if (pollingThread != null) {
            pollingThread.quitSafely();
            pollingThread = null;
        }
        Log.i(TAG, "Notification polling stopped");
    }
    
    /**
     * Poll the server for pending notifications via native HTTP.
     * This works even when WebView JS is suspended by Android.
     */
    private void pollPendingNotifications() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString(PREF_AUTH_TOKEN, null);
        String serverUrl = prefs.getString(PREF_SERVER_URL, null);
        
        if (token == null || serverUrl == null) {
            return; // Not logged in yet, skip
        }
        
        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl + "/api/push/pending?token=" + token);
            
            // Trust all certs (self-signed SSL on VPS)
            if (url.getProtocol().equals("https")) {
                HttpsURLConnection httpsConn = (HttpsURLConnection) url.openConnection();
                SSLContext sslContext = SSLContext.getInstance("TLS");
                sslContext.init(null, new TrustManager[]{new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] chain, String authType) {}
                    public void checkServerTrusted(X509Certificate[] chain, String authType) {}
                }}, new java.security.SecureRandom());
                httpsConn.setSSLSocketFactory(sslContext.getSocketFactory());
                httpsConn.setHostnameVerifier((hostname, session) -> true);
                conn = httpsConn;
            } else {
                conn = (HttpURLConnection) url.openConnection();
            }
            
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Accept", "application/json");
            
            int responseCode = conn.getResponseCode();
            if (responseCode != 200) {
                return;
            }
            
            // Read response
            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();
            
            JSONObject response = new JSONObject(sb.toString());
            int count = response.optInt("count", 0);
            if (count == 0) return;
            
            JSONArray notifications = response.optJSONArray("notifications");
            if (notifications == null) return;
            
            Log.i(TAG, "Polled " + count + " pending notification(s)");
            
            for (int i = 0; i < notifications.length(); i++) {
                JSONObject notif = notifications.getJSONObject(i);
                String type = notif.optString("type", "message");
                String title = notif.optString("title", "Quick Meet");
                String body = notif.optString("body", "");
                
                switch (type) {
                    case "call":
                        JSONObject callData = notif.optJSONObject("data");
                        String callerName = callData != null ? callData.optString("callerName", title) : title;
                        String callType = callData != null ? callData.optString("callType", "audio") : "audio";
                        showCallNotification(callerName, callType);
                        break;
                    case "message":
                    default:
                        showMessageNotification(title, body);
                        break;
                }
            }
            
        } catch (Exception e) {
            // Silent fail — will retry on next poll
            Log.d(TAG, "Poll request failed: " + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }
    
    /**
     * Save auth token for polling (called from JS via BackgroundServicePlugin)
     */
    public void setAuthToken(String token, String serverUrl) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        if (token != null) {
            editor.putString(PREF_AUTH_TOKEN, token);
        } else {
            editor.remove(PREF_AUTH_TOKEN);
        }
        if (serverUrl != null) {
            editor.putString(PREF_SERVER_URL, serverUrl);
        }
        editor.apply();
        Log.i(TAG, "Auth token " + (token != null ? "saved" : "cleared") + " for polling");
    }
    
    @Override
    public void onDestroy() {
        Log.i(TAG, "BackgroundService destroyed — will be restarted by START_STICKY");
        stopPolling();
        
        // Clean up audio focus if still held
        if (isInCall) {
            releaseAudioFocus();
            isInCall = false;
        }
        
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
