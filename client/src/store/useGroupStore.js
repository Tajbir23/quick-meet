/**
 * ============================================
 * Group Store (Zustand)
 * ============================================
 * 
 * Manages: Groups, group membership, group discovery
 */

import { create } from 'zustand';
import api from '../services/api';
import { getSocket } from '../services/socket';

const useGroupStore = create((set, get) => ({
  // State
  myGroups: [],          // Groups user belongs to
  allGroups: [],         // All available groups (for discovery)
  activeGroup: null,     // Currently selected group
  isLoading: false,

  // Active group calls: { groupId: { participants: [{userId, username}] } }
  activeGroupCalls: {},

  // ============================================
  // ACTIONS
  // ============================================

  /**
   * Fetch groups current user belongs to
   */
  fetchMyGroups: async () => {
    set({ isLoading: true });
    try {
      const res = await api.get('/groups');
      set({ myGroups: res.data.data.groups, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch groups:', error);
      set({ isLoading: false });
    }
  },

  /**
   * Fetch all available groups
   */
  fetchAllGroups: async () => {
    try {
      const res = await api.get('/groups/all');
      set({ allGroups: res.data.data.groups });
    } catch (error) {
      console.error('Failed to fetch all groups:', error);
    }
  },

  /**
   * Create a new group
   */
  createGroup: async (name, description, members = []) => {
    try {
      const res = await api.post('/groups', { name, description, members });
      const newGroup = res.data.data.group;

      set((state) => ({
        myGroups: [newGroup, ...state.myGroups],
      }));

      // Join socket room for this group
      const socket = getSocket();
      if (socket) {
        socket.emit('group:join-room', { groupId: newGroup._id });
      }

      return { success: true, group: newGroup };
    } catch (error) {
      console.error('Failed to create group:', error);
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to create group',
      };
    }
  },

  /**
   * Join an existing group
   */
  joinGroup: async (groupId) => {
    try {
      const res = await api.post(`/groups/${groupId}/join`);
      const group = res.data.data.group;

      set((state) => ({
        myGroups: [group, ...state.myGroups],
      }));

      // Join socket room
      const socket = getSocket();
      if (socket) {
        socket.emit('group:join-room', { groupId });
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to join group',
      };
    }
  },

  /**
   * Leave a group
   */
  leaveGroup: async (groupId) => {
    try {
      await api.post(`/groups/${groupId}/leave`);

      set((state) => ({
        myGroups: state.myGroups.filter(g => g._id !== groupId),
        activeGroup: state.activeGroup?._id === groupId ? null : state.activeGroup,
      }));

      // Leave socket room
      const socket = getSocket();
      if (socket) {
        socket.emit('group:leave-room', { groupId });
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to leave group',
      };
    }
  },

  /**
   * Add a member to group (admin only)
   */
  addMember: async (groupId, userId) => {
    try {
      const res = await api.post(`/groups/${groupId}/add-member`, { userId });

      // Update group in store
      set((state) => ({
        myGroups: state.myGroups.map(g =>
          g._id === groupId ? res.data.data.group : g
        ),
      }));

      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Failed to add member',
      };
    }
  },

  /**
   * Set active group
   */
  setActiveGroup: (group) => set({ activeGroup: group }),

  /**
   * Update active group call status (from socket events)
   */
  setActiveGroupCall: (groupId, participants) => {
    set((state) => ({
      activeGroupCalls: {
        ...state.activeGroupCalls,
        [groupId]: { participants },
      },
    }));
  },

  /**
   * Remove active group call (call ended)
   */
  removeActiveGroupCall: (groupId) => {
    set((state) => {
      const calls = { ...state.activeGroupCalls };
      delete calls[groupId];
      return { activeGroupCalls: calls };
    });
  },

  /**
   * Bulk set active calls (on connect)
   */
  setActiveGroupCalls: (callsArray) => {
    const calls = {};
    callsArray.forEach(({ groupId, participants }) => {
      calls[groupId] = { participants };
    });
    set({ activeGroupCalls: calls });
  },

  /**
   * Join socket rooms for all groups
   */
  joinAllGroupRooms: () => {
    const socket = getSocket();
    if (!socket) return;

    const { myGroups } = get();
    myGroups.forEach(group => {
      socket.emit('group:join-room', { groupId: group._id });
    });
    // After joining rooms, query active group calls for banners/badges
    socket.emit('group-call:get-active-calls');
  },
}));

export default useGroupStore;
