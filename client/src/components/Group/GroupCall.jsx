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

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { Users, PhoneOff, Monitor, MicOff } from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import useAuthStore from '../../store/useAuthStore';
import CallControls from '../Call/CallControls';
import useSpeakingDetector from '../../hooks/useSpeakingDetector';
import { getInitials, stringToColor, formatDuration } from '../../utils/helpers';

/**
 * Individual video tile for a participant
 *
 * WHY dynamic hasVideo:
 * - WebRTC sendrecv transceiver always creates a video track on the receiver,
 *   even for audio-only calls (track.enabled=true but track.muted=true).
 * - replaceTrack (screen share) changes media content without firing ontrack,
 *   so React doesn't re-render from stream reference changes.
 * - By listening to track.onmute / track.onunmute we detect when video data
 *   actually starts or stops flowing.
 */
const VideoTile = ({ stream, name, isMuted = false, isLocal = false, isScreenSharing = false }) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  const isSpeaking = useSpeakingDetector(stream);

  // Dynamically detect whether video data is flowing
  const checkVideoActive = useCallback(() => {
    if (!stream) { setHasVideo(false); return; }
    const active = stream.getVideoTracks().some(t => t.enabled && !t.muted && t.readyState === 'live');
    setHasVideo(active);
  }, [stream]);

  useEffect(() => {
    if (!stream) { setHasVideo(false); return; }
    checkVideoActive();

    const tracks = stream.getVideoTracks();
    tracks.forEach(t => {
      t.addEventListener('mute', checkVideoActive);
      t.addEventListener('unmute', checkVideoActive);
      t.addEventListener('ended', checkVideoActive);
    });
    // Also listen for tracks added/removed (e.g. screen share adds a track)
    stream.addEventListener('addtrack', checkVideoActive);
    stream.addEventListener('removetrack', checkVideoActive);

    return () => {
      tracks.forEach(t => {
        t.removeEventListener('mute', checkVideoActive);
        t.removeEventListener('unmute', checkVideoActive);
        t.removeEventListener('ended', checkVideoActive);
      });
      stream.removeEventListener('addtrack', checkVideoActive);
      stream.removeEventListener('removetrack', checkVideoActive);
    };
  }, [stream, checkVideoActive]);

  // For local stream, check enabled (we control it) rather than muted
  const showVideo = isLocal
    ? stream?.getVideoTracks().some(t => t.enabled)
    : hasVideo;

  // Re-run when showVideo changes: the <video> element is conditionally
  // rendered, so toggling video off destroys it. When toggled back on, a
  // fresh <video> element is created and needs srcObject + play().
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, showVideo]);

  // Always attach stream to hidden audio element for audio-only scenarios
  useEffect(() => {
    if (audioRef.current && stream && !isLocal) {
      audioRef.current.srcObject = stream;
    }
  }, [stream, isLocal]);

  return (
    <div className={`relative bg-dark-800 rounded-2xl overflow-hidden h-full w-full transition-shadow duration-300 ${
      isSpeaking && !isMuted ? 'ring-2 ring-emerald-400 shadow-lg shadow-emerald-400/20' : ''
    }`}>
      {/* Hidden audio element — plays audio even when video is off / avatar shown */}
      {!isLocal && stream && (
        <audio ref={audioRef} autoPlay playsInline />
      )}

      {stream && showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal || isMuted}
          className={`w-full h-full ${isLocal ? 'object-cover' : 'object-contain bg-black'}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-dark-800 to-dark-900">
          <div className="relative">
            {/* Speaking pulse rings around avatar */}
            {isSpeaking && !isMuted && (
              <>
                <div className="absolute -inset-2 rounded-full border-2 border-emerald-400/40 animate-ping" style={{ animationDuration: '1.5s' }} />
                <div className="absolute -inset-1 rounded-full border-2 border-emerald-400/20" />
              </>
            )}
            <div
              className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center text-lg md:text-xl font-bold text-white transition-transform duration-200 ${
                isSpeaking && !isMuted ? 'scale-110' : ''
              }`}
              style={{ backgroundColor: stringToColor(name) }}
            >
              {getInitials(name)}
            </div>
          </div>
        </div>
      )}

      {/* Screen share indicator */}
      {isScreenSharing && (
        <div className="absolute top-2 left-2 bg-primary-500/80 backdrop-blur-sm px-2 py-0.5 rounded-full text-[10px] text-white flex items-center gap-1">
          <Monitor size={10} />
          <span>Screen</span>
        </div>
      )}

      {/* Mute icon — top right */}
      {isMuted && (
        <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500/80 backdrop-blur-sm flex items-center justify-center">
          <MicOff size={12} className="text-white" />
        </div>
      )}

      {/* Speaking indicator bar — bottom animated bar */}
      {isSpeaking && !isMuted && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-400 animate-pulse" />
      )}

      {/* Name tag */}
      <div className="absolute bottom-2 left-2 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs text-white flex items-center gap-1.5">
        <span>{isLocal ? 'You' : name}</span>
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
    isScreenSharing,
    callStatus,
    endCall,
    isMinimized,
  } = useCallStore();
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
    <div className={`fixed inset-0 bg-dark-900 z-40 flex flex-col ${isMinimized ? 'hidden' : ''}`}>
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
          isScreenSharing={isScreenSharing}
        />

        {/* Remote participants */}
        {groupCallParticipants.map(participant => (
          <VideoTile
            key={participant.userId}
            stream={remoteStreams[participant.userId]}
            name={participant.username}
            isMuted={participant.isMuted}
            isScreenSharing={participant.isScreenSharing}
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
