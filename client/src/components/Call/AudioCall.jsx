/**
 * ============================================
 * AudioCall — Full-screen audio call overlay
 * ============================================
 */

import { useEffect, useRef } from 'react';
import { MicOff } from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import CallControls from './CallControls';
import PingIndicator from './PingIndicator';
import useSpeakingDetector from '../../hooks/useSpeakingDetector';
import { getInitials, stringToColor, formatDuration } from '../../utils/helpers';
import { CALL_STATUS, SERVER_URL } from '../../utils/constants';

const AudioCall = () => {
  const {
    localStream,
    remoteStream,
    remoteUser,
    callStatus,
    callDuration,
    isAudioEnabled,
    iceState,
    isMinimized,
    isPipMode,
    remoteAudioMuted,
  } = useCallStore();

  const remoteAudioRef = useRef(null);
  const remoteSpeaking = useSpeakingDetector(remoteStream);
  const localSpeaking = useSpeakingDetector(localStream);

  // Attach remote stream to audio element (re-run on maximize too)
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
  }, [remoteStream, isMinimized]);

  const isConnecting = callStatus === CALL_STATUS.CALLING || callStatus === CALL_STATUS.RECONNECTING;
  const isConnected = callStatus === CALL_STATUS.CONNECTED;

  // ===== PiP MODE: Minimal floating window layout for audio calls =====
  if (isPipMode) {
    return (
      <div className="fixed inset-0 bg-dark-900 z-40 flex items-center justify-center">
        {/* Hidden audio — must still play in PiP */}
        <audio ref={remoteAudioRef} autoPlay playsInline />
        {remoteUser?.avatar ? (
          <img
            src={`${SERVER_URL}${remoteUser.avatar}`}
            alt={remoteUser?.username}
            className="w-16 h-16 rounded-full object-cover"
          />
        ) : (
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white"
            style={{ backgroundColor: stringToColor(remoteUser?.username) }}
          >
            {getInitials(remoteUser?.username)}
          </div>
        )}
        {/* Duration */}
        {isConnected && (
          <div className="absolute bottom-1 left-1 bg-black/60 px-1.5 py-0.5 rounded text-[9px] text-white">
            {formatDuration(callDuration)}
          </div>
        )}
        {/* Mute indicator */}
        {!isAudioEnabled && (
          <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 flex items-center justify-center">
            <MicOff size={10} className="text-white" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 bg-gradient-to-b from-dark-800 via-dark-900 to-dark-950 z-40 flex flex-col safe-top safe-bottom ${isMinimized ? 'hidden' : ''}`}>
      {/* Hidden audio element for remote audio playback */}
      <audio id="remote-audio" ref={remoteAudioRef} autoPlay playsInline />

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Avatar with pulse animation when connecting / speaking */}
        <div className="relative mb-8">
          {/* Outer ring animation — connecting */}
          {isConnecting && (
            <>
              <div className="absolute inset-0 rounded-full border-4 border-primary-400/20 animate-ping" style={{ animationDuration: '2s' }} />
              <div className="absolute -inset-3 rounded-full border-2 border-primary-400/10 animate-ping" style={{ animationDuration: '3s' }} />
            </>
          )}
          {/* Speaking glow rings */}
          {isConnected && remoteSpeaking && !remoteAudioMuted && (
            <>
              <div className="absolute -inset-3 rounded-full border-2 border-emerald-400/30 animate-ping" style={{ animationDuration: '1.5s' }} />
              <div className="absolute -inset-1.5 rounded-full border-2 border-emerald-400/40" />
            </>
          )}
          {isConnected && !remoteSpeaking && (
            <div className="absolute -inset-2 rounded-full border-2 border-emerald-400/20" />
          )}
          
          {remoteUser?.avatar ? (
            <img
              src={`${SERVER_URL}${remoteUser.avatar}`}
              alt={remoteUser?.username}
              className={`w-28 h-28 md:w-32 md:h-32 rounded-full object-cover shadow-2xl transition-all duration-200 ${
                isConnecting ? 'animate-pulse' : ''
              } ${
                remoteSpeaking && !remoteAudioMuted ? 'scale-105 shadow-emerald-400/20' : ''
              }`}
            />
          ) : (
            <div
              className={`w-28 h-28 md:w-32 md:h-32 rounded-full flex items-center justify-center text-4xl md:text-5xl font-bold text-white shadow-2xl transition-all duration-200 ${
                isConnecting ? 'animate-pulse' : ''
              } ${
                remoteSpeaking && !remoteAudioMuted ? 'scale-105 shadow-emerald-400/20' : ''
              }`}
              style={{ backgroundColor: stringToColor(remoteUser?.username) }}
            >
              {getInitials(remoteUser?.username)}
            </div>
          )}

          {/* Remote mute badge on avatar */}
          {remoteAudioMuted && isConnected && (
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-red-500 flex items-center justify-center border-2 border-dark-900 shadow-lg">
              <MicOff size={14} className="text-white" />
            </div>
          )}
        </div>

        {/* User info */}
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
          {remoteUser?.username || 'Unknown'}
        </h2>

        <p className="text-dark-400 text-sm md:text-base mb-3">
          {isConnecting && 'Calling...'}
          {isConnected && remoteAudioMuted && 'Muted'}
          {isConnected && !remoteAudioMuted && 'On call'}
          {callStatus === CALL_STATUS.FAILED && 'Connection failed'}
          {callStatus === CALL_STATUS.RECONNECTING && 'Reconnecting...'}
        </p>

        {/* Duration */}
        {isConnected && (
          <p className="text-primary-400 text-xl md:text-2xl font-mono tracking-wider">
            {formatDuration(callDuration)}
          </p>
        )}

        {/* Dynamic speaking waveform — shows real speaking activity */}
        {isConnected && (
          <div className="flex items-end gap-1.5 mt-8 h-8">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={`w-1 rounded-full transition-all duration-150 ${
                  remoteSpeaking && !remoteAudioMuted
                    ? 'bg-emerald-400 animate-speaking-bar'
                    : remoteAudioMuted
                      ? 'bg-red-400/40 h-2'
                      : 'bg-dark-600 h-2'
                }`}
                style={remoteSpeaking && !remoteAudioMuted ? { animationDelay: `${i * 0.12}s` } : {}}
              />
            ))}
          </div>
        )}

        {/* Local speaking indicator */}
        {isConnected && (
          <div className="flex items-center gap-2 mt-6">
            {!isAudioEnabled ? (
              <div className="flex items-center gap-1.5 bg-red-500/10 rounded-full px-3 py-1.5">
                <MicOff size={12} className="text-red-400" />
                <span className="text-xs text-red-400">You are muted</span>
              </div>
            ) : localSpeaking ? (
              <div className="flex items-center gap-1.5 bg-emerald-500/10 rounded-full px-3 py-1.5">
                <span className="flex gap-0.5 items-end h-3">
                  {[...Array(3)].map((_, i) => (
                    <span key={i} className="w-0.5 bg-emerald-400 rounded-full animate-speaking-bar" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
                <span className="text-xs text-emerald-400">Speaking</span>
              </div>
            ) : null}
          </div>
        )}

        {/* ICE state + Ping */}
        <div className="flex items-center gap-2 mt-6 bg-dark-800/50 rounded-full px-3 py-1.5 backdrop-blur-sm">
          <span className={`w-2 h-2 rounded-full ${
            iceState === 'connected' || iceState === 'completed' ? 'bg-emerald-400' :
            iceState === 'checking' ? 'bg-yellow-400 animate-pulse' :
            iceState === 'failed' ? 'bg-red-400' : 'bg-dark-400'
          }`} />
          <span className="text-xs text-dark-400 capitalize">{iceState}</span>
          {/* Ping indicator */}
          <span className="w-px h-3 bg-dark-600 mx-0.5" />
          <PingIndicator variant="inline" />
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
