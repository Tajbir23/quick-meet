/**
 * ============================================
 * SearchResults — Unified search across conversations & users
 * ============================================
 * 
 * Searches:
 * 1. Message content across all conversations (server-side API)
 * 2. User names, group names, channel names (client-side)
 * 
 * Server-side search decrypts messages and matches the query,
 * returning matching conversations with message snippets.
 */

import { useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Users, Hash, Radio, Shield, Search, Loader2 } from 'lucide-react';
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
  const searchResults = useChatStore(s => s.searchResults);
  const isSearching = useChatStore(s => s.isSearching);
  const searchMessages = useChatStore(s => s.searchMessages);
  const clearSearchResults = useChatStore(s => s.clearSearchResults);
  const currentUser = useAuthStore(s => s.user);
  const { myGroups } = useGroupStore();
  const { myChannels } = useChannelStore();

  // Debounced server-side search
  const debounceRef = useRef(null);
  const lastQueryRef = useRef('');

  const debouncedSearch = useCallback((query) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.trim().length < 1) {
      clearSearchResults();
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchMessages(query.trim());
    }, 400);
  }, [searchMessages, clearSearchResults]);

  useEffect(() => {
    if (searchQuery !== lastQueryRef.current) {
      lastQueryRef.current = searchQuery;
      debouncedSearch(searchQuery);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, debouncedSearch]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearSearchResults();
    };
  }, [clearSearchResults]);

  const q = searchQuery?.toLowerCase().trim();
  if (!q) return null;

  // ── LOCAL FILTERS (name-based) ──────────────────────────

  // Users with conversations — match by username
  const conversationUsers = users.filter(u => {
    if (u._id === currentUser?._id) return false;
    if (!conversations[u._id]) return false;
    return u.username.toLowerCase().includes(q);
  });

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

  // Users without conversations — match by username
  const nonConversationUsers = users.filter(u => {
    if (u._id === currentUser?._id) return false;
    if (conversations[u._id]) return false;
    return u.username.toLowerCase().includes(q);
  });

  const sortedUsers = [...nonConversationUsers].sort((a, b) => {
    const aOnline = isUserOnline(a._id);
    const bOnline = isUserOnline(b._id);
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return a.username.localeCompare(b.username);
  });

  // Groups — match by name
  const filteredGroups = (myGroups || []).filter(g => g.name.toLowerCase().includes(q));

  // Channels — match by name
  const filteredChannels = (myChannels || []).filter(ch => ch.name.toLowerCase().includes(q));

  // ── SERVER RESULTS (message content search) ─────────────
  const nameMatchUserIds = new Set(sortedConversations.map(u => u._id));
  const nameMatchGroupIds = new Set(filteredGroups.map(g => g._id));
  const nameMatchChannelIds = new Set(filteredChannels.map(ch => ch._id));

  // API results not already covered by name matches
  const apiConvResults = (searchResults?.conversations || []).filter(
    c => !nameMatchUserIds.has(c.userId)
  );
  const apiGroupResults = (searchResults?.groups || []).filter(
    g => !nameMatchGroupIds.has(g.groupId)
  );
  const apiChannelResults = (searchResults?.channels || []).filter(
    ch => !nameMatchChannelIds.has(ch.channelId)
  );

  // Maps for message snippets on name-matched items
  const apiConvMap = {};
  (searchResults?.conversations || []).forEach(c => { apiConvMap[c.userId] = c; });
  const apiGroupMap = {};
  (searchResults?.groups || []).forEach(g => { apiGroupMap[g.groupId] = g; });
  const apiChannelMap = {};
  (searchResults?.channels || []).forEach(ch => { apiChannelMap[ch.channelId] = ch; });

  const handleSelectUser = (userId, username, avatar, role) => {
    setActiveChat({ id: userId, type: 'user', name: username, avatar, role });
    onSelect?.();
  };

  const handleSelectGroup = (group) => {
    setActiveChat({ id: group._id || group.groupId, type: 'group', name: group.name });
    onSelect?.();
  };

  const handleSelectChannel = (channel) => {
    setActiveChat({ id: channel._id || channel.channelId, type: 'channel', name: channel.name });
    onSelect?.();
  };

  const totalLocal = sortedConversations.length + sortedUsers.length + filteredGroups.length + filteredChannels.length;
  const totalApi = apiConvResults.length + apiGroupResults.length + apiChannelResults.length;
  const totalResults = totalLocal + totalApi;

  // Highlight matching text
  const highlightMatch = (text, query) => {
    if (!text || !query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-primary-500/30 text-primary-300 rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    );
  };

  if (!isSearching && totalResults === 0) {
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
      {/* ── Conversations (name match) ── */}
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
            const apiMatch = apiConvMap[user._id];

            return (
              <button
                key={`conv-${user._id}`}
                onClick={() => handleSelectUser(user._id, user.username, user.avatar, user.role)}
                className={`sidebar-item w-full text-left ${hasUnread ? 'bg-dark-750/50' : ''}`}
              >
                <div className="relative flex-shrink-0">
                  {user.avatar ? (
                    <img src={`${SERVER_URL}${user.avatar}`} alt={user.username} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: stringToColor(user.username) }}>
                      {getInitials(user.username)}
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-dark-800 ${online ? 'bg-emerald-400' : 'bg-dark-500'}`} />
                </div>
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
                  {apiMatch?.messages?.[0] ? (
                    <p className="text-xs text-dark-400 truncate mt-0.5">
                      <span className="text-dark-500">{apiMatch.messages[0].senderUsername}: </span>
                      {highlightMatch(apiMatch.messages[0].content, q)}
                    </p>
                  ) : (
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
                  )}
                </div>
              </button>
            );
          })}
        </>
      )}

      {/* ── Message search results: Conversations (not in name match) ── */}
      {apiConvResults.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2 mt-1">
            <Search size={14} className="text-yellow-400" />
            <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider">
              Messages ({apiConvResults.length})
            </span>
          </div>
          {apiConvResults.map(conv => {
            const online = isUserOnline(conv.userId);
            const unreadCount = unread[conv.userId] || 0;
            const hasUnread = unreadCount > 0;

            return (
              <button
                key={`api-conv-${conv.userId}`}
                onClick={() => handleSelectUser(conv.userId, conv.username, conv.avatar, conv.role)}
                className={`sidebar-item w-full text-left ${hasUnread ? 'bg-dark-750/50' : ''}`}
              >
                <div className="relative flex-shrink-0">
                  {conv.avatar ? (
                    <img src={`${SERVER_URL}${conv.avatar}`} alt={conv.username} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: stringToColor(conv.username) }}>
                      {getInitials(conv.username)}
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-dark-800 ${online ? 'bg-emerald-400' : 'bg-dark-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white truncate">{conv.username}</p>
                    {conv.messages?.[0]?.createdAt && (
                      <span className="text-[11px] text-dark-500 flex-shrink-0">
                        {formatTime(conv.messages[0].createdAt)}
                      </span>
                    )}
                  </div>
                  {conv.messages?.map((msg, i) => (
                    <p key={msg._id || i} className="text-xs text-dark-400 truncate mt-0.5">
                      <span className="text-dark-500">{msg.senderUsername}: </span>
                      {highlightMatch(msg.content, q)}
                    </p>
                  ))}
                </div>
              </button>
            );
          })}
        </>
      )}

      {/* ── Groups (name match) ── */}
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
            const apiMatch = apiGroupMap[group._id];

            return (
              <button
                key={`group-${group._id}`}
                onClick={() => handleSelectGroup(group)}
                className={`sidebar-item w-full text-left ${hasUnread ? 'bg-dark-750/50' : ''}`}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: stringToColor(group.name) }}>
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
                  {apiMatch?.messages?.[0] ? (
                    <p className="text-xs text-dark-400 truncate mt-0.5">
                      <span className="text-dark-500">{apiMatch.messages[0].senderUsername}: </span>
                      {highlightMatch(apiMatch.messages[0].content, q)}
                    </p>
                  ) : (
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
                  )}
                </div>
              </button>
            );
          })}
        </>
      )}

      {/* ── Message search results: Groups (not in name match) ── */}
      {apiGroupResults.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2 mt-1">
            <Search size={14} className="text-yellow-400" />
            <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider">
              Group Messages ({apiGroupResults.length})
            </span>
          </div>
          {apiGroupResults.map(group => (
            <button
              key={`api-group-${group.groupId}`}
              onClick={() => handleSelectGroup(group)}
              className="sidebar-item w-full text-left"
            >
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: stringToColor(group.name) }}>
                  {getInitials(group.name)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white truncate">{group.name}</p>
                  {group.messages?.[0]?.createdAt && (
                    <span className="text-[11px] text-dark-500 flex-shrink-0">
                      {formatTime(group.messages[0].createdAt)}
                    </span>
                  )}
                </div>
                {group.messages?.map((msg, i) => (
                  <p key={msg._id || i} className="text-xs text-dark-400 truncate mt-0.5">
                    <span className="text-dark-500">{msg.senderUsername}: </span>
                    {highlightMatch(msg.content, q)}
                  </p>
                ))}
              </div>
            </button>
          ))}
        </>
      )}

      {/* ── Channels (name match) ── */}
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
            const apiMatch = apiChannelMap[channel._id];

            return (
              <button
                key={`channel-${channel._id}`}
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
                  {apiMatch?.messages?.[0] ? (
                    <p className="text-xs text-dark-400 truncate mt-0.5">
                      <span className="text-dark-500">{apiMatch.messages[0].senderUsername}: </span>
                      {highlightMatch(apiMatch.messages[0].content, q)}
                    </p>
                  ) : (
                    <p className="text-xs text-dark-400 truncate mt-0.5">
                      {chConv?.content
                        ? (chConv.senderUsername ? `${chConv.senderUsername}: ${chConv.content}` : chConv.content)
                        : `${channel.subscriberCount || channel.subscribers?.length || 0} subscribers`
                      }
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </>
      )}

      {/* ── Message search results: Channels (not in name match) ── */}
      {apiChannelResults.length > 0 && (
        <>
          <div className="px-4 py-2 flex items-center gap-2 mt-1">
            <Search size={14} className="text-yellow-400" />
            <span className="text-xs text-dark-400 font-semibold uppercase tracking-wider">
              Channel Messages ({apiChannelResults.length})
            </span>
          </div>
          {apiChannelResults.map(channel => (
            <button
              key={`api-channel-${channel.channelId}`}
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
                  {channel.messages?.[0]?.createdAt && (
                    <span className="text-[11px] text-dark-500 flex-shrink-0">
                      {formatTime(channel.messages[0].createdAt)}
                    </span>
                  )}
                </div>
                {channel.messages?.map((msg, i) => (
                  <p key={msg._id || i} className="text-xs text-dark-400 truncate mt-0.5">
                    <span className="text-dark-500">{msg.senderUsername}: </span>
                    {highlightMatch(msg.content, q)}
                  </p>
                ))}
              </div>
            </button>
          ))}
        </>
      )}

      {/* ── Users (no conversation yet) ── */}
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
                key={`user-${user._id}`}
                onClick={() => handleSelectUser(user._id, user.username, user.avatar, user.role)}
                className="sidebar-item w-full text-left"
              >
                <div className="relative flex-shrink-0">
                  {user.avatar ? (
                    <img src={`${SERVER_URL}${user.avatar}`} alt={user.username} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: stringToColor(user.username) }}>
                      {getInitials(user.username)}
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-dark-800 ${online ? 'bg-emerald-400' : 'bg-dark-500'}`} />
                </div>
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

      {/* Loading indicator */}
      {isSearching && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 size={16} className="text-primary-400 animate-spin" />
          <span className="text-xs text-dark-400">Searching messages...</span>
        </div>
      )}
    </div>
  );
};

export default SearchResults;
