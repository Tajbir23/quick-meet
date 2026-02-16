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
                // Launch app and signal answer
                launchApp(context, "answer_call");
                if (service != null) {
                    service.dismissCallNotification();
                    service.setPendingAction("answer_call");
                }
                break;

            case ACTION_DECLINE_CALL:
                // Signal decline without launching app
                if (service != null) {
                    service.dismissCallNotification();
                    service.setPendingAction("decline_call");
                }
                break;

            case ACTION_ACCEPT_TRANSFER:
                // Launch app and signal accept
                launchApp(context, "accept_transfer");
                if (service != null) {
                    service.dismissTransferNotification();
                    service.setPendingAction("accept_transfer");
                }
                break;

            case ACTION_REJECT_TRANSFER:
                // Signal reject without launching app
                if (service != null) {
                    service.dismissTransferNotification();
                    service.setPendingAction("reject_transfer");
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
