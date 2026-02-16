package com.quickmeet.app;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.firebase.messaging.FirebaseMessaging;

/**
 * FirebaseMessagingPlugin — Capacitor bridge for FCM
 * 
 * Exposes FCM token retrieval and notification listeners to the WebView.
 * 
 * JS usage:
 *   const { FirebaseMessaging } = window.Capacitor.Plugins;
 *   const { token } = await FirebaseMessaging.getToken();
 *   FirebaseMessaging.addListener('tokenReceived', (data) => { ... });
 *   FirebaseMessaging.addListener('pushNotificationReceived', (data) => { ... });
 *   FirebaseMessaging.addListener('pushNotificationActionPerformed', (data) => { ... });
 */
@CapacitorPlugin(name = "FirebaseMessaging")
public class FirebaseMessagingPlugin extends Plugin {

    private static final String TAG = "FirebaseMessaging";
    private static FirebaseMessagingPlugin instance;

    @Override
    public void load() {
        instance = this;
        Log.d(TAG, "FirebaseMessagingPlugin loaded");
    }

    /**
     * Get the current FCM registration token
     */
    @PluginMethod
    public void getToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful() && task.getResult() != null) {
                        String token = task.getResult();
                        Log.d(TAG, "FCM token: " + token.substring(0, 20) + "...");

                        JSObject result = new JSObject();
                        result.put("token", token);
                        call.resolve(result);
                    } else {
                        Log.e(TAG, "Failed to get FCM token", task.getException());
                        call.reject("Failed to get FCM token: " +
                            (task.getException() != null ? task.getException().getMessage() : "unknown error"));
                    }
                });
        } catch (Exception e) {
            Log.e(TAG, "getToken error", e);
            call.reject("FCM error: " + e.getMessage());
        }
    }

    /**
     * Delete the FCM token (for logout)
     */
    @PluginMethod
    public void deleteToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().deleteToken()
                .addOnCompleteListener(task -> {
                    if (task.isSuccessful()) {
                        JSObject result = new JSObject();
                        result.put("success", true);
                        call.resolve(result);
                    } else {
                        call.reject("Failed to delete token");
                    }
                });
        } catch (Exception e) {
            call.reject("Error: " + e.getMessage());
        }
    }

    /**
     * Called by QuickMeetMessagingService when a new token is generated
     */
    public static void onNewToken(String token) {
        if (instance != null) {
            JSObject data = new JSObject();
            data.put("token", token);
            instance.notifyListeners("tokenReceived", data);
            Log.d(TAG, "Token refresh notified to JS");
        }
    }

    /**
     * Called by QuickMeetMessagingService when a push notification arrives
     */
    public static void onMessageReceived(JSObject data) {
        if (instance != null) {
            instance.notifyListeners("pushNotificationReceived", data);
            Log.d(TAG, "Push notification forwarded to JS");
        }
    }

    /**
     * Called when user taps on a notification
     */
    public static void onNotificationAction(JSObject data) {
        if (instance != null) {
            JSObject actionData = new JSObject();
            JSObject notification = new JSObject();
            notification.put("data", data);
            actionData.put("notification", notification);
            instance.notifyListeners("pushNotificationActionPerformed", actionData);
        }
    }
}
