/**
 * ============================================
 * SearchResults — Unified search across conversations & users
 * ============================================
 * 
 * When the user types in the search bar, this component replaces
 * the tab content and shows results in two sections:
 * 1. Conversations — users the current user has chatted with
 * 2. Users — all other users (no conversation yet)
 * 
 * Also searches groups and channels.
 */

import { MessageCircle, Users, Hash, Radio, Shield, Search } from 'lucide-react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import useGroupStore from '../../store/useGroupStore';
import useChannelStore from '../../store/useChannelStore';
import { getInitials, stringToColor, formatTime, formatLastSeen } from '../../utils/helpers';
import { SERVER_URL } from '../../utils/constants';

const SearchResults = ({ searchQuery, onSelect }) => {
  const users = useChatStore(s => s.users);
  const conversations = useChatStore(s => s.conversations);
  const groupConversations = useChatStore(s => s.groupConversations);
  const channelConversations = useChatStore(s => s.channelConversations);
  const unread = useChatStore(s => s.unread);
  const isUserOnline = useChatStore(s => s.isUserOnline);
  const userLastSeen = useChatStore(s => s.userLastSeen);
  const setActiveChat = useChatStore(s => s.setActiveChat);
  const currentUser = useAuthStore(s => s.user);
  const { myGroups } = useGroupStore();
  const { myChannels } = useChannelStore();

  const q = searchQuery.toLowerCase().trim();
  if (!q) return null;

  // ---- Filter users with conversations (conversations section) ----
  // Match by username OR by last message content
  const conversationUsers = users.filter(u => {
    if (u._id === currentUser?._id) return false;
    if (!conversations[u._id]) return false; // must have a conversation
    const nameMatch = u.username.toLowerCase().includes(q);
    const contentMatch = conversations[u._id]?.content?.toLowerCase().includes(q);
    return nameMatch || contentMatch;
  });

  // Sort by last message time
  const sortedConversations = [...conversationUsers].sort((a, b) => {
    const aConv = conversations[a._id];
    const bConv = conversations[b._id];
    if (aConv?.createdAt && bConv?.createdAt) {
      return new Date(bConv.createdAt) - new Date(aConv.createdAt);
    }
    if (aConv?.createdAt) return -1;
    if (bConv?.createdAt) return 1;
    return 0;
  });

  // ---- Filter users without conversations (users section) ----
  const nonConversationUsers = users.filter(u => {
    if (u._id === currentUser?._id) return false;
    if (conversations[u._id]) return false; // exclude those with conversations
    return u.username.toLowerCase().includes(q);
  });

  // Sort: online first, then alphabetical
  const sortedUsers = [...nonConversationUsers].sort((a, b) => {
    const aOnline = isUserOnline(a._id);
    const bOnline = isUserOnline(b._id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return a.username.localeCompare(b.username);
  });

  // ---- Filter groups (by name, description, or last message) ----
  const filteredGroups = (myGroups || []).filter(g => {
    const nameMatch = g.name.toLowerCase().includes(q);
    const descMatch = g.description?.toLowerCase().includes(q);
    const convMatch = groupConversations[g._id]?.content?.toLowerCase().includes(q);
    return nameMatch || descMatch || convMatch;
  });

  // ---- Filter channels (by name, description, or last post) ----
  const filteredChannels = (myChannels || []).filter(ch => {
    const nameMatch = ch.name.toLowerCase().includes(q);
    const descMatch = ch.description?.toLowerCase().includes(q);
    const convMatch = channelConversations[ch._id]?.content?.toLowerCase().includes(q);
    return nameMatch || descMatch || convMatch;
  });

  const handleSelectUser = (user) => {
    setActiveChat({
      id: user._id,
      type: 'user',
      name: user.username,
      avatar: user.avatar,
      role: user.role,
    });
    onSelect?.();
  };

  const handleSelectGroup = (group) => {
    setActiveChat({
      id: group._id,
      type: 'group',
      name: group.name,
    });
    onSelect?.();
  };

  const handleSelectChannel = (channel) => {
    setActiveChat({
      id: channel._id,
      type: 'channel',
      name: channel.name,
    });
    onSelect?.();
  };

  const totalResults = sortedConversations.length + sortedUsers.length + filteredGroups.length + filteredChannels.length;

  if (totalResults === 0) {
    return (
      <div className="p-8 text-center">
        <Search size={32} className="mx-auto text-dark-600 mb-3" />
        <p className="text-dark-400 text-sm font-medium">No results found</p>
        <p className="text-dark-500 text-xs mt-1">Try a different search term</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {/* ---- Conversations Section ---- */}
      {sortedConversations.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2">
            <MessageCircle size={14} className="text-primary-400" />
            <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider">
              Conversations ({sortedConversations.length})
            </span>
          </div>
          {sortedConversations.map(user => {
            const online = isUserOnline(user._id);
            const unreadCount = unread[user._id] || 0;
            const hasUnread = unreadCount > 0;
            const conv = conversations[user._id];

            return (
              <button
                key={user._id}
                onClick={() => handleSelectUser(user)}
                className={`sidebar-item w-full text-left ${hasUnread ? 'bg-dark-750/50' : ''}`}
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  {user.avatar ? (
                    <img
                      src={`${SERVER_URL}${user.avatar}`}
                      alt={user.username}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: stringToColor(user.username) }}
                    >
                      {getInitials(user.username)}
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-dark-800 ${online ? 'bg-emerald-400' : 'bg-dark-500'}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{user.username}</p>
                      {user.role === 'owner' && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] rounded-full font-medium flex-shrink-0">
                          <Shield size={8} />
                        </span>
                      )}
                    </div>
                    <span className={`text-[11px] flex-shrink-0 ${hasUnread ? 'text-primary-400 font-medium' : 'text-dark-500'}`}>
                      {conv?.createdAt ? formatTime(conv.createdAt) : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={`text-xs truncate ${hasUnread ? 'text-dark-200 font-medium' : 'text-dark-400'}`}>
                      {conv?.content
                        ? (conv.senderId === currentUser?._id ? `You: ${conv.content}` : conv.content)
                        : online ? <span className="text-emerald-400">Online</span> : 'Tap to chat'
                      }
                    </p>
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
        </>
      )}

      {/* ---- Groups Section ---- */}
      {filteredGroups.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2 mt-1">
            <Hash size={14} className="text-emerald-400" />
            <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider">
              Groups ({filteredGroups.length})
            </span>
          </div>
          {filteredGroups.map(group => {
            const gConv = groupConversations[group._id];
            const unreadCount = unread[group._id] || 0;
            const hasUnread = unreadCount > 0;

            return (
              <button
                key={group._id}
                onClick={() => handleSelectGroup(group)}
                className={`sidebar-item w-full text-left ${hasUnread ? 'bg-dark-750/50' : ''}`}
              >
                <div className="relative flex-shrink-0">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: stringToColor(group.name) }}
                  >
                    {getInitials(group.name)}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate">{group.name}</p>
                    {gConv?.createdAt && (
                      <span className={`text-[11px] flex-shrink-0 ${hasUnread ? 'text-primary-400 font-medium' : 'text-dark-500'}`}>
                        {formatTime(gConv.createdAt)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className={`text-xs truncate ${hasUnread ? 'text-dark-200 font-medium' : 'text-dark-400'}`}>
                      {gConv?.content
                        ? (gConv.senderUsername ? `${gConv.senderUsername}: ${gConv.content}` : gConv.content)
                        : `${group.members?.length || 0} members`
                      }
                    </p>
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
        </>
      )}

      {/* ---- Channels Section ---- */}
      {filteredChannels.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2 mt-1">
            <Radio size={14} className="text-indigo-400" />
            <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider">
              Channels ({filteredChannels.length})
            </span>
          </div>
          {filteredChannels.map(channel => {
            const chConv = channelConversations[channel._id];

            return (
              <button
                key={channel._id}
                onClick={() => handleSelectChannel(channel)}
                className="sidebar-item w-full text-left"
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white bg-indigo-500/30">
                    <Radio size={18} className="text-indigo-400" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate">{channel.name}</p>
                    {chConv?.createdAt && (
                      <span className="text-[11px] flex-shrink-0 text-dark-500">
                        {formatTime(chConv.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-dark-400 truncate mt-0.5">
                    {chConv?.content
                      ? (chConv.senderUsername ? `${chConv.senderUsername}: ${chConv.content}` : chConv.content)
                      : `${channel.subscriberCount || channel.subscribers?.length || 0} subscribers`
                    }
                  </p>
                </div>
              </button>
            );
          })}
        </>
      )}

      {/* ---- Users Section (no conversation yet) ---- */}
      {sortedUsers.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2 mt-1">
            <Users size={14} className="text-blue-400" />
            <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider">
              Users ({sortedUsers.length})
            </span>
          </div>
          {sortedUsers.map(user => {
            const online = isUserOnline(user._id);
            const lastSeen = userLastSeen[user._id] || user.lastSeen;

            return (
              <button
                key={user._id}
                onClick={() => handleSelectUser(user)}
                className="sidebar-item w-full text-left"
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  {user.avatar ? (
                    <img
                      src={`${SERVER_URL}${user.avatar}`}
                      alt={user.username}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                      style={{ backgroundColor: stringToColor(user.username) }}
                    >
                      {getInitials(user.username)}
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-dark-800 ${online ? 'bg-emerald-400' : 'bg-dark-500'}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{user.username}</p>
                    {user.role === 'owner' && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-500/20 text-amber-400 text-[9px] rounded-full font-medium flex-shrink-0">
                        <Shield size={8} />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-dark-500 truncate mt-0.5">
                    {online
                      ? <span className="text-emerald-400">Online</span>
                      : lastSeen
                        ? formatLastSeen(lastSeen)
                        : 'Offline'
                    }
                  </p>
                </div>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
};

export default SearchResults;
