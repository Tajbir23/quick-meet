/**
 * ============================================
 * Channel Store (Zustand) — Telegram-Style
 * ============================================
 * 
 * Manages: Channels, subscriptions, posts, comments,
 * reactions, polls, live streams, admin actions
 */

import { create } from 'zustand';
import api from '../services/api';
import { getSocket } from '../services/socket';

const useChannelStore = create((set, get) => ({
  // ─── STATE ────────────────────────────────
  myChannels: [],          // Channels user is subscribed to
  discoverChannels: [],    // Public channels for discovery
  activeChannel: null,     // Currently selected channel
  channelPosts: [],        // Posts in active channel
  pinnedPosts: [],         // Pinned posts in active channel
  scheduledPosts: [],      // Scheduled posts (admin view)
  channelStats: null,      // Stats for active channel
  isLoading: false,
  isLoadingPosts: false,
  postsPage: 1,
  hasMorePosts: true,

  // Live stream state
  liveStream: null,
  liveChat: [],
  liveViewerCount: 0,

  // Typing indicators
  typingUsers: {},        // { postId: [{ userId, username }] }

  // ══════════════════════════════════════════
  // CHANNEL ACTIONS
  // ══════════════════════════════════════════

  fetchMyChannels: async () => {
    set({ isLoading: true });
    try {
      const res = await api.get('/channels');
      set({ myChannels: res.data.data.channels, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch channels:', error);
      set({ isLoading: false });
    }
  },

  fetchDiscoverChannels: async (search = '') => {
    try {
      const res = await api.get(`/channels/discover${search ? `?search=${search}` : ''}`);
      set({ discoverChannels: res.data.data.channels });
    } catch (error) {
      console.error('Failed to fetch discover channels:', error);
    }
  },

  createChannel: async (data) => {
    try {
      const res = await api.post('/channels', data);
      const channel = res.data.data.channel;

      set(state => ({
        myChannels: [channel, ...state.myChannels],
      }));

      // Join socket room
      const socket = getSocket();
      if (socket) {
        socket.emit('channel:join-room', { channelId: channel._id });
      }

      return { success: true, channel };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to create channel',
      };
    }
  },

  editChannel: async (channelId, data) => {
    try {
      const res = await api.put(`/channels/${channelId}`, data);
      const channel = res.data.data.channel;

      set(state => ({
        myChannels: state.myChannels.map(c => c._id === channelId ? channel : c),
        activeChannel: state.activeChannel?._id === channelId
          ? { ...state.activeChannel, ...channel }
          : state.activeChannel,
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to edit channel',
      };
    }
  },

  deleteChannel: async (channelId) => {
    try {
      await api.delete(`/channels/${channelId}`);
      set(state => ({
        myChannels: state.myChannels.filter(c => c._id !== channelId),
        activeChannel: state.activeChannel?._id === channelId ? null : state.activeChannel,
      }));
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to delete channel',
      };
    }
  },

  getChannelById: async (channelId) => {
    try {
      const res = await api.get(`/channels/${channelId}`);
      return { success: true, channel: res.data.data.channel };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  setActiveChannel: (channel) => {
    set({
      activeChannel: channel,
      channelPosts: [],
      postsPage: 1,
      hasMorePosts: true,
      pinnedPosts: [],
      scheduledPosts: [],
      channelStats: null,
      liveChat: [],
    });
  },

  // ══════════════════════════════════════════
  // SUBSCRIPTION
  // ══════════════════════════════════════════

  subscribeChannel: async (channelId) => {
    try {
      const res = await api.post(`/channels/${channelId}/subscribe`);
      const channel = res.data.data.channel;

      set(state => ({
        myChannels: [channel, ...state.myChannels],
      }));

      const socket = getSocket();
      if (socket) {
        socket.emit('channel:join-room', { channelId });
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to subscribe',
      };
    }
  },

  unsubscribeChannel: async (channelId) => {
    try {
      await api.post(`/channels/${channelId}/unsubscribe`);

      set(state => ({
        myChannels: state.myChannels.filter(c => c._id !== channelId),
        activeChannel: state.activeChannel?._id === channelId ? null : state.activeChannel,
      }));

      const socket = getSocket();
      if (socket) {
        socket.emit('channel:leave-room', { channelId });
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to unsubscribe',
      };
    }
  },

  toggleMute: async (channelId) => {
    try {
      const res = await api.post(`/channels/${channelId}/mute`);
      return { success: true, isMuted: res.data.data.isMuted };
    } catch (error) {
      return { success: false };
    }
  },

  // ══════════════════════════════════════════
  // INVITE LINKS
  // ══════════════════════════════════════════

  createInviteLink: async (channelId, options = {}) => {
    try {
      const res = await api.post(`/channels/${channelId}/invite-links`, options);
      return { success: true, data: res.data.data };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  getInviteLinks: async (channelId) => {
    try {
      const res = await api.get(`/channels/${channelId}/invite-links`);
      return { success: true, data: res.data.data };
    } catch (error) {
      return { success: false };
    }
  },

  revokeInviteLink: async (channelId, linkId) => {
    try {
      await api.delete(`/channels/${channelId}/invite-links/${linkId}`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  joinViaInviteLink: async (code, message = '') => {
    try {
      const res = await api.post(`/channels/join/${code}`, { message });
      if (res.data.data?.channel) {
        set(state => ({
          myChannels: [res.data.data.channel, ...state.myChannels],
        }));

        const socket = getSocket();
        if (socket) {
          socket.emit('channel:join-room', { channelId: res.data.data.channel._id });
        }
      }
      return {
        success: true,
        message: res.data.message,
        requiresApproval: res.data.data?.requiresApproval,
      };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  // ══════════════════════════════════════════
  // JOIN REQUESTS
  // ══════════════════════════════════════════

  getJoinRequests: async (channelId) => {
    try {
      const res = await api.get(`/channels/${channelId}/join-requests`);
      return { success: true, requests: res.data.data.requests };
    } catch (error) {
      return { success: false };
    }
  },

  approveJoinRequest: async (channelId, requestId) => {
    try {
      await api.post(`/channels/${channelId}/join-requests/${requestId}/approve`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  rejectJoinRequest: async (channelId, requestId) => {
    try {
      await api.post(`/channels/${channelId}/join-requests/${requestId}/reject`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  // ══════════════════════════════════════════
  // MEMBER MANAGEMENT
  // ══════════════════════════════════════════

  changeMemberRole: async (channelId, userId, role, permissions = {}, customTitle = '') => {
    try {
      const res = await api.put(`/channels/${channelId}/members/${userId}/role`, {
        role, permissions, customTitle,
      });
      if (res.data.data?.channel) {
        set(state => ({
          myChannels: state.myChannels.map(c =>
            c._id === channelId ? res.data.data.channel : c
          ),
        }));
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  transferOwnership: async (channelId, userId) => {
    try {
      await api.post(`/channels/${channelId}/transfer-ownership`, { userId });
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  banMember: async (channelId, userId, reason = '') => {
    try {
      await api.post(`/channels/${channelId}/ban/${userId}`, { reason });
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  unbanMember: async (channelId, userId) => {
    try {
      await api.post(`/channels/${channelId}/unban/${userId}`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  removeMember: async (channelId, userId) => {
    try {
      await api.post(`/channels/${channelId}/remove-member/${userId}`);
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  getBannedMembers: async (channelId) => {
    try {
      const res = await api.get(`/channels/${channelId}/banned`);
      return { success: true, banned: res.data.data.banned };
    } catch (error) {
      return { success: false };
    }
  },

  // ══════════════════════════════════════════
  // POSTS
  // ══════════════════════════════════════════

  fetchPosts: async (channelId, page = 1) => {
    set({ isLoadingPosts: true });
    try {
      const res = await api.get(`/channels/${channelId}/posts?page=${page}&limit=30`);
      const posts = res.data.data.posts;

      set(state => ({
        channelPosts: page === 1
          ? posts
          : [...state.channelPosts, ...posts],
        postsPage: page,
        hasMorePosts: posts.length === 30,
        isLoadingPosts: false,
      }));

      // Mark as viewed via socket
      const socket = getSocket();
      if (socket && posts.length > 0) {
        socket.emit('channel:mark-viewed', { postIds: posts.map(p => p._id) });
      }

      return { success: true };
    } catch (error) {
      set({ isLoadingPosts: false });
      return { success: false };
    }
  },

  fetchMorePosts: async (channelId) => {
    const { postsPage, hasMorePosts, isLoadingPosts } = get();
    if (!hasMorePosts || isLoadingPosts) return;
    return get().fetchPosts(channelId, postsPage + 1);
  },

  createPost: async (channelId, postData) => {
    // Generate temporary ID for optimistic post
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const currentUser = JSON.parse(localStorage.getItem('user') || '{}');

    // Optimistic post (pending state)
    const optimisticPost = {
      _id: tempId,
      tempId,
      channel: channelId,
      sender: { _id: currentUser._id, username: currentUser.username, avatar: currentUser.avatar },
      content: postData.content || '',
      type: postData.type || 'text',
      status: 'pending',
      reactions: [],
      comments: [],
      views: 0,
      commentCount: 0,
      totalReactions: 0,
      createdAt: new Date().toISOString(),
    };

    // Insert optimistic post at the top
    set(state => ({
      channelPosts: [optimisticPost, ...state.channelPosts],
    }));

    try {
      const res = await api.post(`/channels/${channelId}/posts`, postData);
      const realPost = res.data.data.post;

      // Replace optimistic post with real post (status: sent)
      set(state => ({
        channelPosts: state.channelPosts.map(p =>
          p._id === tempId ? { ...realPost, status: 'sent' } : p
        ),
      }));

      return { success: true, post: realPost };
    } catch (error) {
      // Mark as failed
      set(state => ({
        channelPosts: state.channelPosts.map(p =>
          p._id === tempId ? { ...p, status: 'failed' } : p
        ),
      }));
      return { success: false, message: error.response?.data?.message };
    }
  },

  retryCreatePost: async (channelId, tempPost) => {
    // Remove failed post
    set(state => ({
      channelPosts: state.channelPosts.filter(p => p._id !== tempPost._id),
    }));
    // Re-send
    return get().createPost(channelId, {
      content: tempPost.content,
      type: tempPost.type,
    });
  },

  editPost: async (channelId, postId, content) => {
    try {
      const res = await api.put(`/channels/${channelId}/posts/${postId}`, { content });
      return { success: true, post: res.data.data.post };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  deletePost: async (channelId, postId) => {
    try {
      await api.delete(`/channels/${channelId}/posts/${postId}`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  togglePinPost: async (channelId, postId) => {
    try {
      await api.post(`/channels/${channelId}/posts/${postId}/pin`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  fetchPinnedPosts: async (channelId) => {
    try {
      const res = await api.get(`/channels/${channelId}/posts/pinned`);
      set({ pinnedPosts: res.data.data.posts });
    } catch (error) {
      console.error('Fetch pinned posts error:', error);
    }
  },

  fetchScheduledPosts: async (channelId) => {
    try {
      const res = await api.get(`/channels/${channelId}/posts/scheduled`);
      set({ scheduledPosts: res.data.data.posts });
    } catch (error) {
      console.error('Fetch scheduled posts error:', error);
    }
  },

  // ══════════════════════════════════════════
  // REACTIONS
  // ══════════════════════════════════════════

  toggleReaction: async (channelId, postId, emoji) => {
    try {
      const res = await api.post(`/channels/${channelId}/posts/${postId}/react`, { emoji });
      if (res.data.success) {
        // Update local state immediately from API response (don't wait for socket)
        set(state => ({
          channelPosts: state.channelPosts.map(p =>
            p._id === postId
              ? { ...p, reactions: res.data.data.reactions, totalReactions: res.data.data.totalReactions }
              : p
          ),
        }));
      }
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  // ══════════════════════════════════════════
  // COMMENTS
  // ══════════════════════════════════════════

  addComment: async (channelId, postId, content) => {
    try {
      const res = await api.post(`/channels/${channelId}/posts/${postId}/comments`, { content });
      return { success: true, comment: res.data.data.comment };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  deleteComment: async (channelId, postId, commentId) => {
    try {
      await api.delete(`/channels/${channelId}/posts/${postId}/comments/${commentId}`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  // ══════════════════════════════════════════
  // POLLS
  // ══════════════════════════════════════════

  votePoll: async (channelId, postId, optionIds) => {
    try {
      const res = await api.post(`/channels/${channelId}/posts/${postId}/vote`, { optionIds });
      return { success: true, poll: res.data.data.poll };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  closePoll: async (channelId, postId) => {
    try {
      await api.post(`/channels/${channelId}/posts/${postId}/close-poll`);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  // ══════════════════════════════════════════
  // FORWARD
  // ══════════════════════════════════════════

  forwardPost: async (channelId, postId, targetChannelId) => {
    try {
      await api.post(`/channels/${channelId}/posts/${postId}/forward`, { targetChannelId });
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  // ══════════════════════════════════════════
  // LIVE STREAM
  // ══════════════════════════════════════════

  startLiveStream: async (channelId, options = {}) => {
    try {
      const res = await api.post(`/channels/${channelId}/live-stream/start`, options);
      set({ liveStream: res.data.data.liveStream });
      return { success: true, data: res.data.data };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  stopLiveStream: async (channelId) => {
    try {
      await api.post(`/channels/${channelId}/live-stream/stop`);
      set({ liveStream: null, liveChat: [], liveViewerCount: 0 });
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  joinLiveStream: async (channelId) => {
    try {
      const res = await api.post(`/channels/${channelId}/live-stream/join`);
      set({ liveStream: res.data.data.liveStream });

      const socket = getSocket();
      if (socket) {
        socket.emit('channel:live-stream-request-offer', { channelId });
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message };
    }
  },

  leaveLiveStream: async (channelId) => {
    try {
      await api.post(`/channels/${channelId}/live-stream/leave`);
      set({ liveStream: null, liveChat: [] });
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  sendLiveChatMessage: (channelId, content) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('channel:live-chat-message', { channelId, content });
    }
  },

  // ══════════════════════════════════════════
  // STATISTICS
  // ══════════════════════════════════════════

  fetchChannelStats: async (channelId) => {
    try {
      const res = await api.get(`/channels/${channelId}/stats`);
      set({ channelStats: res.data.data.stats });
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  // ══════════════════════════════════════════
  // SOCKET EVENT HANDLERS
  // ══════════════════════════════════════════

  /**
   * Process incoming socket events (called from useSocket hook)
   */
  handleNewPost: (data) => {
    set(state => {
      if (state.activeChannel?._id === data.channelId) {
        // Check if we already have a real post with this ID
        const exists = state.channelPosts.some(p => p._id === data.post._id && !p.tempId);
        if (exists) return {};

        // Check if there's an optimistic (temp) post from us that matches
        const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
        const tempPost = state.channelPosts.find(
          p => p.tempId && p.sender?._id === currentUser._id &&
               p.content === data.post.content && p.channel === data.channelId
        );

        if (tempPost) {
          // Replace optimistic post with real post (keep sent status)
          return {
            channelPosts: state.channelPosts.map(p =>
              p._id === tempPost._id ? { ...data.post, status: 'sent' } : p
            ),
          };
        }

        return { channelPosts: [data.post, ...state.channelPosts] };
      }
      return {};
    });
  },

  handlePostEdited: (data) => {
    set(state => ({
      channelPosts: state.channelPosts.map(p =>
        p._id === data.post._id ? data.post : p
      ),
    }));
  },

  handlePostDeleted: (data) => {
    set(state => ({
      channelPosts: state.channelPosts.filter(p => p._id !== data.postId),
    }));
  },

  handlePostPinned: (data) => {
    set(state => ({
      channelPosts: state.channelPosts.map(p =>
        p._id === data.postId ? { ...p, isPinned: data.isPinned } : p
      ),
    }));
  },

  handleReactionUpdated: (data) => {
    set(state => ({
      channelPosts: state.channelPosts.map(p =>
        p._id === data.postId
          ? { ...p, reactions: data.reactions, totalReactions: data.totalReactions }
          : p
      ),
    }));
  },

  handleNewComment: (data) => {
    set(state => ({
      channelPosts: state.channelPosts.map(p =>
        p._id === data.postId
          ? {
              ...p,
              comments: [...(p.comments || []), data.comment],
              commentCount: data.commentCount,
            }
          : p
      ),
    }));
  },

  handleCommentDeleted: (data) => {
    set(state => ({
      channelPosts: state.channelPosts.map(p =>
        p._id === data.postId
          ? {
              ...p,
              comments: (p.comments || []).map(c =>
                c._id === data.commentId
                  ? { ...c, isDeleted: true, content: 'This comment was deleted' }
                  : c
              ),
              commentCount: data.commentCount,
            }
          : p
      ),
    }));
  },

  handlePollUpdated: (data) => {
    set(state => ({
      channelPosts: state.channelPosts.map(p =>
        p._id === data.postId ? { ...p, poll: data.poll } : p
      ),
    }));
  },

  handleChannelUpdated: (data) => {
    set(state => ({
      myChannels: state.myChannels.map(c =>
        c._id === data.channelId ? { ...c, ...data.channel } : c
      ),
      activeChannel: state.activeChannel?._id === data.channelId
        ? { ...state.activeChannel, ...data.channel }
        : state.activeChannel,
    }));
  },

  handleChannelDeleted: (data) => {
    set(state => ({
      myChannels: state.myChannels.filter(c => c._id !== data.channelId),
      activeChannel: state.activeChannel?._id === data.channelId ? null : state.activeChannel,
    }));
  },

  handleLiveStreamStarted: (data) => {
    set(state => {
      const updates = {};
      if (state.activeChannel?._id === data.channelId) {
        updates.liveStream = data.liveStream;
        updates.liveChat = [];
        updates.liveViewerCount = 0;
        updates.activeChannel = {
          ...state.activeChannel,
          liveStream: { ...state.activeChannel.liveStream, isLive: true, title: data.liveStream?.title },
        };
      }
      // Update in myChannels list too
      updates.myChannels = state.myChannels.map(c =>
        c._id === data.channelId
          ? { ...c, liveStream: { ...c.liveStream, isLive: true, title: data.liveStream?.title } }
          : c
      );
      return updates;
    });
  },

  handleLiveStreamEnded: (data) => {
    set(state => {
      const updates = { liveStream: null, liveChat: [], liveViewerCount: 0 };
      if (state.activeChannel?._id === data.channelId) {
        updates.activeChannel = {
          ...state.activeChannel,
          liveStream: { ...state.activeChannel.liveStream, isLive: false },
        };
      }
      updates.myChannels = state.myChannels.map(c =>
        c._id === data.channelId
          ? { ...c, liveStream: { ...c.liveStream, isLive: false } }
          : c
      );
      return updates;
    });
  },

  handleLiveChatMessage: (data) => {
    set(state => {
      if (state.activeChannel?._id === data.channelId) {
        return { liveChat: [...state.liveChat, data.message].slice(-200) }; // Keep last 200
      }
      return {};
    });
  },

  handleLiveViewerCount: (data) => {
    set(state => {
      if (state.activeChannel?._id === data.channelId) {
        return { liveViewerCount: data.viewerCount };
      }
      return {};
    });
  },

  handleTyping: (data) => {
    set(state => {
      const key = data.postId || 'channel';
      const current = state.typingUsers[key] || [];
      if (data.isTyping) {
        if (!current.find(u => u.userId === data.userId)) {
          return {
            typingUsers: {
              ...state.typingUsers,
              [key]: [...current, { userId: data.userId, username: data.username }],
            },
          };
        }
      } else {
        return {
          typingUsers: {
            ...state.typingUsers,
            [key]: current.filter(u => u.userId !== data.userId),
          },
        };
      }
      return {};
    });
  },

  // ══════════════════════════════════════════
  // SOCKET ROOM MANAGEMENT
  // ══════════════════════════════════════════

  joinAllChannelRooms: () => {
    const socket = getSocket();
    if (!socket) return;

    const { myChannels } = get();
    myChannels.forEach(channel => {
      socket.emit('channel:join-room', { channelId: channel._id });
    });
  },
}));

export default useChannelStore;
