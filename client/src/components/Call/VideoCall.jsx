/**
 * ============================================
 * VideoCall — Full-screen video call overlay
 * ============================================
 */

import { useEffect, useRef } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useState } from 'react';
import useCallStore from '../../store/useCallStore';
import CallControls from './CallControls';
import { getInitials, stringToColor, formatDuration } from '../../utils/helpers';
import { CALL_STATUS } from '../../utils/constants';

const VideoCall = () => {
  const {
    localStream,
    remoteStream,
    remoteUser,
    callStatus,
    callDuration,
    isVideoEnabled,
    iceState,
    isMinimized,
  } = useCallStore();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [isLocalLarge, setIsLocalLarge] = useState(false);

  // Don't render full overlay when minimized
  if (isMinimized) return null;

  // Attach local stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Attach remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(e => {
        console.warn('Video autoplay blocked, retrying on user interaction:', e.message);
        const playOnClick = () => {
          remoteVideoRef.current?.play();
          document.removeEventListener('click', playOnClick);
        };
        document.addEventListener('click', playOnClick);
      });
    }
  }, [remoteStream]);

  const isConnecting = callStatus === CALL_STATUS.CALLING || callStatus === CALL_STATUS.RECONNECTING;
  const isConnected = callStatus === CALL_STATUS.CONNECTED;

  return (
    <div className="fixed inset-0 bg-dark-900 z-40 flex flex-col safe-top">
      {/* Status bar */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/70 via-black/40 to-transparent p-3 md:p-4 safe-top">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: stringToColor(remoteUser?.username) }}
            >
              {getInitials(remoteUser?.username)}
            </div>
            <div>
              <p className="text-white text-sm font-semibold">{remoteUser?.username || 'Unknown'}</p>
              <p className="text-white/60 text-xs">
                {isConnecting && 'Connecting...'}
                {isConnected && formatDuration(callDuration)}
                {callStatus === CALL_STATUS.FAILED && 'Connection failed'}
              </p>
            </div>
          </div>

          {/* ICE state */}
          <div className="flex items-center gap-1.5 bg-black/30 rounded-full px-2.5 py-1 backdrop-blur-sm">
            <span className={`w-2 h-2 rounded-full ${
              iceState === 'connected' || iceState === 'completed' ? 'bg-emerald-400' :
              iceState === 'checking' ? 'bg-yellow-400 animate-pulse' :
              iceState === 'failed' ? 'bg-red-400' : 'bg-dark-400'
            }`} />
            <span className="text-[10px] text-white/60 capitalize">{iceState}</span>
          </div>
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 relative bg-dark-900">
        {/* Remote video (main) */}
        {remoteStream ? (
          <video
            id="remote-video"
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${isLocalLarge ? 'absolute top-16 right-3 w-28 h-40 md:w-48 md:h-36 rounded-2xl z-20 shadow-2xl cursor-pointer border-2 border-dark-700/50' : ''}`}
            onClick={() => isLocalLarge && setIsLocalLarge(false)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <div
              className="w-28 h-28 md:w-32 md:h-32 rounded-full flex items-center justify-center text-4xl font-bold mb-4 shadow-2xl"
              style={{ backgroundColor: stringToColor(remoteUser?.username) }}
            >
              {getInitials(remoteUser?.username)}
            </div>
            {isConnecting && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex gap-1">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
                <p className="text-dark-400 text-sm">Calling...</p>
              </div>
            )}
          </div>
        )}

        {/* Local video (picture-in-picture) — responsive sizing */}
        {localStream && (
          <div
            className={`absolute shadow-2xl overflow-hidden cursor-pointer transition-all duration-300 ${
              isLocalLarge
                ? 'inset-0 rounded-none z-10'
                : 'bottom-28 md:bottom-24 right-3 w-24 h-36 xs:w-28 xs:h-40 md:w-48 md:h-36 rounded-2xl z-20 border-2 border-dark-700/50'
            }`}
            onClick={() => setIsLocalLarge(!isLocalLarge)}
          >
            {isVideoEnabled ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-dark-700 flex items-center justify-center">
                <span className="text-dark-400 text-xs">Camera off</span>
              </div>
            )}
          </div>
        )}

        {/* Swap button */}
        <button
          onClick={() => setIsLocalLarge(!isLocalLarge)}
          className="absolute top-16 md:top-20 right-3 z-30 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-all"
          title="Swap views"
        >
          {isLocalLarge ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pb-6 md:p-6 safe-bottom">
        <CallControls />
      </div>
    </div>
  );
};

export default VideoCall;
