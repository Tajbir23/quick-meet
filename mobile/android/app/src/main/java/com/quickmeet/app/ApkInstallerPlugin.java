package com.quickmeet.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * ApkInstaller — Native Capacitor Plugin
 * 
 * Downloads an APK using Android's DownloadManager and opens
 * the system package installer for installation.
 * 
 * Uses FileProvider for Android 7+ content:// URI requirement.
 * Sends download progress events to the WebView.
 * 
 * JS usage:
 *   const { ApkInstaller } = window.Capacitor.Plugins;
 *   ApkInstaller.addListener('downloadProgress', (data) => { ... });
 *   await ApkInstaller.downloadAndInstall({ url, fileName });
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private static final String TAG = "ApkInstaller";
    private long downloadId = -1;
    private PluginCall pendingCall = null;
    private BroadcastReceiver downloadReceiver = null;
    private Thread progressThread = null;

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName", "quick-meet-update.apk");

        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        // Keep the call alive so we can resolve it after download completes
        call.setKeepAlive(true);
        pendingCall = call;

        try {
            Context context = getContext();
            DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);

            if (dm == null) {
                call.reject("DownloadManager not available");
                return;
            }

            // Remove old APK if exists
            File downloadDir = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS);
            File existingFile = new File(downloadDir, fileName);
            if (existingFile.exists()) {
                existingFile.delete();
                Log.d(TAG, "Deleted old APK: " + existingFile.getAbsolutePath());
            }

            // Build download request
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Quick Meet Update");
            request.setDescription("Downloading new version...");
            request.setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS, fileName);
            request.setMimeType("application/vnd.android.package-archive");

            // Register BroadcastReceiver for download completion
            cleanupReceiver();
            downloadReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context ctx, Intent intent) {
                    long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (id == downloadId) {
                        Log.d(TAG, "Download complete, id=" + id);
                        onDownloadComplete(ctx, dm, id, fileName);
                    }
                }
            };

            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                context.registerReceiver(downloadReceiver, filter);
            }

            // Start the download
            downloadId = dm.enqueue(request);
            Log.d(TAG, "Download started, id=" + downloadId + ", url=" + url);

            // Send initial progress event
            JSObject initial = new JSObject();
            initial.put("progress", 0);
            initial.put("status", "downloading");
            notifyListeners("downloadProgress", initial);

            // Start progress monitoring thread
            startProgressMonitor(dm);

        } catch (Exception e) {
            Log.e(TAG, "Download failed", e);
            call.reject("Download failed: " + e.getMessage());
            pendingCall = null;
        }
    }

    /**
     * Monitor download progress and send events to WebView
     */
    private void startProgressMonitor(DownloadManager dm) {
        // Stop any existing monitor
        if (progressThread != null && progressThread.isAlive()) {
            progressThread.interrupt();
        }

        progressThread = new Thread(() -> {
            boolean running = true;
            while (running && !Thread.currentThread().isInterrupted()) {
                try {
                    DownloadManager.Query query = new DownloadManager.Query();
                    query.setFilterById(downloadId);
                    Cursor cursor = dm.query(query);

                    if (cursor != null && cursor.moveToFirst()) {
                        int status = cursor.getInt(
                                cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long bytesDownloaded = cursor.getLong(
                                cursor.getColumnIndexOrThrow(
                                        DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long bytesTotal = cursor.getLong(
                                cursor.getColumnIndexOrThrow(
                                        DownloadManager.COLUMN_TOTAL_SIZE_BYTES));

                        if (status == DownloadManager.STATUS_SUCCESSFUL
                                || status == DownloadManager.STATUS_FAILED) {
                            running = false;
                        }

                        if (bytesTotal > 0) {
                            int progress = (int) ((bytesDownloaded * 100L) / bytesTotal);
                            JSObject data = new JSObject();
                            data.put("progress", progress);
                            data.put("bytesDownloaded", bytesDownloaded);
                            data.put("bytesTotal", bytesTotal);
                            data.put("status", statusToString(status));
                            notifyListeners("downloadProgress", data);
                        }

                        cursor.close();
                    } else {
                        if (cursor != null) cursor.close();
                        running = false;
                    }

                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    running = false;
                } catch (Exception e) {
                    Log.w(TAG, "Progress monitor error", e);
                    running = false;
                }
            }
        });
        progressThread.setDaemon(true);
        progressThread.start();
    }

    /**
     * Called when DownloadManager finishes the download
     */
    private void onDownloadComplete(Context context, DownloadManager dm, long id, String fileName) {
        cleanupReceiver();

        DownloadManager.Query query = new DownloadManager.Query();
        query.setFilterById(id);
        Cursor cursor = dm.query(query);

        if (cursor != null && cursor.moveToFirst()) {
            int status = cursor.getInt(
                    cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));

            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                cursor.close();

                // Find the downloaded file
                File downloadDir = Environment.getExternalStoragePublicDirectory(
                        Environment.DIRECTORY_DOWNLOADS);
                File apkFile = new File(downloadDir, fileName);

                if (apkFile.exists()) {
                    Log.d(TAG, "APK file found: " + apkFile.getAbsolutePath()
                            + " (" + apkFile.length() + " bytes)");
                    try {
                        installApk(context, apkFile);

                        // Notify JS of success
                        JSObject progress = new JSObject();
                        progress.put("progress", 100);
                        progress.put("status", "installing");
                        notifyListeners("downloadProgress", progress);

                        if (pendingCall != null) {
                            JSObject result = new JSObject();
                            result.put("success", true);
                            result.put("filePath", apkFile.getAbsolutePath());
                            result.put("message", "Install dialog opened");
                            pendingCall.resolve(result);
                            pendingCall = null;
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Install failed", e);
                        if (pendingCall != null) {
                            pendingCall.reject("Install failed: " + e.getMessage());
                            pendingCall = null;
                        }
                    }
                } else {
                    Log.e(TAG, "APK file not found at: " + apkFile.getAbsolutePath());
                    if (pendingCall != null) {
                        pendingCall.reject("Downloaded APK file not found");
                        pendingCall = null;
                    }
                }
            } else {
                cursor.close();
                Log.e(TAG, "Download failed with status: " + status);

                JSObject progress = new JSObject();
                progress.put("progress", 0);
                progress.put("status", "failed");
                notifyListeners("downloadProgress", progress);

                if (pendingCall != null) {
                    pendingCall.reject("Download failed (status=" + status + ")");
                    pendingCall = null;
                }
            }
        } else {
            if (cursor != null) cursor.close();
            if (pendingCall != null) {
                pendingCall.reject("Download query returned no results");
                pendingCall = null;
            }
        }
    }

    /**
     * Open APK with system package installer using FileProvider
     */
    private void installApk(Context context, File apkFile) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            // Android 7+ requires content:// URI via FileProvider
            Uri contentUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    apkFile);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Log.d(TAG, "Opening APK with FileProvider URI: " + contentUri);
        } else {
            // Android 6 and below can use file:// URI
            Uri fileUri = Uri.fromFile(apkFile);
            intent.setDataAndType(fileUri, "application/vnd.android.package-archive");
            Log.d(TAG, "Opening APK with file URI: " + fileUri);
        }

        context.startActivity(intent);
        Log.d(TAG, "System installer launched");
    }

    /**
     * Install an APK from a known file path (if already downloaded)
     */
    @PluginMethod
    public void installFromPath(PluginCall call) {
        String filePath = call.getString("filePath");
        if (filePath == null || filePath.isEmpty()) {
            call.reject("filePath is required");
            return;
        }

        try {
            // Handle file:// URI or plain path
            File file;
            if (filePath.startsWith("file://")) {
                file = new File(Uri.parse(filePath).getPath());
            } else if (filePath.startsWith("content://")) {
                // Can't convert content:// to File; reject
                call.reject("content:// URIs not supported, use a file path");
                return;
            } else {
                file = new File(filePath);
            }

            if (!file.exists()) {
                call.reject("File not found: " + filePath);
                return;
            }

            installApk(getContext(), file);

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("message", "Install dialog opened");
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "installFromPath failed", e);
            call.reject("Install failed: " + e.getMessage());
        }
    }

    /**
     * Cleanup broadcast receiver
     */
    private void cleanupReceiver() {
        if (downloadReceiver != null) {
            try {
                getContext().unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {
            }
            downloadReceiver = null;
        }
    }

    private String statusToString(int status) {
        switch (status) {
            case DownloadManager.STATUS_PENDING:
                return "pending";
            case DownloadManager.STATUS_RUNNING:
                return "downloading";
            case DownloadManager.STATUS_PAUSED:
                return "paused";
            case DownloadManager.STATUS_SUCCESSFUL:
                return "complete";
            case DownloadManager.STATUS_FAILED:
                return "failed";
            default:
                return "unknown";
        }
    }

    @Override
    protected void handleOnDestroy() {
        cleanupReceiver();
        if (progressThread != null) {
            progressThread.interrupt();
        }
        super.handleOnDestroy();
    }
}
