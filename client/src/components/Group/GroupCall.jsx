/**
 * ============================================
 * GroupCall — Mesh group call overlay with video grid
 * ============================================
 * 
 * WHY mesh topology:
 * - Each peer connects directly to every other peer
 * - N users = N*(N-1)/2 connections
 * - Max 6 participants to keep it manageable
 * - No media server needed — pure P2P
 * 
 * Grid layout adjusts dynamically based on participant count.
 */

import { useEffect, useRef, useMemo } from 'react';
import { Users, PhoneOff } from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import useAuthStore from '../../store/useAuthStore';
import CallControls from '../Call/CallControls';
import { getInitials, stringToColor, formatDuration } from '../../utils/helpers';

/**
 * Individual video tile for a participant
 */
const VideoTile = ({ stream, name, isMuted = false, isLocal = false }) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Always attach stream to hidden audio element for audio-only scenarios
  useEffect(() => {
    if (audioRef.current && stream && !isLocal) {
      audioRef.current.srcObject = stream;
    }
  }, [stream, isLocal]);

  const hasVideo = stream?.getVideoTracks().some(t => t.enabled);

  return (
    <div className="relative bg-dark-800 rounded-2xl overflow-hidden h-full w-full">
      {/* Hidden audio element — plays audio even when video is off / avatar shown */}
      {!isLocal && stream && (
        <audio ref={audioRef} autoPlay playsInline />
      )}

      {stream && hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal || isMuted}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-dark-800 to-dark-900">
          <div
            className="w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center text-lg md:text-xl font-bold text-white"
            style={{ backgroundColor: stringToColor(name) }}
          >
            {getInitials(name)}
          </div>
        </div>
      )}

      {/* Name tag */}
      <div className="absolute bottom-2 left-2 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs text-white flex items-center gap-1.5">
        <span>{isLocal ? 'You' : name}</span>
        {isMuted && (
          <span className="text-red-400 text-[10px]">🔇</span>
        )}
      </div>
    </div>
  );
};

const GroupCall = () => {
  const {
    localStream,
    remoteStreams,
    groupCallParticipants,
    callDuration,
    isVideoEnabled,
    isAudioEnabled,
    callStatus,
    endCall,
    isMinimized,
  } = useCallStore();

  // Don't render full overlay when minimized
  if (isMinimized) return null;
  const { user } = useAuthStore();

  // Calculate grid layout class based on participant count
  const totalParticipants = groupCallParticipants.length + 1; // +1 for self

  const gridClass = useMemo(() => {
    if (totalParticipants <= 1) return 'grid-cols-1';
    if (totalParticipants <= 2) return 'grid-cols-1 md:grid-cols-2';
    if (totalParticipants <= 4) return 'grid-cols-2 grid-rows-2';
    return 'grid-cols-2 md:grid-cols-3 grid-rows-2'; // 5-6 participants
  }, [totalParticipants]);

  return (
    <div className="fixed inset-0 bg-dark-900 z-40 flex flex-col">
      {/* Header */}
      <div className="bg-dark-800/80 backdrop-blur-sm px-4 py-3 flex items-center justify-between z-10 safe-top">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center">
            <Users size={16} className="text-primary-400" />
          </div>
          <div>
            <p className="text-white text-sm font-semibold">
              Group Call
            </p>
            <p className="text-dark-400 text-xs">
              {totalParticipants} participant{totalParticipants !== 1 ? 's' : ''} · {formatDuration(callDuration)}
            </p>
          </div>
        </div>

        {/* Quick end button */}
        <button
          onClick={endCall}
          className="px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 text-white text-sm font-medium flex items-center gap-2 transition-colors shadow-lg shadow-red-500/20"
        >
          <PhoneOff size={14} />
          <span className="hidden xs:inline">Leave</span>
        </button>
      </div>

      {/* Video grid */}
      <div className={`flex-1 p-1.5 md:p-2 grid ${gridClass} gap-1.5 md:gap-2`}>
        {/* Local video (self) */}
        <VideoTile
          stream={localStream}
          name={user?.username}
          isLocal
          isMuted={!isAudioEnabled}
        />

        {/* Remote participants */}
        {groupCallParticipants.map(participant => (
          <VideoTile
            key={participant.userId}
            stream={remoteStreams[participant.userId]}
            name={participant.username}
          />
        ))}

        {/* Empty slots if less than 2 */}
        {totalParticipants === 1 && (
          <div className="bg-dark-800 rounded-2xl flex items-center justify-center">
            <div className="text-center">
              <Users size={28} className="mx-auto text-dark-600 mb-2" />
              <p className="text-dark-500 text-sm">Waiting for others...</p>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-dark-800/80 backdrop-blur-sm p-4 safe-bottom">
        <CallControls compact />
      </div>
    </div>
  );
};

export default GroupCall;
