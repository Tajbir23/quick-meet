/**
 * ============================================
 * Home Page — Main Application Layout
 * ============================================
 * 
 * This is the main page after login. Contains:
 * - Sidebar (user list, group list)
 * - Chat window (messages, input)
 * - Call overlays
 */

import { useEffect, useRef } from 'react';
import useSocket from '../hooks/useSocket';
import useChatStore from '../store/useChatStore';
import useGroupStore from '../store/useGroupStore';
import useCallStore from '../store/useCallStore';
import useChannelStore from '../store/useChannelStore';
import MainLayout from '../components/Layout/MainLayout';
import VideoCall from '../components/Call/VideoCall';
import AudioCall from '../components/Call/AudioCall';
import GroupCall from '../components/Group/GroupCall';
import MinimizedCall from '../components/Call/MinimizedCall';
import { getSocket } from '../services/socket';
import { CALL_STATUS } from '../utils/constants';

const HomePage = () => {
  // Initialize socket event listeners
  useSocket();

  const fetchUsers = useChatStore(s => s.fetchUsers);
  const fetchUnreadCounts = useChatStore(s => s.fetchUnreadCounts);
  const fetchConversations = useChatStore(s => s.fetchConversations);
  const fetchMyGroups = useGroupStore(s => s.fetchMyGroups);
  const joinAllGroupRooms = useGroupStore(s => s.joinAllGroupRooms);
  const fetchMyChannels = useChannelStore(s => s.fetchMyChannels);
  const joinAllChannelRooms = useChannelStore(s => s.joinAllChannelRooms);
  const callStatus = useCallStore(s => s.callStatus);
  const callType = useCallStore(s => s.callType);
  const isGroupCall = useCallStore(s => s.isGroupCall);
  const isMinimized = useCallStore(s => s.isMinimized);

  useEffect(() => {
    // Fetch initial data
    fetchUsers();
    fetchUnreadCounts();
    fetchConversations();
    fetchMyGroups().then(() => {
      joinAllGroupRooms();
    });
    fetchMyChannels().then(() => {
      joinAllChannelRooms();
    });
  }, []);

  // Show call overlay if in a call (including FAILED so user sees the error state)
  const isInCall = callStatus === CALL_STATUS.CONNECTED ||
                   callStatus === CALL_STATUS.CALLING ||
                   callStatus === CALL_STATUS.RECONNECTING ||
                   callStatus === CALL_STATUS.FAILED;

  // Warn user before refresh / tab close during an active call
  // Also persist call metadata so we can reconnect after refresh
  useEffect(() => {
    if (!isInCall) return;

    const handleBeforeUnload = (e) => {
      // Save call state for reconnection (localStorage survives tab/browser close)
      const state = useCallStore.getState();
      localStorage.setItem('pendingCallReconnect', JSON.stringify({
        callType: state.callType,
        remoteUserId: state.remoteUser?.userId,
        remoteUsername: state.remoteUser?.username,
        isGroupCall: state.isGroupCall,
        groupId: state.groupId,
        callDuration: state.callDuration,
        savedAt: Date.now(),
      }));

      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInCall]);

  // On mount: check if we need to reconnect a call after page refresh
  const reconnectAttempted = useRef(false);
  useEffect(() => {
    if (reconnectAttempted.current) return;
    const raw = localStorage.getItem('pendingCallReconnect');
    if (!raw) return;

    reconnectAttempted.current = true;
    localStorage.removeItem('pendingCallReconnect');

    const savedCall = JSON.parse(raw);
    if (!savedCall?.remoteUserId && !savedCall?.isGroupCall) return;

    // Only reconnect if saved within last 30 seconds (stale = call already ended)
    const age = Date.now() - (savedCall.savedAt || 0);
    if (age > 30000) {
      console.warn('⚠️ Saved call too old (' + Math.round(age / 1000) + 's), skipping reconnect');
      return;
    }

    console.log('🔄 Pending call reconnect found (' + Math.round(age / 1000) + 's ago), waiting for socket...');

    // Poll until socket is connected, then trigger reconnect
    const poll = setInterval(() => {
      const socket = getSocket();
      if (socket?.connected) {
        clearInterval(poll);
        console.log('🔄 Socket ready — reconnecting call');
        useCallStore.getState().reconnectCall(savedCall);
      }
    }, 500);

    // Give up after 15 seconds
    const timeout = setTimeout(() => {
      clearInterval(poll);
      console.warn('⚠️ Call reconnect timed out');
    }, 15000);

    return () => { clearInterval(poll); clearTimeout(timeout); };
  }, []);

  return (
    <>
      <MainLayout />

      {/* Call overlays — full or minimized */}
      {isInCall && isMinimized && <MinimizedCall />}
      {isInCall && isGroupCall && <GroupCall />}
      {isInCall && !isGroupCall && callType === 'video' && <VideoCall />}
      {isInCall && !isGroupCall && callType === 'audio' && <AudioCall />}
    </>
  );
};

export default HomePage;
