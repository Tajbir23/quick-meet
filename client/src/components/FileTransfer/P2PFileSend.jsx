/**
 * ============================================
 * P2P File Send Button
 * ============================================
 * 
 * Inline button for sending files via P2P WebRTC DataChannel.
 * Placed in the MessageInput area next to the regular file upload.
 * Supports files up to 100GB.
 */

import { useRef } from 'react';
import { HardDrive } from 'lucide-react';
import useFileTransferStore from '../../store/useFileTransferStore';
import useChatStore from '../../store/useChatStore';
import { canReceiveLargeFiles, getPlatformCapability } from '../../services/p2pFileTransfer';
import { MAX_P2P_FILE_SIZE, MAX_P2P_FILE_SIZE_BROWSER_MEMORY } from '../../utils/constants';
import toast from 'react-hot-toast';

const P2PFileSend = () => {
  const fileInputRef = useRef(null);
  const activeChat = useChatStore(s => s.activeChat);
  const sendFile = useFileTransferStore(s => s.sendFile);
  const isOnline = useChatStore(s => s.isUserOnline);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!activeChat || activeChat.type !== 'user') {
      toast.error('P2P file transfer only works in 1-to-1 chats');
      return;
    }

    // Enforce platform file size limits
    const capability = getPlatformCapability();
    const maxSize = canReceiveLargeFiles() ? MAX_P2P_FILE_SIZE : MAX_P2P_FILE_SIZE_BROWSER_MEMORY;

    if (file.size > maxSize) {
      if (capability === 'browser-memory') {
        toast.error('Max 2GB on this browser. Use Chrome, Edge, or Desktop App for larger files.', { duration: 5000 });
      } else {
        toast.error(`Max file size: ${(maxSize / 1073741824).toFixed(0)}GB`, { duration: 4000 });
      }
      return;
    }

    // Check if peer is online
    if (!isOnline(activeChat.id)) {
      toast.error('User is offline. The transfer will start when they come online.');
    }

    // Warn for very large files (>10GB)
    if (file.size > 10 * 1024 * 1024 * 1024) {
      toast(`Large file: ${(file.size / (1024 * 1024 * 1024)).toFixed(1)}GB — this may take a while`, {
        icon: '⚠️',
        duration: 5000,
      });
    }

    // Tip for memory-only browsers with moderately large files
    if (capability === 'browser-memory' && file.size > 500 * 1024 * 1024) {
      toast('Tip: Use Chrome/Edge or Desktop App for better performance', { icon: '💡', duration: 4000 });
    }

    try {
      await sendFile(file, activeChat.id);
      toast.success(`Sending "${file.name}" via P2P`, { duration: 3000 });
    } catch (err) {
      toast.error('Failed to start P2P transfer');
    }
  };

  if (!activeChat || activeChat.type !== 'user') return null;

  // Dynamic tooltip based on platform
  const maxLabel = canReceiveLargeFiles() ? '100GB' : '2GB';

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        className="hidden"
        // No accept restriction — any file type
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="btn-icon flex-shrink-0 text-dark-400 hover:text-primary-400 relative group"
        title={`Send file via P2P (up to ${maxLabel})`}
      >
        <HardDrive size={20} />
        {/* Tooltip */}
        <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-dark-700 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-dark-600">
          P2P Transfer (up to {maxLabel})
        </span>
      </button>
    </>
  );
};

export default P2PFileSend;
