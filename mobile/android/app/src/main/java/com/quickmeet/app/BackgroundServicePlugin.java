package com.quickmeet.app;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin Bridge for BackgroundService
 * 
 * Exposes the Android foreground service to JavaScript:
 * - start/stop the background service
 * - update notification content
 * - show call/transfer notifications
 * 
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const BackgroundService = registerPlugin('BackgroundService');
 *   await BackgroundService.start({ title: '...', body: '...' });
 */
@CapacitorPlugin(name = "BackgroundService")
public class BackgroundServicePlugin extends Plugin {
    private static final String TAG = "QM-BGPlugin";
    
    /**
     * Start the foreground service
     * @param title - Notification title
     * @param body - Notification body text
     */
    @PluginMethod()
    public void start(PluginCall call) {
        String title = call.getString("title", "Quick Meet");
        String body = call.getString("body", "Connected — waiting for calls & messages");
        
        try {
            Intent serviceIntent = new Intent(getContext(), BackgroundService.class);
            serviceIntent.putExtra("title", title);
            serviceIntent.putExtra("body", body);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }
            
            Log.i(TAG, "Background service started");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start background service", e);
            call.reject("Failed to start background service: " + e.getMessage());
        }
    }
    
    /**
     * Stop the foreground service
     */
    @PluginMethod()
    public void stop(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), BackgroundService.class);
            getContext().stopService(serviceIntent);
            Log.i(TAG, "Background service stopped");
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to stop background service", e);
            call.reject("Failed to stop background service: " + e.getMessage());
        }
    }
    
    /**
     * Update the persistent background notification
     * @param title - New notification title
     * @param body - New notification body text
     */
    @PluginMethod()
    public void updateNotification(PluginCall call) {
        String title = call.getString("title", "Quick Meet");
        String body = call.getString("body", "Running in background");
        
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.updateBackgroundNotification(title, body);
        }
        call.resolve();
    }
    
    /**
     * Show incoming call notification (high priority, heads-up)
     * @param callerName - Name of the caller
     * @param callType - "audio" or "video"
     */
    @PluginMethod()
    public void showCallNotification(PluginCall call) {
        String callerName = call.getString("callerName", "Unknown");
        String callType = call.getString("callType", "audio");
        
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.showCallNotification(callerName, callType);
        }
        call.resolve();
    }
    
    /**
     * Show ongoing call notification (persistent, no sound)
     * Shows in notification panel that a call is active.
     * @param callerName - Name of the remote user
     * @param callType - "audio" or "video"
     */
    @PluginMethod()
    public void showOngoingCallNotification(PluginCall call) {
        String callerName = call.getString("callerName", "Unknown");
        String callType = call.getString("callType", "audio");
        
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.showOngoingCallNotification(callerName, callType);
        }
        call.resolve();
    }
    
    /**
     * Dismiss the call notification (incoming or ongoing)
     */
    @PluginMethod()
    public void dismissCallNotification(PluginCall call) {
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.dismissCallNotification();
        }
        call.resolve();
    }
    
    /**
     * Show file transfer progress notification
     * @param title - Notification title
     * @param body - Notification body
     * @param progress - 0-100 progress, or -1 for indeterminate
     */
    @PluginMethod()
    public void showTransferNotification(PluginCall call) {
        String title = call.getString("title", "File Transfer");
        String body = call.getString("body", "Transferring...");
        int progress = call.getInt("progress", -1);
        
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.showTransferNotification(title, body, progress);
        }
        call.resolve();
    }
    
    /**
     * Show incoming file transfer request notification (high priority)
     * @param senderName - Name of the sender
     * @param fileName - Name of the file
     * @param fileSize - Human-readable file size
     */
    @PluginMethod()
    public void showIncomingTransferNotification(PluginCall call) {
        String senderName = call.getString("senderName", "Unknown");
        String fileName = call.getString("fileName", "file");
        String fileSize = call.getString("fileSize", "");
        
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.showIncomingTransferNotification(senderName, fileName, fileSize);
        }
        call.resolve();
    }
    
    /**
     * Dismiss the file transfer notification
     */
    @PluginMethod()
    public void dismissTransferNotification(PluginCall call) {
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.dismissTransferNotification();
        }
        call.resolve();
    }
    
    /**
     * Check if the background service is running
     */
    @PluginMethod()
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", BackgroundService.getInstance() != null);
        call.resolve(result);
    }
}
