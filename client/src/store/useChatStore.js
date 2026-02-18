/**
 * ============================================
 * Chat Store (Zustand)
 * ============================================
 * 
 * Manages: Conversations, messages, active chat, typing state
 * 
 * STATE DESIGN:
 * - conversations: Map of userId → last message (for sidebar list)
 * - messages: Map of chatId → message array (cached conversations)
 * - activeChat: Currently open chat (userId or groupId)
 * - typingUsers: Set of userIds currently typing
 * - unread: Map of userId → unread count
 */

import { create } from 'zustand';
import api from '../services/api';
import { getSocket } from '../services/socket';

const useChatStore = create((set, get) => ({
  // State
  messages: {},        // { chatId: [message, ...] }
  activeChat: null,    // { id, type: 'user'|'group', name, avatar }
  typingUsers: {},     // { chatId: { userId: true } }
  unread: {},          // { chatId: count }
  onlineUsers: [],     // [{ userId, socketId, lastSeen }]
  users: [],           // All users
  userLastSeen: {},    // { userId: ISO timestamp } — cached lastSeen per user
  usersLastFetched: 0, // Timestamp of last users fetch (for cache TTL)
  conversations: {},   // { chatId: { content, type, createdAt, senderId, senderUsername } } — last message per conversation
  isLoadingMessages: false,
  isLoadingMore: false,
  pinnedMessages: {},  // { chatId: [pinnedMessage, ...] }
  showPinnedPanel: false,
  selectMode: false,       // Whether multi-select mode is active
  selectedMessages: {},    // { messageId: true } — set of selected message IDs

  // ============================================
  // USER MANAGEMENT
  // ============================================

  setOnlineUsers: (users) => {
    // Extract lastSeen from online users list
    const lastSeenUpdates = {};
    users.forEach(u => {
      if (u.lastSeen) {
        lastSeenUpdates[u.userId] = u.lastSeen;
      }
    });
    set((state) => ({
      onlineUsers: users,
      userLastSeen: { ...state.userLastSeen, ...lastSeenUpdates },
    }));
  },

  addOnlineUser: (user) => {
    set((state) => {
      const exists = state.onlineUsers.some(u => u.userId === user.userId);
      if (exists) return state;
      const newLastSeen = user.lastSeen
        ? { ...state.userLastSeen, [user.userId]: user.lastSeen }
        : state.userLastSeen;
      return {
        onlineUsers: [...state.onlineUsers, user],
        userLastSeen: newLastSeen,
      };
    });
  },

  removeOnlineUser: (userId, lastSeen) => {
    set((state) => ({
      onlineUsers: state.onlineUsers.filter(u => u.userId !== userId),
      userLastSeen: lastSeen
        ? { ...state.userLastSeen, [userId]: lastSeen }
        : state.userLastSeen,
    }));
  },

  /**
   * Update lastSeen for a specific user (from socket events)
   */
  updateUserLastSeen: (userId, lastSeen) => {
    set((state) => ({
      userLastSeen: { ...state.userLastSeen, [userId]: lastSeen },
    }));
  },

  isUserOnline: (userId) => {
    return get().onlineUsers.some(u => u.userId === userId);
  },

  /**
   * Update a user's role in the users list (e.g., owner mode toggle).
   * IMPORTANT: Returns early if no change is needed, preventing unnecessary
   * state updates and the cascading re-render storm that caused message
   * content to visually disappear.
   */
  updateUserRole: (userId, role) => {
    const { users } = get();
    const target = users.find(u => u._id === userId);
    if (!target || target.role === role) return; // No change needed → skip setState
    set({
      users: users.map(u =>
        u._id === userId ? { ...u, role } : u
      ),
    });
  },

  fetchUsers: async (force = false) => {
    const { usersLastFetched } = get();
    const CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache TTL

    // Skip fetch if recently fetched (unless forced)
    if (!force && usersLastFetched && (Date.now() - usersLastFetched < CACHE_TTL)) {
      return;
    }

    try {
      const res = await api.get('/users');
      const fetchedUsers = res.data.data.users;

      // Extract lastSeen from fetched users
      const lastSeenUpdates = {};
      fetchedUsers.forEach(u => {
        if (u.lastSeen) {
          lastSeenUpdates[u._id] = u.lastSeen;
        }
      });

      set((state) => ({
        users: fetchedUsers,
        usersLastFetched: Date.now(),
        userLastSeen: { ...state.userLastSeen, ...lastSeenUpdates },
      }));
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  },

  // ============================================
  // CONVERSATIONS (last message per chat)
  // ============================================

  /**
   * Fetch last message for each 1-to-1 conversation.
   * Used for sidebar preview text.
   */
  fetchConversations: async () => {
    try {
      const res = await api.get('/messages/conversations');
      set({ conversations: res.data.data.conversations });
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    }
  },

  /**
   * Update a single conversation's last message (called on send/receive).
   * This avoids re-fetching all conversations for every new message.
   */
  updateConversation: (chatId, message, senderUsername) => {
    // Format preview text based on message type
    let content = message.content;
    if (message.type === 'image') content = '📷 Photo';
    else if (message.type === 'file') content = `📎 ${message.fileName || 'File'}`;
    else if (message.type === 'audio') content = '🎵 Audio';
    else if (message.type === 'video') content = '🎬 Video';
    else if (message.type === 'call') {
      const icon = message.callType === 'video' ? '📹' : '📞';
      content = `${icon} ${message.callStatus === 'completed' ? 'Call' : 'Missed call'}`;
    }

    set((state) => ({
      conversations: {
        ...state.conversations,
        [chatId]: {
          content: content || '',
          type: message.type || 'text',
          createdAt: message.createdAt || new Date().toISOString(),
          senderId: message.sender?._id || message.sender,
          senderUsername: senderUsername || message.sender?.username || '',
        },
      },
    }));
  },

  // ============================================
  // ACTIVE CHAT
  // ============================================

  setActiveChat: (chat) => {
    set({ activeChat: chat });
    // Clear unread for this chat
    if (chat) {
      set((state) => {
        const newUnread = { ...state.unread };
        delete newUnread[chat.id];
        return { unread: newUnread };
      });
    }
  },

  clearActiveChat: () => set({ activeChat: null }),

  // ============================================
  // MESSAGES
  // ============================================

  /**
   * Fetch conversation messages from server
   */
  fetchMessages: async (chatId, chatType = 'user', page = 1) => {
    if (page === 1) {
      set({ isLoadingMessages: true });
    } else {
      set({ isLoadingMore: true });
    }

    try {
      const endpoint = chatType === 'group'
        ? `/messages/group/${chatId}?page=${page}`
        : `/messages/${chatId}?page=${page}`;

      const res = await api.get(endpoint);
      const fetchedMessages = res.data.data.messages;

      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: page === 1
            ? fetchedMessages
            : [...fetchedMessages, ...(state.messages[chatId] || [])],
        },
        isLoadingMessages: false,
        isLoadingMore: false,
      }));

      return res.data.data.pagination;
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      set({ isLoadingMessages: false, isLoadingMore: false });
      return null;
    }
  },

  /**
   * Send a message (optimistic UI: pending → sent)
   */
  sendMessage: async (chatId, chatType, content, fileData = null) => {
    // Generate temporary ID for optimistic message
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    // Optimistic message (pending state)
    const optimisticMsg = {
      _id: tempId,
      tempId,
      sender: { _id: currentUser._id, username: currentUser.username, avatar: currentUser.avatar },
      content: content || '',
      type: fileData?.type || 'text',
      fileUrl: fileData?.url || null,
      fileName: fileData?.name || null,
      fileSize: fileData?.size || null,
      fileMimeType: fileData?.mimeType || null,
      createdAt: new Date().toISOString(),
      status: 'pending',
      read: false,
    };

    // Insert optimistic message immediately
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: [...(state.messages[chatId] || []), optimisticMsg],
      },
    }));

    try {
      let messageData;

      if (chatType === 'group') {
        const payload = {
          groupId: chatId,
          content,
          ...(fileData && {
            type: fileData.type || 'file',
            fileUrl: fileData.url,
            fileName: fileData.name,
            fileSize: fileData.size,
            fileMimeType: fileData.mimeType,
          }),
        };
        const res = await api.post('/messages/group', payload);
        messageData = res.data.data.message;
      } else {
        const payload = {
          receiverId: chatId,
          content,
          ...(fileData && {
            type: fileData.type || 'file',
            fileUrl: fileData.url,
            fileName: fileData.name,
            fileSize: fileData.size,
            fileMimeType: fileData.mimeType,
          }),
        };
        const res = await api.post('/messages', payload);
        messageData = res.data.data.message;
      }

      // Replace optimistic msg with real msg (status: sent)
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: (state.messages[chatId] || []).map(m =>
            m._id === tempId ? { ...messageData, status: 'sent' } : m
          ),
        },
      }));

      // Update conversation preview (last message)
      if (chatType === 'user') {
        get().updateConversation(chatId, messageData, messageData.sender?.username);
      }

      // Emit via socket for real-time delivery
      const socket = getSocket();
      if (socket) {
        if (chatType === 'group') {
          socket.emit('message:group:send', { message: { ...messageData, status: 'sent' }, groupId: chatId });
        } else {
          socket.emit('message:send', { message: { ...messageData, status: 'sent' }, receiverId: chatId });
        }
      }

      return messageData;
    } catch (error) {
      // Mark optimistic message as failed
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: (state.messages[chatId] || []).map(m =>
            m._id === tempId ? { ...m, status: 'failed' } : m
          ),
        },
      }));
      console.error('Failed to send message:', error);
      throw error;
    }
  },

  /**
   * Retry sending a failed message
   */
  retrySendMessage: async (chatId, chatType, tempMessage) => {
    // Remove failed message
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).filter(m => m._id !== tempMessage._id),
      },
    }));
    // Re-send
    return get().sendMessage(chatId, chatType, tempMessage.content, tempMessage.fileUrl ? {
      type: tempMessage.type,
      url: tempMessage.fileUrl,
      name: tempMessage.fileName,
      size: tempMessage.fileSize,
      mimeType: tempMessage.fileMimeType,
    } : null);
  },

  /**
   * Update a specific message's status
   */
  updateMessageStatus: (chatId, messageId, status) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map(m =>
          m._id === messageId ? { ...m, status } : m
        ),
      },
    }));
  },

  /**
   * Batch update: mark all my sent messages in a chat as 'seen'
   */
  markMyMessagesAsSeen: (chatId, readerId) => {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map(m => {
          const senderId = typeof m.sender === 'object' ? m.sender._id : m.sender;
          if (senderId === currentUser._id && m.status !== 'seen') {
            return { ...m, status: 'seen', read: true, readAt: new Date().toISOString() };
          }
          return m;
        }),
      },
    }));
  },

  /**
   * Mark all my sent messages as delivered
   */
  markMyMessagesAsDelivered: (chatId) => {
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map(m => {
          const senderId = typeof m.sender === 'object' ? m.sender._id : m.sender;
          if (senderId === currentUser._id && (m.status === 'sent' || !m.status)) {
            return { ...m, status: 'delivered' };
          }
          return m;
        }),
      },
    }));
  },

  /**
   * Add a received message to the store
   * Also sends delivery acknowledgment via socket
   */
  addReceivedMessage: (chatId, message) => {
    set((state) => {
      const activeChat = state.activeChat;
      const isActiveChat = activeChat && activeChat.id === chatId;

      return {
        messages: {
          ...state.messages,
          [chatId]: [...(state.messages[chatId] || []), { ...message, status: 'delivered' }],
        },
        // Increment unread if not active chat
        unread: isActiveChat
          ? state.unread
          : {
              ...state.unread,
              [chatId]: (state.unread[chatId] || 0) + 1,
            },
      };
    });

    // Send delivery ack to sender
    const socket = getSocket();
    if (socket && message._id) {
      const senderId = typeof message.sender === 'object' ? message.sender._id : message.sender;
      socket.emit('message:delivered', {
        messageId: message._id,
        senderId,
        chatId,
      });
    }

    // If this chat is currently active, also mark as seen
    const { activeChat } = get();
    if (activeChat && activeChat.id === chatId) {
      const senderId = typeof message.sender === 'object' ? message.sender._id : message.sender;
      if (socket && message._id) {
        socket.emit('message:read', {
          senderId,
          messageId: message._id,
          chatId,
        });
      }
    }

    // Update conversation preview (for 1-to-1 messages — chatId is the sender's userId)
    get().updateConversation(chatId, message, message.sender?.username);
  },

  // ============================================
  // MULTI-SELECT & BULK DELETE
  // ============================================

  toggleSelectMode: () => {
    set((state) => ({
      selectMode: !state.selectMode,
      selectedMessages: {}, // Clear selection when toggling
    }));
  },

  exitSelectMode: () => set({ selectMode: false, selectedMessages: {} }),

  toggleMessageSelection: (messageId) => {
    set((state) => {
      const newSelection = { ...state.selectedMessages };
      if (newSelection[messageId]) {
        delete newSelection[messageId];
      } else {
        newSelection[messageId] = true;
      }
      return { selectedMessages: newSelection };
    });
  },

  selectAllMessages: (chatId) => {
    const msgs = get().messages[chatId] || [];
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const selection = {};
    msgs.forEach(m => {
      const senderId = typeof m.sender === 'object' ? m.sender._id : m.sender;
      if (senderId === currentUser._id && m._id && !m._id.startsWith('temp_')) {
        selection[m._id] = true;
      }
    });
    set({ selectedMessages: selection });
  },

  clearSelection: () => set({ selectedMessages: {} }),

  /**
   * Bulk delete selected messages from server and local state.
   * Own messages are deleted from DB; received messages are removed locally only.
   */
  bulkDeleteMessages: async (chatId, chatType) => {
    const { selectedMessages, messages } = get();
    const selectedIds = Object.keys(selectedMessages);
    if (selectedIds.length === 0) return;

    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
    const chatMsgs = messages[chatId] || [];

    // Separate own messages (delete from server) vs others (local remove only)
    const ownMessageIds = [];
    selectedIds.forEach(id => {
      const msg = chatMsgs.find(m => m._id === id);
      if (msg) {
        const senderId = typeof msg.sender === 'object' ? msg.sender._id : msg.sender;
        if (senderId === currentUser._id) {
          ownMessageIds.push(id);
        }
      }
    });

    try {
      // Delete own messages from server
      if (ownMessageIds.length > 0) {
        await api.post('/messages/bulk-delete', { messageIds: ownMessageIds });
      }

      // Remove ALL selected messages from local state (own + received)
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: (state.messages[chatId] || []).filter(m => !selectedMessages[m._id]),
        },
        selectedMessages: {},
        selectMode: false,
      }));

      // Broadcast deletion of own messages via socket
      if (ownMessageIds.length > 0) {
        const socket = getSocket();
        if (socket) {
          socket.emit('message:bulk-delete', {
            messageIds: ownMessageIds,
            chatId,
            chatType,
          });
        }
      }

      return { deleted: selectedIds.length };
    } catch (error) {
      console.error('Bulk delete failed:', error);
      throw error;
    }
  },

  /**
   * Handle real-time bulk delete from other user
   */
  handleRemoteBulkDelete: (chatId, messageIds) => {
    if (!messageIds || !Array.isArray(messageIds)) return;
    const idSet = new Set(messageIds);
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).filter(m => !idSet.has(m._id)),
      },
    }));
  },

  // ============================================
  // TYPING INDICATORS
  // ============================================

  setTyping: (chatId, userId, isTyping) => {
    set((state) => {
      const chatTyping = { ...(state.typingUsers[chatId] || {}) };
      if (isTyping) {
        chatTyping[userId] = true;
      } else {
        delete chatTyping[userId];
      }
      return {
        typingUsers: {
          ...state.typingUsers,
          [chatId]: chatTyping,
        },
      };
    });
  },

  /**
   * Emit typing event
   */
  emitTyping: (chatId, chatType, isTyping) => {
    const socket = getSocket();
    if (!socket) return;

    if (chatType === 'group') {
      socket.emit(isTyping ? 'typing:group:start' : 'typing:group:stop', { groupId: chatId });
    } else {
      socket.emit(isTyping ? 'typing:start' : 'typing:stop', { receiverId: chatId });
    }
  },

  // ============================================
  // UNREAD
  // ============================================

  fetchUnreadCounts: async () => {
    try {
      const res = await api.get('/messages/unread/count');
      set({ unread: res.data.data.unread });
    } catch (error) {
      console.error('Failed to fetch unread counts:', error);
    }
  },

  markAsRead: async (chatId) => {
    try {
      await api.put(`/messages/read/${chatId}`);
      set((state) => {
        const newUnread = { ...state.unread };
        delete newUnread[chatId];
        return { unread: newUnread };
      });

      // Emit seen status for all unread messages from this sender
      const socket = getSocket();
      if (socket) {
        const messages = get().messages[chatId] || [];
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        messages.forEach(m => {
          const senderId = typeof m.sender === 'object' ? m.sender._id : m.sender;
          if (senderId !== currentUser._id && !m.read) {
            socket.emit('message:read', {
              senderId,
              messageId: m._id,
              chatId,
            });
          }
        });
      }
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  },

  // ============================================
  // PIN / UNPIN MESSAGES
  // ============================================

  togglePinnedPanel: () => set((state) => ({ showPinnedPanel: !state.showPinnedPanel })),
  closePinnedPanel: () => set({ showPinnedPanel: false }),

  fetchPinnedMessages: async (chatId, chatType = 'user') => {
    try {
      const res = await api.get(`/messages/pinned/${chatId}?type=${chatType}`);
      set((state) => ({
        pinnedMessages: {
          ...state.pinnedMessages,
          [chatId]: res.data.data.messages,
        },
      }));
    } catch (error) {
      console.error('Failed to fetch pinned messages:', error);
    }
  },

  pinMessage: async (messageId, chatId, chatType) => {
    try {
      const res = await api.put(`/messages/${messageId}/pin`);
      const pinnedMsg = res.data.data.message;

      // Update messages list — mark as pinned
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: (state.messages[chatId] || []).map(m =>
            m._id === messageId ? { ...m, isPinned: true, pinnedBy: pinnedMsg.pinnedBy, pinnedAt: pinnedMsg.pinnedAt } : m
          ),
        },
        pinnedMessages: {
          ...state.pinnedMessages,
          [chatId]: [pinnedMsg, ...(state.pinnedMessages[chatId] || [])],
        },
      }));

      // Broadcast via socket
      const socket = getSocket();
      if (socket) {
        socket.emit('message:pin', { message: pinnedMsg, chatId, chatType });
      }

      return pinnedMsg;
    } catch (error) {
      console.error('Failed to pin message:', error);
      throw error;
    }
  },

  unpinMessage: async (messageId, chatId, chatType) => {
    try {
      await api.put(`/messages/${messageId}/unpin`);

      // Update messages list — mark as unpinned
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: (state.messages[chatId] || []).map(m =>
            m._id === messageId ? { ...m, isPinned: false, pinnedBy: null, pinnedAt: null } : m
          ),
        },
        pinnedMessages: {
          ...state.pinnedMessages,
          [chatId]: (state.pinnedMessages[chatId] || []).filter(m => m._id !== messageId),
        },
      }));

      // Broadcast via socket
      const socket = getSocket();
      if (socket) {
        socket.emit('message:unpin', { messageId, chatId, chatType });
      }
    } catch (error) {
      console.error('Failed to unpin message:', error);
      throw error;
    }
  },

  // Called when receiving real-time pin/unpin from other users
  handleRemotePin: (chatId, message) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map(m =>
          m._id === message._id ? { ...m, isPinned: true, pinnedBy: message.pinnedBy, pinnedAt: message.pinnedAt } : m
        ),
      },
      pinnedMessages: {
        ...state.pinnedMessages,
        [chatId]: [message, ...(state.pinnedMessages[chatId] || []).filter(m => m._id !== message._id)],
      },
    }));
  },

  handleRemoteUnpin: (chatId, messageId) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [chatId]: (state.messages[chatId] || []).map(m =>
          m._id === messageId ? { ...m, isPinned: false, pinnedBy: null, pinnedAt: null } : m
        ),
      },
      pinnedMessages: {
        ...state.pinnedMessages,
        [chatId]: (state.pinnedMessages[chatId] || []).filter(m => m._id !== messageId),
      },
    }));
  },
}));

export default useChatStore;
