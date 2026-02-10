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
  onlineUsers: [],     // [{ userId, socketId }]
  users: [],           // All users
  isLoadingMessages: false,

  // ============================================
  // USER MANAGEMENT
  // ============================================

  setOnlineUsers: (users) => set({ onlineUsers: users }),

  addOnlineUser: (user) => {
    set((state) => {
      const exists = state.onlineUsers.some(u => u.userId === user.userId);
      if (exists) return state;
      return { onlineUsers: [...state.onlineUsers, user] };
    });
  },

  removeOnlineUser: (userId) => {
    set((state) => ({
      onlineUsers: state.onlineUsers.filter(u => u.userId !== userId),
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

  fetchUsers: async () => {
    try {
      const res = await api.get('/users');
      set({ users: res.data.data.users });
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
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
    set({ isLoadingMessages: true });

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
            : [...(state.messages[chatId] || []), ...fetchedMessages],
        },
        isLoadingMessages: false,
      }));

      return res.data.data.pagination;
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      set({ isLoadingMessages: false });
      return null;
    }
  },

  /**
   * Send a message (via REST API + socket)
   */
  sendMessage: async (chatId, chatType, content, fileData = null) => {
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

      // Add to local store
      set((state) => ({
        messages: {
          ...state.messages,
          [chatId]: [...(state.messages[chatId] || []), messageData],
        },
      }));

      // Emit via socket for real-time delivery
      const socket = getSocket();
      if (socket) {
        if (chatType === 'group') {
          socket.emit('message:group:send', { message: messageData, groupId: chatId });
        } else {
          socket.emit('message:send', { message: messageData, receiverId: chatId });
        }
      }

      return messageData;
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  },

  /**
   * Add a received message to the store
   */
  addReceivedMessage: (chatId, message) => {
    set((state) => {
      const activeChat = state.activeChat;
      const isActiveChat = activeChat && activeChat.id === chatId;

      return {
        messages: {
          ...state.messages,
          [chatId]: [...(state.messages[chatId] || []), message],
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
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  },
}));

export default useChatStore;
