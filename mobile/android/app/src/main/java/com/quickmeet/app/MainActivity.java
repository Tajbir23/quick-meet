package com.quickmeet.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;
import android.util.Log;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Custom MainActivity for Quick Meet
 * 
 * Handles:
 * - WebRTC camera/microphone permission grants at the WebView level
 * - Runtime permission requests for Android 6.0+
 * - Notification permission for Android 13+
 * - **IMPORTANT**: Prevents WebView renderer from being suspended during active calls
 *   by setting RENDERER_PRIORITY_IMPORTANT when the activity goes to background
 * 
 * IMPORTANT: We do NOT replace the WebChromeClient. Capacitor's built-in
 * BridgeWebChromeClient handles file chooser (input[type=file]) and other
 * critical WebView behaviors. Replacing it breaks file selection on mobile.
 * Instead, we configure WebView settings and let Capacitor handle the rest.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "QM-MainActivity";
    private ActivityResultLauncher<String[]> permissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom Capacitor plugins
        registerPlugin(BackgroundServicePlugin.class);
        registerPlugin(ApkInstallerPlugin.class);

        super.onCreate(savedInstanceState);

        // Register permission launcher
        permissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestMultiplePermissions(),
            results -> {
                boolean allGranted = true;
                for (Map.Entry<String, Boolean> entry : results.entrySet()) {
                    if (!entry.getValue()) {
                        allGranted = false;
                    }
                }
                if (!allGranted) {
                    Toast.makeText(this, "Some permissions were denied. Camera/mic may not work.", Toast.LENGTH_LONG).show();
                }
            }
        );

        // Request essential permissions
        requestEssentialPermissions();
    }

    @Override
    public void onStart() {
        super.onStart();

        // Configure WebView settings for WebRTC — but do NOT replace the WebChromeClient!
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setDatabaseEnabled(true);
            webView.getSettings().setAllowFileAccess(true);
            webView.getSettings().setAllowContentAccess(true);
            
            // Set renderer priority to IMPORTANT so Android doesn't kill/suspend 
            // the WebView renderer process when the app goes to the background.
            // This is critical for WebRTC audio/video calls — the renderer process
            // handles all WebRTC media processing (audio encoding/decoding).
            // bindRenderer=false means: keep this priority even when not bound to a visible view.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setRendererPriorityPolicy(
                    WebView.RENDERER_PRIORITY_IMPORTANT, 
                    false  // waivedWhenNotVisible=false → keep important even in background
                );
                Log.i(TAG, "WebView renderer priority set to IMPORTANT (persistent)");
            }
        }
    }

    /**
     * When the app goes to the background (minimized, home button, screen off),
     * Android would normally throttle or suspend the WebView renderer.
     * We override onStop to ensure the WebView stays alive for calls.
     * 
     * The BackgroundService with phoneCall+microphone foreground service type
     * handles the OS-level keep-alive, while the renderer priority policy
     * set in onStart() prevents the WebView process from being killed.
     */
    @Override
    protected void onStop() {
        // Check if there's an active call — if so, keep the WebView alive
        BackgroundService bgService = BackgroundService.getInstance();
        if (bgService != null) {
            Log.i(TAG, "onStop — BackgroundService is running, WebView renderer stays IMPORTANT");
        }
        super.onStop();
    }

    private void requestEssentialPermissions() {
        List<String> permissionsToRequest = new ArrayList<>();

        // Camera
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.CAMERA);
        }

        // Microphone
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.RECORD_AUDIO);
        }

        // Notifications (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        // Bluetooth (Android 12+) for audio routing
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        }

        if (!permissionsToRequest.isEmpty()) {
            permissionLauncher.launch(permissionsToRequest.toArray(new String[0]));
        }
    }
}
