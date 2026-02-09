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

import { useEffect } from 'react';
import useSocket from '../hooks/useSocket';
import useChatStore from '../store/useChatStore';
import useGroupStore from '../store/useGroupStore';
import useCallStore from '../store/useCallStore';
import MainLayout from '../components/Layout/MainLayout';
import VideoCall from '../components/Call/VideoCall';
import AudioCall from '../components/Call/AudioCall';
import GroupCall from '../components/Group/GroupCall';
import { CALL_STATUS } from '../utils/constants';

const HomePage = () => {
  // Initialize socket event listeners
  useSocket();

  const { fetchUsers, fetchUnreadCounts } = useChatStore();
  const { fetchMyGroups, joinAllGroupRooms } = useGroupStore();
  const { callStatus, callType, isGroupCall } = useCallStore();

  useEffect(() => {
    // Fetch initial data
    fetchUsers();
    fetchUnreadCounts();
    fetchMyGroups().then(() => {
      joinAllGroupRooms();
    });
  }, []);

  // Show call overlay if in a call (including FAILED so user sees the error state)
  const isInCall = callStatus === CALL_STATUS.CONNECTED ||
                   callStatus === CALL_STATUS.CALLING ||
                   callStatus === CALL_STATUS.RECONNECTING ||
                   callStatus === CALL_STATUS.FAILED;

  return (
    <>
      <MainLayout />

      {/* Call overlays */}
      {isInCall && isGroupCall && <GroupCall />}
      {isInCall && !isGroupCall && callType === 'video' && <VideoCall />}
      {isInCall && !isGroupCall && callType === 'audio' && <AudioCall />}
    </>
  );
};

export default HomePage;
