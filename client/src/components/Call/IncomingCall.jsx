/**
 * ============================================
 * IncomingCall — Modal overlay for incoming calls
 * ============================================
 */

import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import { getInitials, stringToColor, playNotificationSound, showNativeNotification, bringWindowToFront } from '../../utils/helpers';
import { SERVER_URL } from '../../utils/constants';

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
  const callerAvatar = incomingCall.callerAvatar || '';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in safe-top safe-bottom">
      <div className="bg-dark-800 rounded-3xl p-6 md:p-8 shadow-2xl max-w-sm w-full animate-bounce-in border border-dark-700/50">
        {/* Caller avatar */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-5">
            {/* Pulse rings */}
            <div className="absolute inset-0 rounded-full bg-primary-400/10 animate-ping" style={{ animationDuration: '2s' }} />
            <div className="absolute -inset-3 rounded-full border-2 border-primary-400/10 animate-ping" style={{ animationDuration: '3s' }} />
            
            {callerAvatar ? (
              <img
                src={`${SERVER_URL}${callerAvatar}`}
                alt={callerName}
                className="relative w-24 h-24 md:w-28 md:h-28 rounded-full object-cover shadow-2xl"
              />
            ) : (
              <div
                className="relative w-24 h-24 md:w-28 md:h-28 rounded-full flex items-center justify-center text-3xl md:text-4xl font-bold text-white shadow-2xl"
                style={{ backgroundColor: stringToColor(callerName) }}
              >
                {getInitials(callerName)}
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-dark-700 border-2 border-dark-800 flex items-center justify-center shadow-lg">
              {isVideoCall ? (
                <Video size={16} className="text-primary-400" />
              ) : (
                <Phone size={16} className="text-primary-400" />
              )}
            </div>
          </div>

          <h3 className="text-xl md:text-2xl font-bold text-white mb-1">{callerName}</h3>
          <p className="text-dark-400 text-sm">
            Incoming {isVideoCall ? 'video' : 'audio'} call
          </p>
        </div>

        {/* Actions — large touch targets */}
        <div className="flex items-center justify-center gap-8 md:gap-10">
          {/* Reject */}
          <button
            onClick={rejectCall}
            className="flex flex-col items-center gap-2.5 group"
          >
            <div className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 flex items-center justify-center transition-all group-active:scale-90 shadow-lg shadow-red-500/30">
              <PhoneOff size={26} className="text-white" />
            </div>
            <span className="text-xs text-dark-400 font-medium">Decline</span>
          </button>

          {/* Accept */}
          <button
            onClick={acceptCall}
            className="flex flex-col items-center gap-2.5 group"
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 flex items-center justify-center transition-all group-active:scale-90 shadow-lg shadow-emerald-500/30 animate-pulse">
              <Phone size={26} className="text-white" />
            </div>
            <span className="text-xs text-dark-400 font-medium">Accept</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;
