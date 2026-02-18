/**
 * ============================================
 * GroupCall — Mesh group call with personal pin
 * ============================================
 * 
 * WHY mesh topology:
 * - Each peer connects directly to every other peer
 * - N users = N*(N-1)/2 connections
 * - Max 6 participants to keep it manageable
 * - No media server needed — pure P2P
 * 
 * PERSONAL PIN:
 * - Any user can pin any participant (including self)
 * - Pinned user gets a large spotlight view
 * - Other participants show as small thumbnails
 * - Pin is local only — doesn't affect other users
 * - Click pin button or double-tap a tile to pin/unpin
 */

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { Users, PhoneOff, Monitor, MicOff, Pin, PinOff } from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import useAuthStore from '../../store/useAuthStore';
import CallControls from '../Call/CallControls';
import PingIndicator from '../Call/PingIndicator';
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
const VideoTile = ({
  stream, name, isMuted = false, isLocal = false,
  isScreenSharing = false, isPinned = false, onPin, onUnpin,
  isSpotlight = false,
}) => {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  const isSpeaking = useSpeakingDetector(stream);
  const lastTapRef = useRef(0);

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

  const showVideo = isLocal
    ? stream?.getVideoTracks().some(t => t.enabled)
    : hasVideo;

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, showVideo]);

  useEffect(() => {
    if (audioRef.current && stream && !isLocal) {
      audioRef.current.srcObject = stream;
    }
  }, [stream, isLocal]);

  // Double-tap to pin/unpin
  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      if (isPinned) {
        onUnpin?.();
      } else {
        onPin?.();
      }
    }
    lastTapRef.current = now;
  };

  return (
    <div
      className={`relative bg-dark-800 rounded-2xl overflow-hidden h-full w-full transition-all duration-300 ${
        isSpeaking && !isMuted ? 'ring-2 ring-emerald-400 shadow-lg shadow-emerald-400/20' : ''
      } ${isPinned ? 'ring-2 ring-primary-400/60' : ''}`}
      onClick={handleDoubleTap}
    >
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
          className={`w-full h-full ${isLocal ? 'object-cover' : isSpotlight ? 'object-contain bg-black' : 'object-contain bg-black'}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-dark-800 to-dark-900">
          <div className="relative">
            {isSpeaking && !isMuted && (
              <>
                <div className="absolute -inset-2 rounded-full border-2 border-emerald-400/40 animate-ping" style={{ animationDuration: '1.5s' }} />
                <div className="absolute -inset-1 rounded-full border-2 border-emerald-400/20" />
              </>
            )}
            <div
              className={`${isSpotlight ? 'w-20 h-20 md:w-24 md:h-24 text-2xl md:text-3xl' : 'w-14 h-14 md:w-16 md:h-16 text-lg md:text-xl'} rounded-full flex items-center justify-center font-bold text-white transition-transform duration-200 ${
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

      {/* Pin button — top right area */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          isPinned ? onUnpin?.() : onPin?.();
        }}
        className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center transition-all z-10 ${
          isPinned
            ? 'bg-primary-500/80 text-white shadow-lg'
            : 'bg-black/30 text-white/60 hover:text-white hover:bg-black/50 opacity-0 group-hover/tile:opacity-100'
        }`}
        title={isPinned ? 'Unpin' : 'Pin'}
      >
        {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
      </button>

      {/* Mute icon */}
      {isMuted && (
        <div className={`absolute ${isPinned ? 'top-2 right-11' : 'top-2 right-11'} w-6 h-6 rounded-full bg-red-500/80 backdrop-blur-sm flex items-center justify-center`}>
          <MicOff size={12} className="text-white" />
        </div>
      )}

      {/* Speaking indicator bar */}
      {isSpeaking && !isMuted && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-400 animate-pulse" />
      )}

      {/* Pinned indicator */}
      {isPinned && (
        <div className="absolute top-2 left-2 bg-primary-500/80 backdrop-blur-sm px-2 py-0.5 rounded-full text-[10px] text-white flex items-center gap-1">
          <Pin size={9} />
          <span>Pinned</span>
        </div>
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

  // Personal pin state — stored as participant userId or 'self'
  const [pinnedUserId, setPinnedUserId] = useState(null);

  // When the pinned user leaves the call, auto-unpin
  useEffect(() => {
    if (!pinnedUserId || pinnedUserId === 'self') return;
    const stillInCall = groupCallParticipants.some(p => p.userId === pinnedUserId);
    if (!stillInCall) setPinnedUserId(null);
  }, [groupCallParticipants, pinnedUserId]);

  const totalParticipants = groupCallParticipants.length + 1; // +1 for self
  const hasPinned = pinnedUserId !== null;

  // Build the list of all participants (self + remote) for rendering
  const allParticipants = useMemo(() => {
    const self = {
      id: 'self',
      userId: 'self',
      username: user?.username,
      stream: localStream,
      isLocal: true,
      isMuted: !isAudioEnabled,
      isScreenSharing: isScreenSharing,
    };
    const remotes = groupCallParticipants.map(p => ({
      id: p.userId,
      userId: p.userId,
      username: p.username,
      stream: remoteStreams[p.userId],
      isLocal: false,
      isMuted: p.isMuted,
      isScreenSharing: p.isScreenSharing,
    }));
    return [self, ...remotes];
  }, [localStream, remoteStreams, groupCallParticipants, user, isAudioEnabled, isScreenSharing]);

  // Separate pinned participant and the rest
  const pinnedParticipant = hasPinned ? allParticipants.find(p => p.userId === pinnedUserId) : null;
  const unpinnedParticipants = hasPinned
    ? allParticipants.filter(p => p.userId !== pinnedUserId)
    : allParticipants;

  // Grid class for non-pinned layout
  // IMPORTANT: Tailwind purges dynamic class names like `grid-cols-${n}`.
  // Always use full string literals so classes are included in the build.
  const gridClass = useMemo(() => {
    if (hasPinned) {
      const thumbCount = unpinnedParticipants.length;
      if (thumbCount <= 1) return 'grid-cols-1';
      if (thumbCount === 2) return 'grid-cols-2';
      if (thumbCount === 3) return 'grid-cols-3';
      return 'grid-cols-3 md:grid-cols-4';
    }
    // Full-screen grid for all participants
    if (totalParticipants <= 1) return 'grid-cols-1 grid-rows-1';
    if (totalParticipants === 2) return 'grid-cols-1 md:grid-cols-2 grid-rows-2 md:grid-rows-1';
    if (totalParticipants === 3) return 'grid-cols-1 md:grid-cols-3 auto-rows-fr';
    if (totalParticipants === 4) return 'grid-cols-2 grid-rows-2';
    if (totalParticipants <= 6) return 'grid-cols-2 md:grid-cols-3 auto-rows-fr';
    return 'grid-cols-3 auto-rows-fr';
  }, [totalParticipants, hasPinned, unpinnedParticipants.length]);

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

        {/* Pin status + Ping + Quick end button */}
        <div className="flex items-center gap-2">
          {hasPinned && (
            <button
              onClick={() => setPinnedUserId(null)}
              className="flex items-center gap-1 bg-primary-500/20 text-primary-400 text-xs px-2.5 py-1 rounded-full hover:bg-primary-500/30 transition-colors"
              title="Unpin all"
            >
              <PinOff size={12} />
              <span className="hidden xs:inline">Unpin</span>
            </button>
          )}
          <PingIndicator variant="inline" />
          <button
            onClick={endCall}
            className="px-4 py-2 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 text-white text-sm font-medium flex items-center gap-2 transition-colors shadow-lg shadow-red-500/20"
          >
            <PhoneOff size={14} />
            <span className="hidden xs:inline">Leave</span>
          </button>
        </div>
      </div>

      {/* Video area */}
      {hasPinned && pinnedParticipant ? (
        /* ===== PINNED LAYOUT: Spotlight + Thumbnails ===== */
        <div className="flex-1 flex flex-col min-h-0">
          {/* Spotlight — pinned user takes most of the screen */}
          <div className="flex-1 p-1.5 md:p-2 min-h-0 group/tile">
            <VideoTile
              stream={pinnedParticipant.stream}
              name={pinnedParticipant.username}
              isLocal={pinnedParticipant.isLocal}
              isMuted={pinnedParticipant.isMuted}
              isScreenSharing={pinnedParticipant.isScreenSharing}
              isPinned
              isSpotlight
              onUnpin={() => setPinnedUserId(null)}
            />
          </div>

          {/* Thumbnail strip — bottom row */}
          {unpinnedParticipants.length > 0 && (
            <div className="flex-shrink-0 px-1.5 md:px-2 pb-1.5 md:pb-2">
              <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {unpinnedParticipants.map(p => (
                  <div key={p.userId} className="flex-shrink-0 w-28 h-20 md:w-36 md:h-24 group/tile">
                    <VideoTile
                      stream={p.stream}
                      name={p.username}
                      isLocal={p.isLocal}
                      isMuted={p.isMuted}
                      isScreenSharing={p.isScreenSharing}
                      isPinned={false}
                      onPin={() => setPinnedUserId(p.userId)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ===== DEFAULT GRID LAYOUT ===== */
        <div className={`flex-1 p-1.5 md:p-2 grid ${gridClass} gap-1.5 md:gap-2 min-h-0 overflow-hidden`}>
          {allParticipants.map(p => (
            <div key={p.userId} className="group/tile min-h-0 h-full w-full">
              <VideoTile
                stream={p.stream}
                name={p.username}
                isLocal={p.isLocal}
                isMuted={p.isMuted}
                isScreenSharing={p.isScreenSharing}
                isPinned={false}
                onPin={() => setPinnedUserId(p.userId)}
              />
            </div>
          ))}

          {/* Empty slot when alone */}
          {totalParticipants === 1 && (
            <div className="bg-dark-800 rounded-2xl flex items-center justify-center h-full">
              <div className="text-center">
                <Users size={28} className="mx-auto text-dark-600 mb-2" />
                <p className="text-dark-500 text-sm">Waiting for others...</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="bg-dark-800/80 backdrop-blur-sm p-4 safe-bottom">
        <CallControls compact />
      </div>
    </div>
  );
};

export default GroupCall;
