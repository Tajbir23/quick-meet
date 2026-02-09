/**
 * ============================================
 * IncomingCall — Modal overlay for incoming calls
 * ============================================
 * 
 * Shows caller info with accept/reject buttons.
 * Plays a ringtone oscillator for visibility.
 */

import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import { getInitials, stringToColor, playNotificationSound } from '../../utils/helpers';

const IncomingCall = () => {
  const { incomingCall, acceptCall, rejectCall, callStatus } = useCallStore();
  const ringIntervalRef = useRef(null);

  // Play ring sound
  useEffect(() => {
    if (incomingCall) {
      playNotificationSound('call');
      ringIntervalRef.current = setInterval(() => {
        playNotificationSound('call');
      }, 3000);
    }

    return () => {
      if (ringIntervalRef.current) {
        clearInterval(ringIntervalRef.current);
      }
    };
  }, [incomingCall]);

  if (!incomingCall || callStatus !== 'ringing') return null;

  const isVideoCall = incomingCall.callType === 'video';
  const callerName = incomingCall.callerName || 'Unknown';

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in">
      <div className="bg-dark-800 rounded-2xl p-8 shadow-2xl max-w-sm w-full mx-4 animate-slide-up">
        {/* Caller avatar */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-bold animate-pulse"
              style={{ backgroundColor: stringToColor(callerName) }}
            >
              {getInitials(callerName)}
            </div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-dark-700 flex items-center justify-center">
              {isVideoCall ? (
                <Video size={16} className="text-primary-400" />
              ) : (
                <Phone size={16} className="text-primary-400" />
              )}
            </div>
          </div>

          <h3 className="text-xl font-semibold text-white mb-1">{callerName}</h3>
          <p className="text-dark-400 text-sm">
            Incoming {isVideoCall ? 'video' : 'audio'} call...
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-6">
          {/* Reject */}
          <button
            onClick={rejectCall}
            className="flex flex-col items-center gap-2 group"
          >
            <div className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all group-hover:scale-110">
              <PhoneOff size={24} className="text-white" />
            </div>
            <span className="text-xs text-dark-400">Decline</span>
          </button>

          {/* Accept */}
          <button
            onClick={acceptCall}
            className="flex flex-col items-center gap-2 group"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-all group-hover:scale-110">
              <Phone size={24} className="text-white" />
            </div>
            <span className="text-xs text-dark-400">Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;
