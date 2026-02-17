package com.quickmeet.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

/**
 * Foreground Service for screen capture via MediaProjection.
 *
 * Captures actual screen frames using:
 * MediaProjection -> VirtualDisplay -> ImageReader -> Bitmap -> JPEG
 *
 * Frames are sent to JS via a local WebSocket server (ScreenShareServer)
 * as raw binary JPEG -- no base64, no Capacitor bridge overhead.
 * JS draws frames on canvas -> captureStream() -> WebRTC.
 */
public class ScreenCaptureService extends Service {

    private static final String TAG = "QM-ScreenCapture";
    private static final String CHANNEL_ID = "quickmeet_screen_capture";
    private static final int NOTIFICATION_ID = 9999;

    // Frame capture settings
    private static final int MAX_DIMENSION = 480;
    private static final int JPEG_QUALITY = 30;
    private static final int FRAME_INTERVAL_MS = 20; // 50 fps

    private static ScreenCaptureService instance;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread imageThread;
    private Handler imageHandler;
    private ScreenShareServer wsServer;
    private boolean isCleaningUp = false;
    private boolean isCapturing = false;
    private long lastFrameTime = 0;
    private int captureWidth;
    private int captureHeight;

    // Reusable buffer to reduce GC pressure at 50fps
    private ByteArrayOutputStream reusableBuffer;

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
        // CRITICAL: Must call startForeground() IMMEDIATELY
        try {
            Notification notification = createNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground", e);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (intent == null) {
            Log.e(TAG, "Null intent received");
            stopSelf();
            return START_NOT_STICKY;
        }

        int resultCode = intent.getIntExtra("resultCode", Activity.RESULT_CANCELED);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resultData = intent.getParcelableExtra("resultData", Intent.class);
        } else {
            resultData = intent.getParcelableExtra("resultData");
        }

        if (resultCode != Activity.RESULT_OK || resultData == null) {
            Log.e(TAG, "Invalid MediaProjection result: code=" + resultCode);
            stopSelf();
            return START_NOT_STICKY;
        }

        try {
            MediaProjectionManager projectionManager =
                    (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            mediaProjection = projectionManager.getMediaProjection(resultCode, resultData);

            if (mediaProjection == null) {
                Log.e(TAG, "Failed to create MediaProjection");
                stopSelf();
                return START_NOT_STICKY;
            }

            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    Log.i(TAG, "MediaProjection stopped externally");
                    cleanup();
                    stopSelf();
                }
            }, null);

            // Start WebSocket server + frame capture
            startFrameCapture();

            Log.i(TAG, "Screen capture service started with WebSocket streaming");
        } catch (Exception e) {
            Log.e(TAG, "Failed to set up MediaProjection", e);
            stopSelf();
        }

        return START_NOT_STICKY;
    }

    /**
     * Start the WebSocket server and begin capturing frames.
     */
    private void startFrameCapture() {
        if (isCapturing || mediaProjection == null) return;

        // Start WebSocket server for frame delivery
        try {
            wsServer = new ScreenShareServer();
            int wsPort = wsServer.start();
            Log.i(TAG, "WebSocket server started on port " + wsPort);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start WebSocket server", e);
            return;
        }

        // Calculate capture dimensions preserving aspect ratio
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int screenWidth = metrics.widthPixels;
        int screenHeight = metrics.heightPixels;
        int densityDpi = metrics.densityDpi;

        float scale = (float) MAX_DIMENSION / Math.max(screenWidth, screenHeight);
        if (scale > 1f) scale = 1f;

        captureWidth = Math.round(screenWidth * scale);
        captureHeight = Math.round(screenHeight * scale);
        captureWidth = (captureWidth / 2) * 2;
        captureHeight = (captureHeight / 2) * 2;

        // Pre-allocate reusable buffer
        reusableBuffer = new ByteArrayOutputStream(captureWidth * captureHeight / 8);

        Log.i(TAG, "Capture: " + captureWidth + "x" + captureHeight
                + " (screen: " + screenWidth + "x" + screenHeight + ")");

        // Background thread for image processing
        imageThread = new HandlerThread("QM-ScreenCapture");
        imageThread.start();
        imageHandler = new Handler(imageThread.getLooper());

        // Create ImageReader with 3 buffers for 50fps
        imageReader = ImageReader.newInstance(
                captureWidth, captureHeight, PixelFormat.RGBA_8888, 3);

        imageReader.setOnImageAvailableListener(reader -> {
            long now = System.currentTimeMillis();
            if (now - lastFrameTime < FRAME_INTERVAL_MS) {
                Image image = reader.acquireLatestImage();
                if (image != null) image.close();
                return;
            }
            lastFrameTime = now;

            Image image = reader.acquireLatestImage();
            if (image == null) return;

            try {
                processFrame(image);
            } catch (Exception e) {
                Log.w(TAG, "Frame error: " + e.getMessage());
            } finally {
                image.close();
            }
        }, imageHandler);

        // Create VirtualDisplay
        virtualDisplay = mediaProjection.createVirtualDisplay(
                "QuickMeetScreen",
                captureWidth, captureHeight, densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null, null
        );

        isCapturing = true;
        Log.i(TAG, "Frame capture started: " + captureWidth + "x" + captureHeight
                + " @" + (1000 / FRAME_INTERVAL_MS) + "fps, JPEG Q=" + JPEG_QUALITY
                + ", delivery=WebSocket:" + wsServer.getPort());
    }

    /**
     * Convert Image -> JPEG bytes -> queue to WebSocket server.
     * No base64 encoding -- raw binary goes over WebSocket.
     */
    private void processFrame(Image image) {
        if (wsServer == null) return;

        Image.Plane[] planes = image.getPlanes();
        if (planes.length == 0) return;

        ByteBuffer buffer = planes[0].getBuffer();
        int pixelStride = planes[0].getPixelStride();
        int rowStride = planes[0].getRowStride();
        int rowPadding = rowStride - pixelStride * captureWidth;

        int bitmapWidth = captureWidth + rowPadding / pixelStride;
        Bitmap bitmap = Bitmap.createBitmap(bitmapWidth, captureHeight, Bitmap.Config.ARGB_8888);
        bitmap.copyPixelsFromBuffer(buffer);

        Bitmap finalBitmap;
        if (bitmapWidth != captureWidth) {
            finalBitmap = Bitmap.createBitmap(bitmap, 0, 0, captureWidth, captureHeight);
            bitmap.recycle();
        } else {
            finalBitmap = bitmap;
        }

        // Compress to JPEG -- reuse buffer to reduce GC
        reusableBuffer.reset();
        finalBitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, reusableBuffer);
        finalBitmap.recycle();

        // Queue raw JPEG bytes to WebSocket (non-blocking, drops old frames)
        wsServer.queueFrame(reusableBuffer.toByteArray());
    }

    public MediaProjection getMediaProjection() {
        return mediaProjection;
    }

    public boolean isCapturing() {
        return isCapturing;
    }

    /**
     * Get the WebSocket server port for JS to connect.
     */
    public int getServerPort() {
        return wsServer != null ? wsServer.getPort() : 0;
    }

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
        if (isCleaningUp) return;
        isCleaningUp = true;
        isCapturing = false;

        try {
            if (virtualDisplay != null) {
                virtualDisplay.release();
                virtualDisplay = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error releasing VirtualDisplay: " + e.getMessage());
        }

        try {
            if (imageReader != null) {
                imageReader.close();
                imageReader = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error closing ImageReader: " + e.getMessage());
        }

        try {
            if (imageThread != null) {
                imageThread.quitSafely();
                imageThread = null;
                imageHandler = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error stopping image thread: " + e.getMessage());
        }

        try {
            if (wsServer != null) {
                wsServer.stop();
                wsServer = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error stopping WebSocket server: " + e.getMessage());
        }

        try {
            if (mediaProjection != null) {
                mediaProjection.stop();
                mediaProjection = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Error stopping MediaProjection: " + e.getMessage());
        }

        reusableBuffer = null;
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
