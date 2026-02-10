import {
  Phone, Video, ArrowLeft, Users
} from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import useCallStore from '../../store/useCallStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor } from '../../utils/helpers';
import toast from 'react-hot-toast';

const Header = () => {
  const { activeChat, clearActiveChat, isUserOnline } = useChatStore();
  const { startCall, startGroupCall, callStatus } = useCallStore();
  const { user } = useAuthStore();

  if (!activeChat) {
    return (
      <div className="h-16 bg-dark-800 border-b border-dark-700 hidden md:flex items-center justify-center">
        <p className="text-dark-500 text-sm">Select a conversation to start messaging</p>
      </div>
    );
  }

  const isOnline = activeChat.type === 'user' && isUserOnline(activeChat.id);
  const isGroup = activeChat.type === 'group';
  const inCall = callStatus !== 'idle';

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

  return (
    <div className="h-14 md:h-16 bg-dark-800 border-b border-dark-700 flex items-center justify-between px-2 md:px-4">
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
          <div
            className="w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
            style={{ backgroundColor: stringToColor(activeChat.name) }}
          >
            {isGroup ? <Users size={16} className="text-white" /> : getInitials(activeChat.name)}
          </div>
          {!isGroup && (
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-800 ${isOnline ? 'bg-emerald-400' : 'bg-dark-500'}`} />
          )}
        </div>

        {/* Name & status */}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-white truncate">{activeChat.name}</h3>
          <p className="text-xs text-dark-400 truncate">
            {isGroup
              ? `${activeChat.memberCount || 0} members`
              : isOnline
                ? <span className="text-emerald-400">Online</span>
                : 'Offline'
            }
          </p>
        </div>
      </div>

      {/* Call actions — clearly visible */}
      <div className="flex items-center gap-1 flex-shrink-0">
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
      </div>
    </div>
  );
};

export default Header;
