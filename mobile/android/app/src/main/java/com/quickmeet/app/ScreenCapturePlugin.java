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
 * Since Android WebView doesn't support getDisplayMedia(),
 * this plugin provides native MediaProjection-based screen capture.
 * 
 * Flow:
 * 1. JS calls ScreenCapture.start() 
 * 2. Plugin launches MediaProjection permission dialog
 * 3. On grant → starts ScreenCaptureService (foreground, mediaProjection type)
 * 4. Plugin injects JavaScript into WebView to create a MediaStream
 *    from the screen capture using the native MediaProjection
 * 5. JS calls ScreenCapture.stop() → stops the service
 * 
 * The key insight: Android WebView DOES support getUserMedia with
 * video constraints when the WebView gets a screen capture surface.
 * We use the MediaProjection to create a VirtualDisplay and then
 * use WebView.evaluateJavascript to notify the JS layer.
 */
@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {
    
    private static final String TAG = "QM-ScreenCapturePlugin";
    private static final int SCREEN_CAPTURE_REQUEST = 1001;
    
    private PluginCall savedCall;

    /**
     * Request screen capture permission and start the service.
     * The JS layer will be notified when ready.
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
        if (call == null) {
            call = savedCall;
        }
        
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Log.i(TAG, "Screen capture permission granted");
            
            try {
                // Start the foreground service with the MediaProjection result
                Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
                serviceIntent.putExtra("resultCode", result.getResultCode());
                serviceIntent.putExtra("resultData", result.getData());
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(serviceIntent);
                } else {
                    getContext().startService(serviceIntent);
                }
                
                // Notify JS that screen capture is ready
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("message", "Screen capture service started");
                
                if (call != null) {
                    call.resolve(ret);
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to start screen capture service", e);
                if (call != null) {
                    call.reject("Failed to start screen capture service: " + e.getMessage());
                }
            }
        } else {
            Log.i(TAG, "Screen capture permission denied by user");
            if (call != null) {
                call.reject("Screen capture permission denied");
            }
        }
    }

    /**
     * Stop screen capture
     */
    @PluginMethod()
    public void stop(PluginCall call) {
        Log.i(TAG, "Screen capture stop requested");
        
        try {
            ScreenCaptureService service = ScreenCaptureService.getInstance();
            if (service != null) {
                service.stopCapture();
            }
            
            // Also stop the service intent
            Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
            getContext().stopService(serviceIntent);
            
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop screen capture", e);
            call.reject("Failed to stop screen capture: " + e.getMessage());
        }
    }

    /**
     * Check if screen capture is currently active
     */
    @PluginMethod()
    public void isActive(PluginCall call) {
        ScreenCaptureService service = ScreenCaptureService.getInstance();
        boolean active = service != null && service.getMediaProjection() != null;
        
        JSObject ret = new JSObject();
        ret.put("active", active);
        call.resolve(ret);
    }
}
