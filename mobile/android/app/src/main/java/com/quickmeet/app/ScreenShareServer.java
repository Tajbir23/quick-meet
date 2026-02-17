package com.quickmeet.app;

import android.util.Log;

import java.io.InputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Minimal WebSocket server for streaming screen capture frames.
 *
 * Runs on localhost (127.0.0.1) only — not accessible from network.
 * Handles a single client connection.
 * Sends raw binary JPEG frames at high throughput without
 * the overhead of Capacitor bridge + base64 encoding.
 *
 * Architecture:
 * - Capture thread calls queueFrame() with raw JPEG bytes (non-blocking, O(1))
 * - Sender thread drains the latest frame and sends via WebSocket binary frame
 * - If capture is faster than sending, intermediate frames are dropped
 *   (only the latest frame matters for real-time streaming)
 */
public class ScreenShareServer {

    private static final String TAG = "QM-SSServer";

    private ServerSocket serverSocket;
    private Socket clientSocket;
    private OutputStream clientOut;
    private volatile boolean running = false;
    private int port;
    private Thread acceptThread;
    private Thread senderThread;

    // Latest frame — atomic swap: capture thread writes, sender thread reads
    private final AtomicReference<byte[]> pendingFrame = new AtomicReference<>(null);

    /**
     * Start the WebSocket server on a random available localhost port.
     * @return the port number
     */
    public int start() throws IOException {
        serverSocket = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        running = true;

        // Accept client connection in background
        acceptThread = new Thread(() -> {
            try {
                Log.i(TAG, "Waiting for WebSocket client on port " + port);
                clientSocket = serverSocket.accept();
                clientSocket.setTcpNoDelay(true); // Disable Nagle's for low latency

                if (performHandshake()) {
                    Log.i(TAG, "WebSocket client connected on port " + port);
                    startSenderLoop();
                } else {
                    Log.e(TAG, "WebSocket handshake failed");
                }
            } catch (Exception e) {
                if (running) Log.e(TAG, "Accept/handshake error: " + e.getMessage());
            }
        }, "QM-WS-Accept");
        acceptThread.setDaemon(true);
        acceptThread.start();

        Log.i(TAG, "WebSocket server started on port " + port);
        return port;
    }

    /**
     * Perform the WebSocket upgrade handshake (RFC 6455).
     */
    private boolean performHandshake() throws Exception {
        InputStream in = clientSocket.getInputStream();

        // Read HTTP headers character by character until \r\n\r\n
        StringBuilder headers = new StringBuilder(512);
        int b;
        while ((b = in.read()) != -1) {
            headers.append((char) b);
            int len = headers.length();
            if (len >= 4 &&
                headers.charAt(len - 4) == '\r' &&
                headers.charAt(len - 3) == '\n' &&
                headers.charAt(len - 2) == '\r' &&
                headers.charAt(len - 1) == '\n') {
                break;
            }
            if (len > 4096) throw new Exception("HTTP headers too large");
        }

        // Extract Sec-WebSocket-Key
        String key = null;
        for (String line : headers.toString().split("\r\n")) {
            if (line.toLowerCase().startsWith("sec-websocket-key:")) {
                key = line.substring(18).trim();
                break;
            }
        }

        if (key == null) {
            Log.e(TAG, "Missing Sec-WebSocket-Key");
            return false;
        }

        // Compute accept hash per RFC 6455
        String magic = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] sha1 = md.digest(magic.getBytes("UTF-8"));
        String accept = android.util.Base64.encodeToString(sha1, android.util.Base64.NO_WRAP);

        // Send 101 Switching Protocols response
        clientOut = clientSocket.getOutputStream();
        String response = "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        clientOut.write(response.getBytes("UTF-8"));
        clientOut.flush();

        return true;
    }

    /**
     * Start the sender loop that drains pendingFrame and sends to client.
     * Runs in a dedicated thread to avoid blocking the capture thread.
     */
    private void startSenderLoop() {
        senderThread = new Thread(() -> {
            Log.i(TAG, "Sender loop started");
            while (running && clientOut != null) {
                byte[] frame = pendingFrame.getAndSet(null);
                if (frame != null) {
                    if (!sendBinaryFrame(frame)) {
                        break; // Client disconnected
                    }
                } else {
                    // No frame pending — brief sleep to avoid busy-wait
                    try { Thread.sleep(1); } catch (InterruptedException e) { break; }
                }
            }
            Log.i(TAG, "Sender loop ended");
        }, "QM-WS-Sender");
        senderThread.setDaemon(true);
        senderThread.start();
    }

    /**
     * Queue a frame for sending. Non-blocking, O(1).
     * If a previous frame hasn't been sent yet, it is replaced (dropped).
     * Only the latest frame matters for real-time streaming.
     */
    public void queueFrame(byte[] jpegData) {
        pendingFrame.set(jpegData);
    }

    /**
     * Send a WebSocket binary frame (opcode 0x2, FIN bit set).
     * Server→client frames are never masked (per RFC 6455).
     * @return false if the client disconnected
     */
    private boolean sendBinaryFrame(byte[] data) {
        if (clientOut == null) return false;

        try {
            int len = data.length;

            // FIN + binary opcode
            clientOut.write(0x82);

            // Payload length
            if (len < 126) {
                clientOut.write(len);
            } else if (len < 65536) {
                clientOut.write(126);
                clientOut.write((len >> 8) & 0xFF);
                clientOut.write(len & 0xFF);
            } else {
                clientOut.write(127);
                for (int i = 7; i >= 0; i--) {
                    clientOut.write((int) ((len >> (8 * i)) & 0xFF));
                }
            }

            // Payload data (raw JPEG bytes)
            clientOut.write(data);
            clientOut.flush();
            return true;
        } catch (IOException e) {
            Log.w(TAG, "Send error (client gone): " + e.getMessage());
            clientOut = null;
            return false;
        }
    }

    /**
     * Stop the server and release all resources.
     */
    public void stop() {
        running = false;
        pendingFrame.set(null);

        try { if (senderThread != null) senderThread.interrupt(); } catch (Exception e) {}
        try { if (clientSocket != null) clientSocket.close(); } catch (Exception e) {}
        try { if (serverSocket != null) serverSocket.close(); } catch (Exception e) {}

        clientOut = null;
        clientSocket = null;
        serverSocket = null;
        senderThread = null;
        acceptThread = null;

        Log.i(TAG, "WebSocket server stopped");
    }

    public int getPort() {
        return port;
    }

    public boolean isClientConnected() {
        return clientOut != null && running;
    }
}
