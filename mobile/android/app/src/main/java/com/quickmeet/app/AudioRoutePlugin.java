package com.quickmeet.app;

import android.content.Context;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AudioRoutePlugin — Capacitor Plugin for Speaker/Earpiece Toggle
 *
 * Allows JavaScript to switch between loudspeaker and earpiece
 * during calls on Android. Uses AudioManager.setSpeakerphoneOn().
 *
 * Methods:
 *   setSpeakerOn({ enabled: boolean })  → switches speaker on/off
 *   isSpeakerOn()                       → returns { enabled: boolean }
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {
    private static final String TAG = "QM-AudioRoute";

    /**
     * Enable or disable speakerphone
     */
    @PluginMethod()
    public void setSpeakerOn(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);

        try {
            AudioManager audioManager = (AudioManager) getContext()
                    .getSystemService(Context.AUDIO_SERVICE);

            if (audioManager == null) {
                call.reject("AudioManager not available");
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+ — use communication device API
                // setCommunicationDevice is more reliable on newer devices
                // but setSpeakerphoneOn still works and is simpler
                audioManager.setSpeakerphoneOn(enabled);
            } else {
                audioManager.setSpeakerphoneOn(enabled);
            }

            // Also set mode to MODE_IN_COMMUNICATION for best call audio routing
            if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }

            Log.i(TAG, "Speaker " + (enabled ? "ON" : "OFF"));

            JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Failed to set speaker", e);
            call.reject("Failed to set speaker: " + e.getMessage());
        }
    }

    /**
     * Check if speakerphone is currently enabled
     */
    @PluginMethod()
    public void isSpeakerOn(PluginCall call) {
        try {
            AudioManager audioManager = (AudioManager) getContext()
                    .getSystemService(Context.AUDIO_SERVICE);

            if (audioManager == null) {
                call.reject("AudioManager not available");
                return;
            }

            JSObject result = new JSObject();
            result.put("enabled", audioManager.isSpeakerphoneOn());
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Failed to check speaker state", e);
            call.reject("Failed: " + e.getMessage());
        }
    }
}
