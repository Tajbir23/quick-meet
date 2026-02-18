import { useRef } from 'react';
import {
  Phone, Video, ArrowLeft, Users, Info, Shield, FolderUp, Pin
} from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import useCallStore from '../../store/useCallStore';
import useGroupStore from '../../store/useGroupStore';
import useAuthStore from '../../store/useAuthStore';
import useFileTransferStore from '../../store/useFileTransferStore';
import { getInitials, stringToColor, formatLastSeen } from '../../utils/helpers';
import { SERVER_URL, MAX_P2P_FILE_SIZE, MAX_P2P_FILE_SIZE_BROWSER_MEMORY } from '../../utils/constants';
import { canReceiveLargeFiles, getPlatformCapability } from '../../services/p2pFileTransfer';
import toast from 'react-hot-toast';

const Header = ({ onToggleGroupInfo, showGroupInfo }) => {
  // Use individual selectors to prevent re-render when unrelated state changes
  const activeChat = useChatStore(s => s.activeChat);
  const clearActiveChat = useChatStore(s => s.clearActiveChat);
  const isUserOnline = useChatStore(s => s.isUserOnline);
  const userLastSeen = useChatStore(s => s.userLastSeen);
  const users = useChatStore(s => s.users);
  const showPinnedPanel = useChatStore(s => s.showPinnedPanel);
  const togglePinnedPanel = useChatStore(s => s.togglePinnedPanel);
  const { startCall, startGroupCall, callStatus } = useCallStore();
  const { activeGroupCalls } = useGroupStore();
  const user = useAuthStore(s => s.user);
  const sendFile = useFileTransferStore(s => s.sendFile);
  const fileInputRef = useRef(null);

  if (!activeChat) {
    return (
      <div className="h-14 md:h-16 bg-dark-800 border-b border-dark-700 hidden md:flex items-center justify-center">
        <p className="text-dark-500 text-sm">Select a conversation to start messaging</p>
      </div>
    );
  }

  const isOnline = activeChat.type === 'user' && isUserOnline(activeChat.id);
  const isGroup = activeChat.type === 'group';
  const inCall = callStatus !== 'idle';

  // Get last seen for the active chat user
  const chatUserLastSeen = !isGroup
    ? (userLastSeen[activeChat.id] || users.find(u => u._id === activeChat.id)?.lastSeen)
    : null;

  // Telegram-style: check if this group has an active call
  const activeCall = isGroup ? activeGroupCalls[activeChat.id] : null;
  const activeCallCount = activeCall?.participants?.length || 0;
  // Am I already in this group call?
  const amInThisCall = activeCall?.participants?.some(p => p.userId === user?._id);

  const handleAudioCall = async () => {
    if (inCall) {
      toast.error('Already in a call');
      return;
    }
    try {
      if (isGroup) {
        await startGroupCall(activeChat.id, 'audio');
      } else {
        await startCall({ userId: activeChat.id, username: activeChat.name }, 'audio');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to start call');
    }
  };

  const handleVideoCall = async () => {
    if (inCall) {
      toast.error('Already in a call');
      return;
    }
    try {
      if (isGroup) {
        await startGroupCall(activeChat.id, 'video');
      } else {
        await startCall({ userId: activeChat.id, username: activeChat.name }, 'video');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to start call');
    }
  };

  const handleP2PFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!activeChat || activeChat.type !== 'user') {
      toast.error('P2P file transfer only works in 1-to-1 chats');
      return;
    }

    // Enforce file size limit based on platform
    // Note: This is the SENDER side — file.size is what the receiver must handle
    // The receiver's browser may not support large files, but we can at least
    // warn the sender about our own platform limits and general limits
    const capability = getPlatformCapability();
    const maxSize = canReceiveLargeFiles() ? MAX_P2P_FILE_SIZE : MAX_P2P_FILE_SIZE_BROWSER_MEMORY;

    if (file.size > maxSize) {
      if (capability === 'browser-memory') {
        toast.error(`Max file size: 2GB on this browser. Use Chrome, Edge, or Desktop App for larger files.`, { duration: 5000 });
      } else {
        toast.error(`Max file size: ${(maxSize / 1073741824).toFixed(0)}GB`, { duration: 4000 });
      }
      return;
    }

    // Warn about large files (>10GB)
    if (file.size > 10 * 1024 * 1024 * 1024) {
      toast(`Large file: ${(file.size / (1024 * 1024 * 1024)).toFixed(1)}GB — this may take a while`, { icon: '⚠️', duration: 5000 });
    }

    // Info about browser memory mode for >500MB files
    if (capability === 'browser-memory' && file.size > 500 * 1024 * 1024) {
      toast('Tip: Use Chrome/Edge or Desktop App for better large file performance', { icon: '💡', duration: 4000 });
    }

    try {
      await sendFile(file, activeChat.id);
      toast.success(`Sending "${file.name}" via P2P`, { duration: 3000 });
    } catch (err) {
      toast.error('Failed to start P2P transfer');
    }
  };

  return (
    <>
    <div className="h-14 md:h-16 bg-dark-800 border-b border-dark-700 flex items-center justify-between px-2 md:px-4 flex-shrink-0 z-10" style={{ minHeight: '3.5rem' }}>
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
        {/* Back button — mobile only */}
        <button
          onClick={clearActiveChat}
          className="btn-icon text-white md:hidden flex-shrink-0"
        >
          <ArrowLeft size={22} />
        </button>

        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {!isGroup && activeChat.avatar ? (
            <img
              src={`${SERVER_URL}${activeChat.avatar}`}
              alt={activeChat.name}
              className="w-9 h-9 md:w-10 md:h-10 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style={{ backgroundColor: stringToColor(activeChat.name) }}
            >
              {isGroup ? <Users size={16} className="text-white" /> : getInitials(activeChat.name)}
            </div>
          )}
          {!isGroup && (
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-800 ${isOnline ? 'bg-emerald-400' : 'bg-dark-500'}`} />
          )}
        </div>

        {/* Name & status */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-white truncate">{activeChat.name}</h3>
            {activeChat.role === 'owner' && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] rounded-full font-medium flex-shrink-0">
                <Shield size={8} />
                OWNER
              </span>
            )}
          </div>
          <p className="text-xs text-dark-400 truncate">
            {isGroup
              ? `${activeChat.memberCount || 0} members`
              : isOnline
                ? <span className="text-emerald-400">Online</span>
                : chatUserLastSeen
                  ? <span>{formatLastSeen(chatUserLastSeen)}</span>
                  : 'Offline'
            }
          </p>
        </div>
      </div>

      {/* Actions — call + file share */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* P2P File Share — only for 1-to-1 chats */}
        {!isGroup && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleP2PFile}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-icon text-white hover:text-emerald-400 hover:bg-emerald-500/10 relative group"
              title="Send file via P2P (up to 100GB)"
            >
              <FolderUp size={20} />
              <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-dark-700 text-white text-[9px] px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-dark-600 z-50">
                Share File (P2P)
              </span>
            </button>
          </>
        )}
        <button
          onClick={togglePinnedPanel}
          className={`btn-icon transition-colors ${
            showPinnedPanel
              ? 'text-amber-400 bg-amber-500/10'
              : 'text-white hover:text-amber-400 hover:bg-amber-500/10'
          }`}
          title="Pinned messages"
        >
          <Pin size={20} />
        </button>
        <button
          onClick={handleAudioCall}
          className="btn-icon text-white hover:text-primary-400 hover:bg-primary-500/10"
          title="Audio call"
          disabled={inCall}
        >
          <Phone size={20} />
        </button>
        <button
          onClick={handleVideoCall}
          className="btn-icon text-white hover:text-primary-400 hover:bg-primary-500/10"
          title="Video call"
          disabled={inCall}
        >
          <Video size={20} />
        </button>
        {isGroup && (
          <button
            onClick={onToggleGroupInfo}
            className={`btn-icon transition-colors ${
              showGroupInfo
                ? 'text-primary-400 bg-primary-500/10'
                : 'text-white hover:text-primary-400 hover:bg-primary-500/10'
            }`}
            title="Group info & members"
          >
            <Info size={20} />
          </button>
        )}
      </div>
    </div>

    {/* Telegram-style group call join banner */}
    {isGroup && activeCall && activeCallCount > 0 && !amInThisCall && (
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
            <Phone size={14} className="text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-400">Voice Chat</p>
            <p className="text-[10px] text-dark-400 truncate">
              {activeCall.participants.map(p => p.username).join(', ')} · {activeCallCount} participant{activeCallCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleAudioCall}
            disabled={inCall}
            className="px-3 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Phone size={12} />
            Join
          </button>
          <button
            onClick={handleVideoCall}
            disabled={inCall}
            className="px-3 py-1.5 rounded-full bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <Video size={12} />
            Video
          </button>
        </div>
      </div>
    )}
    </>
  );
};

export default Header;
