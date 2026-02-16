package com.quickmeet.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.Toast;

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
 * 
 * IMPORTANT: We do NOT replace the WebChromeClient. Capacitor's built-in
 * BridgeWebChromeClient handles file chooser (input[type=file]) and other
 * critical WebView behaviors. Replacing it breaks file selection on mobile.
 * Instead, we configure WebView settings and let Capacitor handle the rest.
 */
public class MainActivity extends BridgeActivity {

    private ActivityResultLauncher<String[]> permissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom Capacitor plugins
        registerPlugin(BackgroundServicePlugin.class);
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(FirebaseMessagingPlugin.class);

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
        // Capacitor's BridgeWebChromeClient handles:
        //   - onShowFileChooser (input[type=file])
        //   - onPermissionRequest (camera/mic for WebRTC)
        //   - onGeolocationPermissionsShowPrompt
        //   - Console messages, etc.
        // Replacing it with a plain WebChromeClient breaks all of those.
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setDatabaseEnabled(true);
            webView.getSettings().setAllowFileAccess(true);
            webView.getSettings().setAllowContentAccess(true);
        }
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
