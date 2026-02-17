package com.quickmeet.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.display.VirtualDisplay;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground Service for screen capture via MediaProjection.
 * 
 * Android requires a foreground service with type "mediaProjection"
 * to use MediaProjection API (Android 10+).
 * 
 * On Android 14+ (API 34), startForeground() MUST specify
 * FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or the app crashes.
 */
public class ScreenCaptureService extends Service {

    private static final String TAG = "QM-ScreenCapture";
    private static final String CHANNEL_ID = "quickmeet_screen_capture";
    private static final int NOTIFICATION_ID = 9999;

    private static ScreenCaptureService instance;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private boolean isCleaningUp = false;

    public static ScreenCaptureService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
        Log.i(TAG, "ScreenCaptureService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            Log.e(TAG, "Null intent received");
            stopSelf();
            return START_NOT_STICKY;
        }

        int resultCode = intent.getIntExtra("resultCode", -1);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resultData = intent.getParcelableExtra("resultData", Intent.class);
        } else {
            resultData = intent.getParcelableExtra("resultData");
        }

        if (resultCode == -1 || resultData == null) {
            Log.e(TAG, "Invalid MediaProjection result: code=" + resultCode + ", data=" + resultData);
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            // Start as foreground service IMMEDIATELY
            // Android 14+ (API 34) REQUIRES foregroundServiceType in startForeground()
            Notification notification = createNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // Android 14+: must specify FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Android 10-13: also specify type (recommended)
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }

            // Create MediaProjection AFTER startForeground
            MediaProjectionManager projectionManager =
                    (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            mediaProjection = projectionManager.getMediaProjection(resultCode, resultData);

            if (mediaProjection == null) {
                Log.e(TAG, "Failed to create MediaProjection");
                stopSelf();
                return START_NOT_STICKY;
            }

            // Register callback for when projection is stopped externally
            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    Log.i(TAG, "MediaProjection stopped externally");
                    cleanup();
                    stopSelf();
                }
            }, null);

            Log.i(TAG, "Screen capture service started successfully with MediaProjection");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground service", e);
            stopSelf();
        }

        return START_NOT_STICKY;
    }

    /**
     * Get the MediaProjection instance for creating a VirtualDisplay.
     * Called by the WebView JavaScript layer via the plugin.
     */
    public MediaProjection getMediaProjection() {
        return mediaProjection;
    }

    /**
     * Stop screen capture and clean up
     */
    public void stopCapture() {
        Log.i(TAG, "Stopping screen capture");
        cleanup();
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        } catch (Exception e) {
            Log.w(TAG, "Error stopping foreground: " + e.getMessage());
        }
        stopSelf();
    }

    private void cleanup() {
        if (isCleaningUp) return; // Prevent double-cleanup crash
        isCleaningUp = true;

        try {
            if (virtualDisplay != null) {
                virtualDisplay.release();
                virtualDisplay = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error releasing VirtualDisplay: " + e.getMessage());
        }

        try {
            if (mediaProjection != null) {
                mediaProjection.stop();
                mediaProjection = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error stopping MediaProjection: " + e.getMessage());
        }

        instance = null;
        isCleaningUp = false;
    }

    @Override
    public void onDestroy() {
        cleanup();
        super.onDestroy();
        Log.i(TAG, "ScreenCaptureService destroyed");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification createNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Quick Meet")
                .setContentText("Sharing your screen...")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Screen Sharing",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shows when screen is being shared");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
}
