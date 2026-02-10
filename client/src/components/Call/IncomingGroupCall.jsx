/**
 * ============================================
 * IncomingGroupCall — Notification for group calls
 * ============================================
 * 
 * Shows a toast-like notification at the top when
 * someone starts a group call. User can Join or Dismiss.
 */

import { useEffect, useRef } from 'react';
import { Phone, Video, X, Users } from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import { playNotificationSound } from '../../utils/helpers';

const IncomingGroupCall = () => {
  const { incomingGroupCall, joinGroupCall, dismissGroupCall, callStatus } = useCallStore();
  const ringIntervalRef = useRef(null);

  // Play ring sound periodically
  useEffect(() => {
    if (incomingGroupCall) {
      ringIntervalRef.current = setInterval(() => {
        playNotificationSound('call');
      }, 4000);
    }

    return () => {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
      }
    };
  }, [incomingGroupCall]);

  // Auto-dismiss after 30 seconds
  useEffect(() => {
    if (!incomingGroupCall) return;
    const timeout = setTimeout(() => {
      dismissGroupCall();
    }, 30000);
    return () => clearTimeout(timeout);
  }, [incomingGroupCall, dismissGroupCall]);

  if (!incomingGroupCall || callStatus !== 'idle') return null;

  const { groupId, groupName, callerName, participantCount } = incomingGroupCall;

  const handleJoinAudio = async () => {
    try {
      await joinGroupCall(groupId, 'audio');
    } catch (err) {
      console.error('Failed to join group call:', err);
    }
  };

  const handleJoinVideo = async () => {
    try {
      await joinGroupCall(groupId, 'video');
    } catch (err) {
      console.error('Failed to join group call:', err);
    }
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm animate-slide-down safe-top">
      <div className="bg-dark-800 border border-dark-600/50 rounded-2xl shadow-2xl shadow-black/40 p-4">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className="w-11 h-11 rounded-full bg-primary-500/20 flex items-center justify-center flex-shrink-0">
            <Users size={20} className="text-primary-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {groupName || 'Group Call'}
            </p>
            <p className="text-xs text-dark-400 mt-0.5">
              {callerName} started a call · {participantCount} in call
            </p>
          </div>
          <button
            onClick={dismissGroupCall}
            className="btn-icon w-8 h-8 text-dark-400 hover:text-white flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleJoinAudio}
            className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-500/20"
          >
            <Phone size={16} />
            Join Audio
          </button>
          <button
            onClick={handleJoinVideo}
            className="flex-1 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow-lg shadow-primary-500/20"
          >
            <Video size={16} />
            Join Video
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingGroupCall;
