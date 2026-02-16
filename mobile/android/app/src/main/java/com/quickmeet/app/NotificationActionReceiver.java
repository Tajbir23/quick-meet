package com.quickmeet.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Handles notification action button presses:
 * - Answer/Decline calls from notification
 * - Accept/Reject file transfers from notification
 * 
 * These actions communicate with the WebView via the BackgroundService
 * which forwards events to the Capacitor plugin bridge.
 */
public class NotificationActionReceiver extends BroadcastReceiver {
    private static final String TAG = "QM-NotifAction";

    public static final String ACTION_ANSWER_CALL = "com.quickmeet.ACTION_ANSWER_CALL";
    public static final String ACTION_DECLINE_CALL = "com.quickmeet.ACTION_DECLINE_CALL";
    public static final String ACTION_ACCEPT_TRANSFER = "com.quickmeet.ACTION_ACCEPT_TRANSFER";
    public static final String ACTION_REJECT_TRANSFER = "com.quickmeet.ACTION_REJECT_TRANSFER";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        Log.i(TAG, "Notification action received: " + action);

        BackgroundService service = BackgroundService.getInstance();

        switch (action) {
            case ACTION_ANSWER_CALL:
                // NOTE: On Android 12+, the Answer button now uses PendingIntent.getActivity()
                // and goes directly to MainActivity.onNewIntent() to avoid trampoline restriction.
                // This BroadcastReceiver case is kept as a fallback for older Android versions.
                if (service != null) {
                    service.dismissCallNotification();
                    service.setPendingAction("answer_call");
                }
                break;

            case ACTION_DECLINE_CALL:
                // Signal decline — actually END the call (downgrade service + release audio)
                if (service != null) {
                    service.endCall();
                    service.setPendingAction("decline_call");
                }
                break;

            case ACTION_ACCEPT_TRANSFER:
                // NOTE: On Android 12+, the Accept button now uses PendingIntent.getActivity()
                // and goes directly to MainActivity.onNewIntent() to avoid trampoline restriction.
                // This BroadcastReceiver case is kept as a fallback for older Android versions.
                if (service != null) {
                    service.dismissTransferNotification();
                    // Read stored transfer data
                    android.content.SharedPreferences prefs = context
                        .getSharedPreferences("QuickMeetPrefs", android.content.Context.MODE_PRIVATE);
                    String transferData = prefs.getString("last_transfer_data", null);
                    service.setPendingAction("accept_transfer", transferData);
                }
                launchApp(context, "accept_transfer");
                break;

            case ACTION_REJECT_TRANSFER:
                // Signal reject without launching app
                if (service != null) {
                    service.dismissTransferNotification();
                    // Read stored transfer data for reject
                    android.content.SharedPreferences rejectPrefs = context
                        .getSharedPreferences("QuickMeetPrefs", android.content.Context.MODE_PRIVATE);
                    String rejectTransferData = rejectPrefs.getString("last_transfer_data", null);
                    service.setPendingAction("reject_transfer", rejectTransferData);
                }
                break;

            default:
                Log.w(TAG, "Unknown action: " + action);
                break;
        }
    }

    private void launchApp(Context context, String actionType) {
        try {
            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launchIntent.putExtra("notification_action", actionType);
            context.startActivity(launchIntent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch app: " + e.getMessage());
        }
    }
}
