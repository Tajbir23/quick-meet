import useChatStore from '../../store/useChatStore';
import useGroupStore from '../../store/useGroupStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor, formatTime, truncate } from '../../utils/helpers';
import { MessageCircle, Shield } from 'lucide-react';

const ChatList = ({ searchQuery }) => {
  const users = useChatStore(s => s.users);
  const setActiveChat = useChatStore(s => s.setActiveChat);
  const unread = useChatStore(s => s.unread);
  const isUserOnline = useChatStore(s => s.isUserOnline);
  const currentUser = useAuthStore(s => s.user);

  // Filter users that have conversations or match search
  const filteredUsers = users.filter(u => {
    if (searchQuery) {
      return u.username.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  if (filteredUsers.length === 0) {
    return (
      <div className="p-8 text-center">
        <MessageCircle size={32} className="mx-auto text-dark-600 mb-3" />
        <p className="text-dark-400 text-sm font-medium">
          {searchQuery ? 'No users found' : 'No conversations yet'}
        </p>
        <p className="text-dark-500 text-xs mt-1">
          {searchQuery ? 'Try a different search' : 'Select a user to start chatting'}
        </p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {filteredUsers.map(user => {
        const online = isUserOnline(user._id);
        const unreadCount = unread[user._id] || 0;

        return (
          <button
            key={user._id}
            onClick={() => setActiveChat({
              id: user._id,
              type: 'user',
              name: user.username,
              avatar: user.avatar,
              role: user.role,
            })}
            className="sidebar-item w-full text-left"
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ backgroundColor: stringToColor(user.username) }}
              >
                {getInitials(user.username)}
              </div>
              <span className={`absolute -bottom-0.5 -right-0.5 ${online ? 'online-dot' : 'offline-dot'}`} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{user.username}</p>
                  {user.role === 'owner' && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] rounded-full font-medium flex-shrink-0">
                      <Shield size={8} />
                      OWNER
                    </span>
                  )}
                </div>
                {user.lastSeen && (
                  <span className="text-[11px] text-dark-500 flex-shrink-0">{formatTime(user.lastSeen)}</span>
                )}
              </div>
              <p className="text-xs text-dark-400 truncate mt-0.5">
                {online ? <span className="text-emerald-400">Online</span> : 'Tap to chat'}
              </p>
            </div>

            {/* Unread badge */}
            {unreadCount > 0 && (
              <span className="badge badge-primary animate-scale-in">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default ChatList;
