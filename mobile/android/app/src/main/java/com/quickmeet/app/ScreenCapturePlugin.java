package com.quickmeet.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * ScreenCapturePlugin — Capacitor Plugin for Android Screen Share
 *
 * Captures actual screen content using native MediaProjection API
 * and streams raw binary JPEG frames via a local WebSocket server.
 *
 * Flow:
 * 1. JS calls ScreenCapture.start()
 * 2. Plugin launches MediaProjection permission dialog
 * 3. On grant → starts ScreenCaptureService (foreground, mediaProjection type)
 * 4. Service captures screen frames via ImageReader → JPEG bytes
 * 5. Service sends raw JPEG via WebSocket (ScreenShareServer on localhost)
 * 6. Plugin returns the WebSocket port to JS
 * 7. JS connects to ws://127.0.0.1:PORT, receives binary frames
 * 8. JS draws frames on canvas → canvas.captureStream() → WebRTC
 * 9. JS calls ScreenCapture.stop() → stops the service
 */
@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {

    private static final String TAG = "QM-ScreenCapturePlugin";
    private PluginCall savedCall;

    @Override
    public void load() {
        super.load();
        // No frame callback needed — frames go via WebSocket
        Log.i(TAG, "ScreenCapturePlugin loaded (WebSocket mode)");
    }

    /**
     * Request screen capture permission and start the service.
     */
    @PluginMethod()
    public void start(PluginCall call) {
        Log.i(TAG, "Screen capture start requested");
        savedCall = call;

        try {
            MediaProjectionManager projectionManager =
                    (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            Intent captureIntent = projectionManager.createScreenCaptureIntent();
            startActivityForResult(call, captureIntent, "handleScreenCaptureResult");
        } catch (Exception e) {
            Log.e(TAG, "Failed to request screen capture", e);
            call.reject("Failed to request screen capture: " + e.getMessage());
        }
    }

    /**
     * Handle the result from the screen capture permission dialog.
     */
    @ActivityCallback
    private void handleScreenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) call = savedCall;

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Log.i(TAG, "Screen capture permission granted");

            try {
                Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
                serviceIntent.putExtra("resultCode", result.getResultCode());
                serviceIntent.putExtra("resultData", result.getData());

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(serviceIntent);
                } else {
                    getContext().startService(serviceIntent);
                }

                // Poll for service WebSocket port (service starts async via Intent)
                final PluginCall finalCall = call;
                new Thread(() -> {
                    for (int i = 0; i < 50; i++) { // up to 5 seconds
                        ScreenCaptureService svc = ScreenCaptureService.getInstance();
                        if (svc != null && svc.getServerPort() > 0) {
                            JSObject ret = new JSObject();
                            ret.put("success", true);
                            ret.put("port", svc.getServerPort());
                            ret.put("message", "Screen capture started with WebSocket streaming");
                            if (finalCall != null) finalCall.resolve(ret);
                            return;
                        }
                        try { Thread.sleep(100); } catch (InterruptedException e) { break; }
                    }
                    if (finalCall != null) finalCall.reject("Timeout: screen capture service did not start");
                }, "QM-WaitForPort").start();
            } catch (Exception e) {
                Log.e(TAG, "Failed to start screen capture service", e);
                if (call != null) call.reject("Failed to start: " + e.getMessage());
            }
        } else {
            Log.i(TAG, "Screen capture permission denied by user");
            if (call != null) call.reject("Screen capture permission denied");
        }
    }

    /**
     * Stop screen capture and frame streaming
     */
    @PluginMethod()
    public void stop(PluginCall call) {
        Log.i(TAG, "Screen capture stop requested");

        try {
            ScreenCaptureService service = ScreenCaptureService.getInstance();
            if (service != null) {
                service.stopCapture();
            }

            Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
            getContext().stopService(serviceIntent);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop screen capture", e);
            call.reject("Failed to stop: " + e.getMessage());
        }
    }

    /**
     * Check if screen capture is currently active
     */
    @PluginMethod()
    public void isActive(PluginCall call) {
        ScreenCaptureService service = ScreenCaptureService.getInstance();
        boolean active = service != null && service.isCapturing();

        JSObject ret = new JSObject();
        ret.put("active", active);
        call.resolve(ret);
    }
}
