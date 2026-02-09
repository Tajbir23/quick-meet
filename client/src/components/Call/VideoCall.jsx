/**
 * ============================================
 * VideoCall — Full-screen video call overlay
 * ============================================
 * 
 * WHY autoPlay + playsInline:
 * - autoPlay: Start playing as soon as stream is attached
 * - playsInline: iOS Safari requires this to avoid fullscreen
 * 
 * WHY muted on localVideo:
 * - Prevents echo feedback from hearing your own mic
 */

import { useEffect, useRef } from 'react';
import { PhoneOff, Maximize2, Minimize2 } from 'lucide-react';
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
  } = useCallStore();

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [isLocalLarge, setIsLocalLarge] = useState(false);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const isConnecting = callStatus === CALL_STATUS.CALLING || callStatus === CALL_STATUS.RECONNECTING;
  const isConnected = callStatus === CALL_STATUS.CONNECTED;

  return (
    <div className="fixed inset-0 bg-dark-900 z-40 flex flex-col">
      {/* Status bar */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/60 to-transparent p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ backgroundColor: stringToColor(remoteUser?.username) }}
            >
              {getInitials(remoteUser?.username)}
            </div>
            <div>
              <p className="text-white text-sm font-medium">{remoteUser?.username || 'Unknown'}</p>
              <p className="text-dark-300 text-xs">
                {isConnecting && 'Connecting...'}
                {isConnected && formatDuration(callDuration)}
                {callStatus === CALL_STATUS.FAILED && 'Connection failed'}
              </p>
            </div>
          </div>

          {/* ICE state indicator */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              iceState === 'connected' || iceState === 'completed' ? 'bg-emerald-400' :
              iceState === 'checking' ? 'bg-yellow-400 animate-pulse' :
              iceState === 'failed' ? 'bg-red-400' : 'bg-dark-400'
            }`} />
            <span className="text-xs text-dark-400 capitalize">{iceState}</span>
          </div>
        </div>
      </div>

      {/* Video area */}
      <div className="flex-1 relative bg-dark-900">
        {/* Remote video (main) */}
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`w-full h-full object-cover ${isLocalLarge ? 'absolute top-4 right-4 w-48 h-36 rounded-lg z-20 shadow-2xl cursor-pointer' : ''}`}
            onClick={() => isLocalLarge && setIsLocalLarge(false)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <div
              className="w-32 h-32 rounded-full flex items-center justify-center text-4xl font-bold mb-4"
              style={{ backgroundColor: stringToColor(remoteUser?.username) }}
            >
              {getInitials(remoteUser?.username)}
            </div>
            {isConnecting && (
              <div className="flex items-center gap-2 mt-2">
                <div className="typing-dots">
                  <span /><span /><span />
                </div>
                <p className="text-dark-400 text-sm">Calling...</p>
              </div>
            )}
          </div>
        )}

        {/* Local video (picture-in-picture) */}
        {localStream && (
          <div
            className={`absolute shadow-2xl border border-dark-600 overflow-hidden cursor-pointer transition-all ${
              isLocalLarge
                ? 'inset-0 rounded-none'
                : 'bottom-24 right-4 w-48 h-36 rounded-lg z-20'
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
          className="absolute top-20 right-4 z-30 w-8 h-8 rounded-full bg-dark-700/70 flex items-center justify-center text-white hover:bg-dark-600"
          title="Swap views"
        >
          {isLocalLarge ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
        <CallControls />
      </div>
    </div>
  );
};

export default VideoCall;
