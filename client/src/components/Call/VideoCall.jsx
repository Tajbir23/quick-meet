/**
 * ============================================
 * VideoCall — Full-screen video call overlay
 * ============================================
 */

import { useEffect, useRef } from 'react';
import { Maximize2, Minimize2, MicOff } from 'lucide-react';
import { useState } from 'react';
import useCallStore from '../../store/useCallStore';
import CallControls from './CallControls';
import useSpeakingDetector from '../../hooks/useSpeakingDetector';
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
    isAudioEnabled,
    iceState,
    isMinimized,
    remoteAudioMuted,
  } = useCallStore();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [isLocalLarge, setIsLocalLarge] = useState(false);

  const localSpeaking = useSpeakingDetector(localStream);
  const remoteSpeaking = useSpeakingDetector(remoteStream);

  // Attach local stream (re-run on maximize too)
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, isMinimized]);

  // Attach remote stream (re-run on maximize too)
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
  }, [remoteStream, isMinimized]);

  const isConnecting = callStatus === CALL_STATUS.CALLING || callStatus === CALL_STATUS.RECONNECTING;
  const isConnected = callStatus === CALL_STATUS.CONNECTED;

  return (
    <div className={`fixed inset-0 bg-dark-900 z-40 flex flex-col safe-top ${isMinimized ? 'hidden' : ''}`}>
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
            {/* Remote mute indicator */}
            {remoteAudioMuted && (
              <span className="flex items-center gap-1 mr-1">
                <MicOff size={10} className="text-red-400" />
              </span>
            )}
            {/* Speaking indicator */}
            {remoteSpeaking && !remoteAudioMuted && (
              <span className="flex items-center gap-1 mr-1">
                <span className="flex gap-0.5 items-end h-3">
                  {[...Array(3)].map((_, i) => (
                    <span key={i} className="w-0.5 bg-emerald-400 rounded-full animate-speaking-bar" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
              </span>
            )}
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
        {/* Remote speaking glow bar at top */}
        {remoteSpeaking && !remoteAudioMuted && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400/0 via-emerald-400 to-emerald-400/0 z-10 animate-pulse" />
        )}

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
                : 'bottom-28 md:bottom-24 right-3 w-24 h-36 xs:w-28 xs:h-40 md:w-48 md:h-36 rounded-2xl z-20 border-2'
            } ${
              !isLocalLarge && localSpeaking && isAudioEnabled
                ? 'border-emerald-400 shadow-emerald-400/20'
                : !isLocalLarge ? 'border-dark-700/50' : ''
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
            {/* Local mute indicator */}
            {!isAudioEnabled && !isLocalLarge && (
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-red-500/80 flex items-center justify-center">
                <MicOff size={10} className="text-white" />
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
