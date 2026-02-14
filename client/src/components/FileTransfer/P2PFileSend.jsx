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

    // Check if peer is online
    if (!isOnline(activeChat.id)) {
      toast.error('User is offline. The transfer will start when they come online.');
    }

    // Warn for very large files
    if (file.size > 10 * 1024 * 1024 * 1024) { // > 10GB
      toast(`Large file: ${(file.size / (1024 * 1024 * 1024)).toFixed(1)}GB — this may take a while`, {
        icon: '⚠️',
        duration: 5000,
      });
    }

    try {
      await sendFile(file, activeChat.id);
      toast.success(`Sending "${file.name}" via P2P`, { duration: 3000 });
    } catch (err) {
      toast.error('Failed to start P2P transfer');
    }
  };

  if (!activeChat || activeChat.type !== 'user') return null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        className="hidden"
        // No accept restriction — any file type, any size
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="btn-icon flex-shrink-0 text-dark-400 hover:text-primary-400 relative group"
        title="Send file via P2P (up to 100GB)"
      >
        <HardDrive size={20} />
        {/* Tooltip */}
        <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-dark-700 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-dark-600">
          P2P Transfer (up to 100GB)
        </span>
      </button>
    </>
  );
};

export default P2PFileSend;
