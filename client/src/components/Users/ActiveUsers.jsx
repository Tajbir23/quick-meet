/**
 * ============================================
 * ActiveUsers — Online users list for sidebar
 * ============================================
 */

import { Users, MessageCircle, Shield } from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import { getInitials, stringToColor } from '../../utils/helpers';

const ActiveUsers = ({ searchQuery = '' }) => {
  const { users, onlineUsers, setActiveChat, activeChat } = useChatStore();
  const { user: currentUser } = useAuthStore();

  // Filter out current user & apply search
  const filteredUsers = users
    .filter(u => u._id !== currentUser?._id)
    .filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()));

  const isOnline = (userId) => onlineUsers.some(u => u.userId === userId);

  // Sort: online first, then alphabetical
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const aOnline = isOnline(a._id);
    const bOnline = isOnline(b._id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return a.username.localeCompare(b.username);
  });

  const handleSelectUser = (user) => {
    setActiveChat({
      id: user._id,
      type: 'user',
      name: user.username,
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

          return (
            <button
              key={user._id}
              onClick={() => handleSelectUser(user)}
              className={`sidebar-item w-full text-left ${isActive ? 'bg-dark-700' : ''}`}
            >
              <div className="flex items-center gap-3 w-full">
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: stringToColor(user.username) }}
                  >
                    {getInitials(user.username)}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-dark-800 ${
                    online ? 'bg-emerald-400' : 'bg-dark-500'
                  }`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-white truncate">{user.username}</p>
                    {user.role === 'owner' && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] rounded-full font-medium flex-shrink-0">
                        <Shield size={8} />
                        OWNER
                      </span>
                    )}
                  </div>
                  <p className={`text-xs mt-0.5 ${online ? 'text-emerald-400' : 'text-dark-500'}`}>
                    {online ? 'Online' : 'Offline'}
                  </p>
                </div>

                {/* Chat icon */}
                <MessageCircle size={16} className="text-dark-500 flex-shrink-0" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ActiveUsers;
