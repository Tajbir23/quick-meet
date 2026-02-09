/**
 * ============================================
 * AudioCall — Full-screen audio call overlay
 * ============================================
 * 
 * Similar to VideoCall but without video elements.
 * Shows avatar and call duration.
 * Remote audio is played via a hidden audio element.
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
  } = useCallStore();

  const remoteAudioRef = useRef(null);

  // Attach remote stream to audio element
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      // Explicit play() — autoPlay alone can be blocked by browser policy
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

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-dark-800 to-dark-900 z-40 flex flex-col">
      {/* Hidden audio element for remote audio playback */}
      <audio id="remote-audio" ref={remoteAudioRef} autoPlay playsInline />

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Avatar with pulse animation when connecting */}
        <div className="relative mb-6">
          <div
            className={`w-32 h-32 rounded-full flex items-center justify-center text-4xl font-bold ${
              isConnecting ? 'animate-pulse' : ''
            }`}
            style={{ backgroundColor: stringToColor(remoteUser?.username) }}
          >
            {getInitials(remoteUser?.username)}
          </div>
          
          {/* Connection status ring */}
          <div className={`absolute inset-0 rounded-full border-4 ${
            isConnected ? 'border-emerald-400/30' :
            isConnecting ? 'border-primary-400/30 animate-ping' :
            'border-dark-600'
          }`} />
        </div>

        {/* User info */}
        <h2 className="text-2xl font-semibold text-white mb-2">
          {remoteUser?.username || 'Unknown'}
        </h2>

        <p className="text-dark-400 mb-2">
          {isConnecting && 'Calling...'}
          {isConnected && 'On call'}
          {callStatus === CALL_STATUS.FAILED && 'Connection failed'}
          {callStatus === CALL_STATUS.RECONNECTING && 'Reconnecting...'}
        </p>

        {/* Duration */}
        {isConnected && (
          <p className="text-primary-400 text-lg font-mono">
            {formatDuration(callDuration)}
          </p>
        )}

        {/* Audio waveform visualization */}
        {isConnected && (
          <div className="flex items-center gap-1 mt-6">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="w-1 bg-primary-400 rounded-full"
                style={{
                  height: `${Math.random() * 20 + 10}px`,
                  animation: `pulse 0.${5 + i}s ease-in-out infinite alternate`,
                }}
              />
            ))}
          </div>
        )}

        {/* ICE state */}
        <div className="flex items-center gap-2 mt-4">
          <span className={`w-2 h-2 rounded-full ${
            iceState === 'connected' || iceState === 'completed' ? 'bg-emerald-400' :
            iceState === 'checking' ? 'bg-yellow-400 animate-pulse' :
            iceState === 'failed' ? 'bg-red-400' : 'bg-dark-400'
          }`} />
          <span className="text-xs text-dark-500 capitalize">{iceState}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="p-8">
        <CallControls />
      </div>
    </div>
  );
};

export default AudioCall;
