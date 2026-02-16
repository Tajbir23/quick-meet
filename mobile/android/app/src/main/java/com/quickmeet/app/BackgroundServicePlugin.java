package com.quickmeet.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
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
 * - show call/transfer/message notifications
 * - handle notification action buttons (answer/decline/accept/reject)
 * - request battery optimization bypass
 */
@CapacitorPlugin(name = "BackgroundService")
public class BackgroundServicePlugin extends Plugin {
    private static final String TAG = "QM-BGPlugin";
    
    /**
     * Start the foreground service
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
     * Show incoming call notification with Answer/Decline buttons
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
     * Show ongoing call notification with End Call button
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
     * Dismiss the call notification (UI only — does NOT end the call)
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
     * End the call — dismiss notification + downgrade service + release audio focus
     */
    @PluginMethod()
    public void endCall(PluginCall call) {
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.endCall();
        }
        call.resolve();
    }
    
    /**
     * Show file transfer progress notification (persistent until 100%)
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
     * Show incoming file transfer request with Accept/Reject buttons
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
     * Show message notification
     */
    @PluginMethod()
    public void showMessageNotification(PluginCall call) {
        String senderName = call.getString("senderName", "Unknown");
        String message = call.getString("message", "");
        
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.showMessageNotification(senderName, message);
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
    
    /**
     * Set the JWT auth token + refresh token for native HTTP polling.
     * Called from JS when user logs in or token refreshes.
     * The refresh token allows the native service to renew the access token
     * when it expires (every 15 min), even when WebView JS is suspended.
     */
    @PluginMethod()
    public void setAuthToken(PluginCall call) {
        String token = call.getString("token", null);
        String refreshToken = call.getString("refreshToken", null);
        String serverUrl = call.getString("serverUrl", null);
        
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            service.setAuthToken(token, refreshToken, serverUrl);
        } else {
            // Save to SharedPreferences directly if service not running yet
            android.content.SharedPreferences prefs = getContext()
                .getSharedPreferences("QuickMeetPrefs", android.content.Context.MODE_PRIVATE);
            android.content.SharedPreferences.Editor editor = prefs.edit();
            if (token != null) editor.putString("auth_token", token);
            if (refreshToken != null) editor.putString("refresh_token", refreshToken);
            if (serverUrl != null) editor.putString("server_url", serverUrl);
            editor.apply();
        }
        
        Log.i(TAG, "Auth token " + (token != null ? "set" : "cleared") + " for polling"
            + (refreshToken != null ? " (+ refresh token)" : ""));
        call.resolve();
    }
    
    /**
     * Get and consume pending action from notification button presses
     * Returns: { action: "answer_call" | "decline_call" | "accept_transfer" | "reject_transfer" | null, data: "json" | null }
     */
    @PluginMethod()
    public void getPendingAction(PluginCall call) {
        JSObject result = new JSObject();
        BackgroundService service = BackgroundService.getInstance();
        if (service != null) {
            String action = service.consumePendingAction();
            String data = service.consumePendingActionData();
            result.put("action", action);
            result.put("data", data);
        } else {
            result.put("action", null);
            result.put("data", null);
        }
        call.resolve(result);
    }
    
    /**
     * Request battery optimization bypass
     * Opens system settings to disable battery optimization for this app
     */
    @PluginMethod()
    public void requestBatteryOptimization(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getContext().getPackageName())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                
                JSObject result = new JSObject();
                result.put("requested", true);
                call.resolve(result);
            } else {
                JSObject result = new JSObject();
                result.put("requested", false);
                result.put("alreadyExempt", true);
                call.resolve(result);
            }
        } catch (Exception e) {
            Log.e(TAG, "Battery optimization request failed", e);
            call.reject("Failed: " + e.getMessage());
        }
    }
    
    /**
     * Check if battery optimization is disabled for this app
     */
    @PluginMethod()
    public void isBatteryOptimizationDisabled(PluginCall call) {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
            boolean disabled = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            JSObject result = new JSObject();
            result.put("disabled", disabled);
            call.resolve(result);
        } catch (Exception e) {
            JSObject result = new JSObject();
            result.put("disabled", false);
            call.resolve(result);
        }
    }
}
