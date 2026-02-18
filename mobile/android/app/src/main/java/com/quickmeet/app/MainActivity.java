package com.quickmeet.app;

import android.Manifest;
import android.app.PictureInPictureParams;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
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
 * - **CRITICAL**: Prevents WebView from being paused/frozen during active calls.
 *   When Android backgrounds the Activity, it calls onPause() → onStop() which
 *   pauses the WebView's JS execution and freezes WebRTC audio/video.
 *   We counteract this by immediately calling webView.onResume() + resumeTimers()
 *   after super.onPause()/onStop() when a call is active, so WebRTC keeps running.
 * 
 * IMPORTANT: We do NOT replace the WebChromeClient. Capacitor's built-in
 * BridgeWebChromeClient handles file chooser (input[type=file]) and other
 * critical WebView behaviors. Replacing it breaks file selection on mobile.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "QM-MainActivity";
    private ActivityResultLauncher<String[]> permissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom Capacitor plugins
        registerPlugin(BackgroundServicePlugin.class);
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ScreenCapturePlugin.class);

        super.onCreate(savedInstanceState);

        // Handle notification actions on cold start
        handleNotificationAction(getIntent());

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

        // Configure WebView settings for WebRTC
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setDatabaseEnabled(true);
            webView.getSettings().setAllowFileAccess(true);
            webView.getSettings().setAllowContentAccess(true);
            
            // Set renderer priority to IMPORTANT so Android doesn't kill
            // the WebView renderer process when in background.
            // waivedWhenNotVisible=false → keep important even in background
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                webView.setRendererPriorityPolicy(
                    WebView.RENDERER_PRIORITY_IMPORTANT, 
                    false
                );
                Log.i(TAG, "WebView renderer priority set to IMPORTANT (persistent)");
            }
        }
    }

    /**
     * CRITICAL: When Android backgrounds the Activity, super.onPause() causes
     * Capacitor's Bridge to call webView.onPause() which FREEZES:
     *  - All JavaScript execution (timers, promises, callbacks)
     *  - All WebRTC audio/video processing  
     *  - All network requests from the WebView
     * 
     * During an active call, we MUST immediately "undo" this pause by calling
     * webView.onResume() + webView.resumeTimers() right after super.onPause().
     * This allows the WebView to continue processing WebRTC audio/video.
     *
     * IMPORTANT: Do NOT resume WebView if we're entering PiP — PiP keeps the
     * Activity in a "paused" but visible state. The WebView stays active in PiP
     * on its own because the window is still visible.
     */
    @Override
    public void onPause() {
        super.onPause();
        
        // In PiP mode, the Activity is still visible — WebView stays active
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && isInPictureInPictureMode()) {
            Log.i(TAG, "onPause — in PiP mode, WebView stays active");
            return;
        }
        
        if (isCallActive()) {
            // Immediately resume the WebView after system paused it
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.onResume();
                webView.resumeTimers();
                Log.i(TAG, "onPause — CALL ACTIVE: WebView resumed to keep WebRTC audio alive");
            }
        } else {
            Log.d(TAG, "onPause — no active call, WebView paused normally");
        }
    }

    /**
     * Same as onPause — onStop can further freeze the WebView.
     * We resume it again to ensure WebRTC stays active.
     */
    @Override
    public void onStop() {
        super.onStop();
        
        if (isCallActive()) {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                webView.onResume();
                webView.resumeTimers();
                Log.i(TAG, "onStop — CALL ACTIVE: WebView resumed to keep WebRTC audio alive");
            }
        } else {
            Log.d(TAG, "onStop — no active call");
        }
    }

    /**
     * When the app comes back to foreground, ensure WebView is fully resumed.
     */
    @Override
    public void onResume() {
        super.onResume();
        
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
            Log.d(TAG, "onResume — WebView fully resumed");
        }
    }

    /**
     * Handle notification action intents when Activity is already running.
     * Android 12+ blocks notification trampolining (BroadcastReceiver → startActivity()),
     * so notification Answer button uses PendingIntent.getActivity() directly.
     * This method is called when the Activity receives a new intent while running.
     */
    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        handleNotificationAction(intent);
    }

    /**
     * Check if an intent contains a notification action and process it.
     * Called from both onCreate (cold start) and onNewIntent (warm start).
     */
    private void handleNotificationAction(android.content.Intent intent) {
        if (intent == null) return;
        
        String action = intent.getStringExtra("notification_action");
        if (action == null) return;
        
        Log.i(TAG, "Notification action received via Activity intent: " + action);
        
        BackgroundService service = BackgroundService.getInstance();
        if (service == null) {
            Log.w(TAG, "BackgroundService not running — cannot process action: " + action);
            return;
        }
        
        switch (action) {
            case "answer_call":
                service.dismissCallNotification(); // UI only, keeps audio focus
                service.setPendingAction("answer_call");
                Log.i(TAG, "Answer action processed — pending action set");
                break;
            case "accept_transfer":
                service.dismissTransferNotification();
                // Read stored transfer data and pass it with the pending action
                android.content.SharedPreferences prefs = getSharedPreferences("QuickMeetPrefs", MODE_PRIVATE);
                String transferData = prefs.getString("last_transfer_data", null);
                service.setPendingAction("accept_transfer", transferData);
                Log.i(TAG, "Accept transfer action processed — pending action set");
                break;
            default:
                Log.d(TAG, "Unknown notification action: " + action);
                break;
        }
        
        // Clear the action from the intent to prevent re-processing
        intent.removeExtra("notification_action");
    }

    /**
     * Check if there's an active call via BackgroundService.
     * Returns true if the BackgroundService is running and has an active call.
     */
    private boolean isCallActive() {
        BackgroundService bgService = BackgroundService.getInstance();
        return bgService != null && bgService.isCallActive();
    }

    // ============================================
    // PICTURE-IN-PICTURE (PiP) — Floating Window
    // ============================================

    /**
     * Auto-enter PiP when user presses Home during an active call.
     * onUserLeaveHint() is called when the user navigates away (Home button,
     * recent apps, etc.) — but NOT when another activity appears on top.
     */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (isCallActive()) {
            enterPipMode();
        }
    }

    /**
     * Enter Picture-in-Picture mode for active video/group calls.
     * The Activity shrinks to a small floating window on Android 8.0+.
     * WebRTC continues because the Activity is still "visible" in PiP.
     */
    private void enterPipMode() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Log.w(TAG, "PiP requires Android 8.0+ (API 26)");
            return;
        }

        try {
            // 16:9 aspect ratio for the PiP window (landscape video)
            Rational aspectRatio = new Rational(16, 9);

            PictureInPictureParams.Builder pipBuilder = new PictureInPictureParams.Builder()
                    .setAspectRatio(aspectRatio);

            // Android 12+ (API 31): auto-enter PiP when going home
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                pipBuilder.setAutoEnterEnabled(true);
                pipBuilder.setSeamlessResizeEnabled(true);
            }

            enterPictureInPictureMode(pipBuilder.build());
            Log.i(TAG, "Entered PiP mode");
        } catch (Exception e) {
            Log.e(TAG, "Failed to enter PiP mode: " + e.getMessage());
        }
    }

    /**
     * Called when PiP mode changes (enter or exit).
     * Notifies JavaScript so the UI can show a simplified PiP layout.
     */
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode,
                                               Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        Log.i(TAG, "PiP mode changed: " + isInPictureInPictureMode);

        // Notify JavaScript about PiP state change
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            String js = "window.dispatchEvent(new CustomEvent('pipModeChanged', { detail: { isInPipMode: "
                    + isInPictureInPictureMode + " } }));";
            webView.post(() -> webView.evaluateJavascript(js, null));

            // Ensure WebView stays active during PiP
            if (isInPictureInPictureMode) {
                webView.onResume();
                webView.resumeTimers();
            }
        }
    }

    /**
     * Update PiP params so Android 12+ auto-enters PiP on home press.
     * Call this whenever a call starts to enable auto-PiP.
     */
    public void updatePipParams(boolean callActive) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;

        try {
            PictureInPictureParams.Builder pipBuilder = new PictureInPictureParams.Builder()
                    .setAspectRatio(new Rational(16, 9))
                    .setAutoEnterEnabled(callActive)
                    .setSeamlessResizeEnabled(true);
            setPictureInPictureParams(pipBuilder.build());
            Log.d(TAG, "PiP params updated — autoEnter: " + callActive);
        } catch (Exception e) {
            Log.w(TAG, "Failed to update PiP params: " + e.getMessage());
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
