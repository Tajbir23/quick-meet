/**
 * ============================================
 * IncomingFileTransfer — Full-screen modal for incoming P2P file share
 * ============================================
 * 
 * Shows a stylish modal when someone sends a file.
 * - Plays notification sound
 * - Shows sender name, file info, size
 * - Accept / Reject buttons
 * - Native OS notification popup (if permission granted)
 * - Electron: native notification on PC
 * - Works on both desktop app and web/mobile
 */

import { useEffect, useRef } from 'react';
import { Download, X, FileIcon, Film, Image, Music, FileText, Archive, HardDrive, AlertTriangle } from 'lucide-react';
import useFileTransferStore from '../../store/useFileTransferStore';
import { getInitials, stringToColor, playNotificationSound } from '../../utils/helpers';
import { canReceiveLargeFiles, getMaxReceiveSize, getPlatformCapability } from '../../services/p2pFileTransfer';

/**
 * Format bytes to human-readable
 */
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
};

/**
 * Get file icon based on mime type
 */
const getFileIcon = (fileName, mimeType) => {
  const ext = fileName?.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'avi', 'mkv', 'mov', 'webm'].includes(ext) || mimeType?.startsWith('video/')) {
    return <Film size={28} className="text-purple-400" />;
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimeType?.startsWith('image/')) {
    return <Image size={28} className="text-blue-400" />;
  }
  if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'].includes(ext) || mimeType?.startsWith('audio/')) {
    return <Music size={28} className="text-pink-400" />;
  }
  if (['pdf', 'doc', 'docx', 'txt', 'xlsx', 'pptx', 'csv'].includes(ext)) {
    return <FileText size={28} className="text-orange-400" />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return <Archive size={28} className="text-yellow-400" />;
  }
  if (['iso', 'img', 'dmg'].includes(ext)) {
    return <HardDrive size={28} className="text-emerald-400" />;
  }
  return <FileIcon size={28} className="text-dark-300" />;
};

/**
 * Single incoming file request card
 */
const FileRequestCard = ({ request, onAccept, onReject }) => {
  const senderName = request.senderName || 'Unknown User';
  const avatarColor = stringToColor(senderName);

  // Check if this file exceeds the platform's receive capacity
  const maxSize = getMaxReceiveSize();
  const fileTooLarge = request.fileSize > maxSize;
  const capability = getPlatformCapability();
  const isMemoryOnly = capability === 'browser-memory';

  return (
    <div className="bg-dark-800 rounded-3xl p-6 md:p-8 shadow-2xl max-w-sm w-full animate-bounce-in border border-dark-700/50">
      {/* Sender avatar with pulse */}
      <div className="flex flex-col items-center mb-6">
        <div className="relative mb-4">
          {/* Pulse rings */}
          <div className="absolute inset-0 rounded-full bg-primary-400/10 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute -inset-3 rounded-full border-2 border-primary-400/10 animate-ping" style={{ animationDuration: '3s' }} />
          
          <div
            className="relative w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-2xl md:text-3xl font-bold text-white shadow-2xl"
            style={{ backgroundColor: avatarColor }}
          >
            {getInitials(senderName)}
          </div>

          {/* File icon badge */}
          <div className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-dark-700 border-2 border-dark-800 flex items-center justify-center shadow-lg">
            <Download size={16} className="text-primary-400" />
          </div>
        </div>

        <h3 className="text-xl md:text-2xl font-bold text-white mb-1">{senderName}</h3>
        <p className="text-dark-400 text-sm">wants to send you a file</p>
      </div>

      {/* File info card */}
      <div className="bg-dark-700/60 rounded-2xl p-4 mb-6 border border-dark-600/50">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-dark-600/80 flex items-center justify-center flex-shrink-0">
            {getFileIcon(request.fileName, request.fileMimeType)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white font-medium truncate" title={request.fileName}>
              {request.fileName}
            </p>
            <p className="text-xs text-dark-400 mt-0.5">
              {formatSize(request.fileSize)}
              {request.fileSize > 1024 * 1024 * 1024 && (
                <span className="text-yellow-400 ml-1">• Large file</span>
              )}
            </p>
          </div>
        </div>

        {/* P2P badge */}
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-dark-500">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Direct P2P transfer — not stored on server</span>
        </div>
      </div>

      {/* Warning: File too large for this browser */}
      {fileTooLarge && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 flex items-start gap-2">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-300">
            <p className="font-semibold mb-0.5">File too large for this browser</p>
            <p className="text-red-400">Max {formatSize(maxSize)} on Firefox/Safari. Use <span className="text-white font-medium">Chrome, Edge</span> or the <span className="text-white font-medium">Desktop App</span> for larger files.</p>
          </div>
        </div>
      )}

      {/* Warning: Memory mode — moderate file */}
      {!fileTooLarge && isMemoryOnly && request.fileSize > 500 * 1024 * 1024 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 mb-4 flex items-start gap-2">
          <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-yellow-300">
            This browser uses memory for downloads. Large files may be slow. Use <span className="text-white font-medium">Chrome/Edge</span> or <span className="text-white font-medium">Desktop App</span> for best performance.
          </p>
        </div>
      )}

      {/* Accept / Reject buttons */}
      <div className="flex items-center justify-center gap-6">
        {/* Reject */}
        <button
          onClick={() => onReject(request.transferId)}
          className="flex flex-col items-center gap-2 group"
        >
          <div className="w-14 h-14 rounded-full bg-red-500/10 hover:bg-red-500 border-2 border-red-500/30 hover:border-red-500 flex items-center justify-center transition-all group-active:scale-90 shadow-lg">
            <X size={24} className="text-red-400 group-hover:text-white transition-colors" />
          </div>
          <span className="text-xs text-dark-400 font-medium">Decline</span>
        </button>

        {/* Accept — disabled if file too large */}
        <button
          onClick={() => !fileTooLarge && onAccept(request)}
          disabled={fileTooLarge}
          className="flex flex-col items-center gap-2 group"
        >
          <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all group-active:scale-90 shadow-lg ${
            fileTooLarge
              ? 'bg-dark-600 border-2 border-dark-500 cursor-not-allowed opacity-50'
              : 'bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 shadow-emerald-500/30 animate-pulse'
          }`}>
            <Download size={24} className={fileTooLarge ? 'text-dark-400' : 'text-white'} />
          </div>
          <span className="text-xs text-dark-400 font-medium">{fileTooLarge ? 'Too Large' : 'Accept'}</span>
        </button>
      </div>
    </div>
  );
};

/**
 * Main incoming file transfer overlay
 */
const IncomingFileTransfer = () => {
  const { incomingRequests, acceptTransfer, rejectTransfer } = useFileTransferStore();
  const ringIntervalRef = useRef(null);
  const notifiedRef = useRef(new Set());

  // Play notification sound and show OS notification for each new request
  useEffect(() => {
    if (incomingRequests.length === 0) {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
      notifiedRef.current.clear();
      return;
    }

    // Check for new requests (not already notified)
    const newRequests = incomingRequests.filter(r => !notifiedRef.current.has(r.transferId));
    
    if (newRequests.length > 0) {
      // Play sound
      playNotificationSound('message');
      
      // Repeat sound every 4 seconds while modal is open
      if (!ringIntervalRef.current) {
        ringIntervalRef.current = setInterval(() => {
          playNotificationSound('message');
        }, 4000);
      }

      // Send OS notification for each new request
      newRequests.forEach(req => {
        notifiedRef.current.add(req.transferId);
        sendOSNotification(req);
      });
    }

    return () => {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
        ringIntervalRef.current = null;
      }
    };
  }, [incomingRequests]);

  if (incomingRequests.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[60] flex items-center justify-center p-4 animate-fade-in safe-top safe-bottom">
      {/* Show latest request on top */}
      <FileRequestCard
        request={incomingRequests[incomingRequests.length - 1]}
        onAccept={acceptTransfer}
        onReject={rejectTransfer}
      />

      {/* Badge for multiple pending requests */}
      {incomingRequests.length > 1 && (
        <div className="absolute top-6 right-6 bg-primary-600 text-white text-sm font-bold px-3 py-1.5 rounded-full shadow-lg">
          +{incomingRequests.length - 1} more
        </div>
      )}
    </div>
  );
};

/**
 * Send OS-level notification (browser Notification API + Electron native)
 */
function sendOSNotification(request) {
  const title = `📁 ${request.senderName} wants to send a file`;
  const body = `${request.fileName} (${formatSize(request.fileSize)})`;

  // Electron: native OS notification + flash taskbar
  if (window.electronAPI?.isElectron) {
    window.electronAPI.showNotification({ title, body });
    if (window.electronAPI.flashWindow) {
      window.electronAPI.flashWindow();
    }
    return;
  }

  // Browser: Web Notification API
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const notification = new window.Notification(title, {
        body,
        icon: '/favicon.ico',
        tag: `file-transfer-${request.transferId}`,
        requireInteraction: true,
      });
      
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (e) {
      // Notification API not available in this context
    }
  }
}

export default IncomingFileTransfer;
