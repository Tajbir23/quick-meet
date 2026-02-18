import useChatStore from '../../store/useChatStore';
import useGroupStore from '../../store/useGroupStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor, formatTime, formatLastSeen, truncate } from '../../utils/helpers';
import { SERVER_URL } from '../../utils/constants';
import { MessageCircle, Shield } from 'lucide-react';

const ChatList = ({ searchQuery }) => {
  const users = useChatStore(s => s.users);
  const setActiveChat = useChatStore(s => s.setActiveChat);
  const unread = useChatStore(s => s.unread);
  const conversations = useChatStore(s => s.conversations);
  const isUserOnline = useChatStore(s => s.isUserOnline);
  const userLastSeen = useChatStore(s => s.userLastSeen);
  const currentUser = useAuthStore(s => s.user);

  // Filter users that have conversations or match search
  const filteredUsers = users.filter(u => {
    if (searchQuery) {
      return u.username.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  // Sort: users with conversations first (by last message time), then online, then lastSeen
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aConv = conversations[a._id];
    const bConv = conversations[b._id];
    const aUnread = unread[a._id] || 0;
    const bUnread = unread[b._id] || 0;

    // Unread chats always come first
    if (aUnread > 0 && bUnread === 0) return -1;
    if (aUnread === 0 && bUnread > 0) return 1;

    // Then sort by last message time
    if (aConv?.createdAt && bConv?.createdAt) {
      const diff = new Date(bConv.createdAt) - new Date(aConv.createdAt);
      if (diff !== 0) return diff;
    }
    if (aConv?.createdAt && !bConv?.createdAt) return -1;
    if (!aConv?.createdAt && bConv?.createdAt) return 1;

    // Then online status
    const aOnline = isUserOnline(a._id);
    const bOnline = isUserOnline(b._id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;

    return a.username.localeCompare(b.username);
  });

  if (sortedUsers.length === 0) {
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
      {sortedUsers.map(user => {
        const online = isUserOnline(user._id);
        const unreadCount = unread[user._id] || 0;
        const hasUnread = unreadCount > 0;
        const conv = conversations[user._id];

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
            className={`sidebar-item w-full text-left ${hasUnread ? 'bg-dark-750/50' : ''}`}
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              {user.avatar ? (
                <img
                  src={`${SERVER_URL}${user.avatar}`}
                  alt={user.username}
                  className="w-11 h-11 rounded-full object-cover"
                />
              ) : (
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{ backgroundColor: stringToColor(user.username) }}
                >
                  {getInitials(user.username)}
                </div>
              )}
              <span className={`absolute -bottom-0.5 -right-0.5 ${online ? 'online-dot' : 'offline-dot'}`} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className={`text-sm font-semibold truncate ${hasUnread ? 'text-white' : 'text-white'}`}>{user.username}</p>
                  {user.role === 'owner' && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] rounded-full font-medium flex-shrink-0">
                      <Shield size={8} />
                      OWNER
                    </span>
                  )}
                </div>
                <span className={`text-[11px] flex-shrink-0 ${hasUnread ? 'text-primary-400 font-medium' : 'text-dark-500'}`}>
                  {conv?.createdAt
                    ? formatTime(conv.createdAt)
                    : (userLastSeen[user._id] || user.lastSeen)
                      ? formatTime(userLastSeen[user._id] || user.lastSeen)
                      : ''
                  }
                </span>
              </div>

              {/* Last message preview or status */}
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className={`text-xs truncate ${hasUnread ? 'text-dark-200 font-medium' : 'text-dark-400'}`}>
                  {conv?.content
                    ? (conv.senderId === currentUser?._id ? `You: ${conv.content}` : conv.content)
                    : online
                      ? <span className="text-emerald-400">Online</span>
                      : (userLastSeen[user._id] || user.lastSeen)
                        ? formatLastSeen(userLastSeen[user._id] || user.lastSeen)
                        : 'Tap to chat'
                  }
                </p>

                {/* Unread badge */}
                {hasUnread && (
                  <span className="min-w-[20px] h-5 px-1.5 bg-primary-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center flex-shrink-0">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default ChatList;
