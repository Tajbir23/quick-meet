import useChatStore from '../../store/useChatStore';
import useGroupStore from '../../store/useGroupStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor, formatTime, truncate } from '../../utils/helpers';

const ChatList = ({ searchQuery }) => {
  const { users, setActiveChat, unread, isUserOnline } = useChatStore();
  const { user: currentUser } = useAuthStore();

  // Filter users that have conversations or match search
  const filteredUsers = users.filter(u => {
    if (searchQuery) {
      return u.username.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  if (filteredUsers.length === 0) {
    return (
      <div className="p-4 text-center text-dark-500 text-sm">
        {searchQuery ? 'No users found' : 'No conversations yet'}
      </div>
    );
  }

  return (
    <div className="py-2">
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
            })}
            className="sidebar-item w-full text-left"
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ backgroundColor: stringToColor(user.username) }}
              >
                {getInitials(user.username)}
              </div>
              <span className={`absolute bottom-0 right-0 ${online ? 'online-dot' : 'offline-dot'}`} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white truncate">{user.username}</p>
                {user.lastSeen && (
                  <span className="text-xs text-dark-500">{formatTime(user.lastSeen)}</span>
                )}
              </div>
              <p className="text-xs text-dark-400 truncate">
                {online ? 'Online' : 'Tap to chat'}
              </p>
            </div>

            {/* Unread badge */}
            {unreadCount > 0 && (
              <span className="badge badge-primary">{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export default ChatList;
