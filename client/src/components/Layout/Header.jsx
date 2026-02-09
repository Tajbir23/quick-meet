import {
  Phone, Video, MoreVertical, ArrowLeft, Users, Monitor
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
      <div className="h-16 bg-dark-800 border-b border-dark-700 flex items-center justify-center">
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
    <div className="h-16 bg-dark-800 border-b border-dark-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {/* Back button for mobile */}
        <button
          onClick={clearActiveChat}
          className="btn-icon text-dark-400 md:hidden"
        >
          <ArrowLeft size={20} />
        </button>

        {/* Avatar */}
        <div className="relative">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ backgroundColor: stringToColor(activeChat.name) }}
          >
            {isGroup ? <Users size={18} className="text-white" /> : getInitials(activeChat.name)}
          </div>
          {!isGroup && (
            <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-dark-800 ${isOnline ? 'bg-emerald-400' : 'bg-dark-500'}`} />
          )}
        </div>

        {/* Name & status */}
        <div>
          <h3 className="text-sm font-medium text-white">{activeChat.name}</h3>
          <p className="text-xs text-dark-400">
            {isGroup
              ? `${activeChat.memberCount || 0} members`
              : isOnline ? 'Online' : 'Offline'
            }
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleAudioCall}
          className="btn-icon text-dark-400 hover:text-primary-400"
          title="Audio call"
          disabled={inCall}
        >
          <Phone size={18} />
        </button>
        <button
          onClick={handleVideoCall}
          className="btn-icon text-dark-400 hover:text-primary-400"
          title="Video call"
          disabled={inCall}
        >
          <Video size={18} />
        </button>
      </div>
    </div>
  );
};

export default Header;
