/**
 * ============================================
 * ActiveUsers — Online users list for sidebar
 * ============================================
 * 
 * SORTING: Online first, then by lastActive (most recently active at top).
 * Shows last message preview, last active time, and highlights unread chats.
 */

import { Users, MessageCircle, Shield } from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor, formatLastSeen, formatTime } from '../../utils/helpers';
import { SERVER_URL } from '../../utils/constants';

const ActiveUsers = ({ searchQuery = '' }) => {
  const { users, onlineUsers, userLastSeen, conversations, unread, setActiveChat, activeChat } = useChatStore();
  const { user: currentUser } = useAuthStore();

  // Filter out current user & apply search
  const filteredUsers = users
    .filter(u => u._id !== currentUser?._id)
    .filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()));

  const isOnline = (userId) => onlineUsers.some(u => u.userId === userId);

  /**
   * Get last seen time for a user.
   * Priority: socket event cache → API response → user model field
   */
  const getLastSeen = (userId) => {
    return userLastSeen[userId] || users.find(u => u._id === userId)?.lastSeen || null;
  };

  // Sort: online first, then by last message time (most recent first), then by lastSeen, then alphabetical
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aOnline = isOnline(a._id);
    const bOnline = isOnline(b._id);

    // Online users always come first
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;

    // Sort by last conversation time (most recent message first)
    const aConv = conversations[a._id];
    const bConv = conversations[b._id];
    if (aConv?.createdAt && bConv?.createdAt) {
      const diff = new Date(bConv.createdAt) - new Date(aConv.createdAt);
      if (diff !== 0) return diff;
    }
    if (aConv?.createdAt && !bConv?.createdAt) return -1;
    if (!aConv?.createdAt && bConv?.createdAt) return 1;

    // Then by lastSeen
    const aLastSeen = getLastSeen(a._id);
    const bLastSeen = getLastSeen(b._id);
    if (aLastSeen && bLastSeen) {
      const diff = new Date(bLastSeen) - new Date(aLastSeen);
      if (diff !== 0) return diff;
    }
    if (aLastSeen && !bLastSeen) return -1;
    if (!aLastSeen && bLastSeen) return 1;

    return a.username.localeCompare(b.username);
  });

  const handleSelectUser = (user) => {
    setActiveChat({
      id: user._id,
      type: 'user',
      name: user.username,
      avatar: user.avatar || '',
      role: user.role,
    });
  };

  const onlineCount = filteredUsers.filter(u => isOnline(u._id)).length;

  if (sortedUsers.length === 0) {
    return (
      <div className="p-8 text-center">
        <Users size={32} className="mx-auto text-dark-600 mb-3" />
        <p className="text-dark-400 text-sm font-medium">
          {searchQuery ? 'No users found' : 'No other users yet'}
        </p>
        <p className="text-dark-500 text-xs mt-1">
          {searchQuery ? 'Try a different search' : 'Invite people to join'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Online count */}
      <div className="px-4 py-2.5 flex items-center gap-2">
        <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
        <span className="text-xs text-dark-400 font-medium">{onlineCount} online</span>
      </div>

      {/* User list */}
      <div>
        {sortedUsers.map(user => {
          const online = isOnline(user._id);
          const isActive = activeChat?.id === user._id;
          const lastSeen = getLastSeen(user._id);
          const conv = conversations[user._id];
          const unreadCount = unread[user._id] || 0;
          const hasUnread = unreadCount > 0;

          return (
            <button
              key={user._id}
              onClick={() => handleSelectUser(user)}
              className={`sidebar-item w-full text-left ${isActive ? 'bg-dark-700' : ''} ${hasUnread ? 'bg-dark-750/50' : ''}`}
            >
              <div className="flex items-center gap-3 w-full">
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
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-800 ${
                    online ? 'bg-emerald-400' : 'bg-dark-500'
                  }`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className={`text-sm font-semibold truncate ${hasUnread ? 'text-white' : 'text-white'}`}>{user.username}</p>
                      {user.role === 'owner' && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] rounded-full font-medium flex-shrink-0">
                          <Shield size={8} />
                          OWNER
                        </span>
                      )}
                    </div>
                    {/* Time — show last message time or last seen */}
                    <span className={`text-[11px] flex-shrink-0 ${hasUnread ? 'text-primary-400 font-medium' : 'text-dark-500'}`}>
                      {conv?.createdAt
                        ? formatTime(conv.createdAt)
                        : lastSeen
                          ? formatTime(lastSeen)
                          : ''
                      }
                    </span>
                  </div>

                  {/* Last message preview or status */}
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={`text-xs truncate ${hasUnread ? 'text-dark-200 font-medium' : 'text-dark-500'}`}>
                      {conv?.content
                        ? (conv.senderId === currentUser?._id ? `You: ${conv.content}` : conv.content)
                        : online
                          ? 'Online'
                          : lastSeen
                            ? formatLastSeen(lastSeen)
                            : 'Offline'
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
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ActiveUsers;
