package com.quickmeet.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground Service for screen capture via MediaProjection.
 * 
 * Android requires a foreground service with type "mediaProjection"
 * to use MediaProjection API (especially on Android 10+).
 * 
 * This service:
 * 1. Starts as a foreground service with a notification ("Sharing screen...")
 * 2. Creates a MediaProjection from the result intent
 * 3. Creates a VirtualDisplay that captures the screen
 * 4. The VirtualDisplay surface is provided by the WebView's WebRTC
 *    via a Surface passed from the ScreenCapturePlugin
 * 
 * Lifecycle:
 * - Started by ScreenCapturePlugin after user grants MediaProjection permission
 * - Stopped when screen share ends (user clicks stop, or call ends)
 */
public class ScreenCaptureService extends Service {

    private static final String TAG = "QM-ScreenCapture";
    private static final String CHANNEL_ID = "quickmeet_screen_capture";
    private static final int NOTIFICATION_ID = 9999;

    private static ScreenCaptureService instance;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private int resultCode;
    private Intent resultData;

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
            stopSelf();
            return START_NOT_STICKY;
        }

        resultCode = intent.getIntExtra("resultCode", -1);
        resultData = intent.getParcelableExtra("resultData");

        if (resultCode == -1 || resultData == null) {
            Log.e(TAG, "Invalid MediaProjection result");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Start as foreground service IMMEDIATELY (before creating MediaProjection)
        startForeground(NOTIFICATION_ID, createNotification());

        // Create MediaProjection
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

        Log.i(TAG, "Screen capture service started with MediaProjection");
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
        stopForeground(true);
        stopSelf();
    }

    private void cleanup() {
        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (mediaProjection != null) {
            mediaProjection.stop();
            mediaProjection = null;
        }
        instance = null;
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
