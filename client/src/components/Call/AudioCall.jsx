/**
 * ============================================
 * AudioCall — Full-screen audio call overlay
 * ============================================
 */

import { useEffect, useRef } from 'react';
import useCallStore from '../../store/useCallStore';
import CallControls from './CallControls';
import { getInitials, stringToColor, formatDuration } from '../../utils/helpers';
import { CALL_STATUS } from '../../utils/constants';

const AudioCall = () => {
  const {
    remoteStream,
    remoteUser,
    callStatus,
    callDuration,
    iceState,
    isMinimized,
  } = useCallStore();

  const remoteAudioRef = useRef(null);

  // Attach remote stream to audio element
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(e => {
        console.warn('Audio autoplay blocked, retrying on user interaction:', e.message);
        const playOnClick = () => {
          remoteAudioRef.current?.play();
          document.removeEventListener('click', playOnClick);
        };
        document.addEventListener('click', playOnClick);
      });
    }
  }, [remoteStream]);

  const isConnecting = callStatus === CALL_STATUS.CALLING || callStatus === CALL_STATUS.RECONNECTING;
  const isConnected = callStatus === CALL_STATUS.CONNECTED;

  // Don't render full overlay when minimized (must be after all hooks)
  if (isMinimized) return null;

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-dark-800 via-dark-900 to-dark-950 z-40 flex flex-col safe-top safe-bottom">
      {/* Hidden audio element for remote audio playback */}
      <audio id="remote-audio" ref={remoteAudioRef} autoPlay playsInline />

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Avatar with pulse animation when connecting */}
        <div className="relative mb-8">
          {/* Outer ring animation */}
          {isConnecting && (
            <>
              <div className="absolute inset-0 rounded-full border-4 border-primary-400/20 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="absolute -inset-3 rounded-full border-2 border-primary-400/10 animate-ping" style={{ animationDuration: '3s' }} />
            </>
          )}
          {isConnected && (
            <div className="absolute -inset-2 rounded-full border-2 border-emerald-400/20" />
          )}
          
          <div
            className={`w-28 h-28 md:w-32 md:h-32 rounded-full flex items-center justify-center text-4xl md:text-5xl font-bold text-white shadow-2xl ${
              isConnecting ? 'animate-pulse' : ''
            }`}
            style={{ backgroundColor: stringToColor(remoteUser?.username) }}
          >
            {getInitials(remoteUser?.username)}
          </div>
        </div>

        {/* User info */}
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
          {remoteUser?.username || 'Unknown'}
        </h2>

        <p className="text-dark-400 text-sm md:text-base mb-3">
          {isConnecting && 'Calling...'}
          {isConnected && 'On call'}
          {callStatus === CALL_STATUS.FAILED && 'Connection failed'}
          {callStatus === CALL_STATUS.RECONNECTING && 'Reconnecting...'}
        </p>

        {/* Duration */}
        {isConnected && (
          <p className="text-primary-400 text-xl md:text-2xl font-mono tracking-wider">
            {formatDuration(callDuration)}
          </p>
        )}

        {/* Audio waveform visualization */}
        {isConnected && (
          <div className="flex items-end gap-1.5 mt-8 h-8">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="audio-wave-bar" />
            ))}
          </div>
        )}

        {/* ICE state */}
        <div className="flex items-center gap-2 mt-6 bg-dark-800/50 rounded-full px-3 py-1.5 backdrop-blur-sm">
          <span className={`w-2 h-2 rounded-full ${
            iceState === 'connected' || iceState === 'completed' ? 'bg-emerald-400' :
            iceState === 'checking' ? 'bg-yellow-400 animate-pulse' :
            iceState === 'failed' ? 'bg-red-400' : 'bg-dark-400'
          }`} />
          <span className="text-xs text-dark-400 capitalize">{iceState}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="p-6 md:p-8">
        <CallControls />
      </div>
    </div>
  );
};

export default AudioCall;
