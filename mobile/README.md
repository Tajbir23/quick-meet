# Quick Meet — Android App Setup (Capacitor)

## Prerequisites
- Node.js 18+
- Android Studio (with SDK 33+)
- Java JDK 17+
- Client app already built (`client/dist`)

## Quick Start

```bash
# 1. Install client dependencies & build
cd client
npm install
npm run build

# 2. Install mobile dependencies
cd ../mobile
npm install

# 3. Add Android platform
npx cap add android

# 4. Sync web app to Android project
npx cap sync android

# 5. Open in Android Studio
npx cap open android
```

## One-Command Build
```bash
cd mobile
npm run android
```
This builds the client, syncs to Android, and opens Android Studio.

## Running on Device/Emulator

### From Android Studio:
1. `npm run android` to open the project
2. Select a device/emulator in Android Studio
3. Click Run (green play button)

### From command line:
```bash
# Run on connected device
npx cap run android

# Run on specific device
npx cap run android --target=<device-id>
```

## Required Android Permissions
The following permissions are automatically added by Capacitor plugins:

```xml
<!-- In android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

### Additional permissions for P2P file transfer:
Add these to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

## WebRTC on Android
Capacitor's WebView supports WebRTC natively (Chromium-based).
No additional plugins needed for:
- Camera/microphone access
- WebRTC PeerConnection
- WebRTC DataChannel (P2P file transfer)

## P2P File Transfer on Android
- **Chunk size**: Automatically reduced to 16KB on mobile (vs 64KB on desktop)
- **Buffer threshold**: 512KB on mobile (vs 2MB on desktop)
- This prevents memory pressure and crashes on mobile devices
- Files are saved to device Downloads folder via Capacitor Filesystem

## Self-Signed SSL on Android
For development with self-signed certificates, you may need to:

1. Edit `android/app/src/main/java/.../MainActivity.java`:
```java
// In the onCreate or init method
// WebView already handles this through Capacitor config
```

2. Or add the server certificate to Android trust store.

## Building APK / App Bundle

### Debug APK:
In Android Studio: Build → Build Bundle(s) / APK(s) → Build APK(s)

### Release AAB (for Play Store):
1. Generate a signing key
2. In Android Studio: Build → Generate Signed Bundle
3. Upload to Google Play Console

## Environment Configuration
The server URL is set in `client/.env`:
```
VITE_SERVER_URL=https://your-server-ip:5000
```
Build the client with this URL before syncing to Android.

## Troubleshooting

### Camera/mic not working
- Ensure permissions are granted in Android Settings
- Check that the server uses HTTPS (required for WebRTC)

### File transfer crashes on large files
- The app uses 16KB chunks on mobile specifically to prevent this
- If still occurring, check available storage space

### WebSocket connection fails
- Ensure the server IP is accessible from the Android device
- Check firewall rules (port 5000)
- Accept the self-signed certificate by visiting the server URL in the device browser first
