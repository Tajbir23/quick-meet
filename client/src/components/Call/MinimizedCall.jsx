/**
 * ============================================
 * MinimizedCall — Floating PIP when call is minimized
 * ============================================
 * 
 * Shows a small draggable floating bar with:
 * - Call type icon & user/group name
 * - Call duration
 * - Quick mute toggle
 * - End call button
 * - Click to maximize
 */

import { useRef, useState, useEffect } from 'react';
import {
  Phone, Video, Users, PhoneOff, Mic, MicOff, Maximize2
} from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import { formatDuration, getInitials, stringToColor } from '../../utils/helpers';
import { CALL_STATUS } from '../../utils/constants';

const MinimizedCall = () => {
  const {
    callType,
    callDuration,
    callStatus,
    remoteUser,
    remoteStream,
    isGroupCall,
    groupCallParticipants,
    isAudioEnabled,
    toggleAudio,
    endCall,
    maximizeCall,
  } = useCallStore();

  // Keep remote audio playing while minimized
  const remoteAudioRef = useRef(null);
  useEffect(() => {
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [remoteStream]);

  // Dragging state
  const containerRef = useRef(null);
  const [position, setPosition] = useState({ x: 12, y: 80 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  const handlePointerDown = (e) => {
    // Don't drag if clicking a button
    if (e.target.closest('button')) return;
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPosition({
      x: dragRef.current.startPosX + dx,
      y: dragRef.current.startPosY + dy,
    });
  };

  const handlePointerUp = () => {
    const wasDragging = dragRef.current.dragging;
    const dx = Math.abs(position.x - dragRef.current.startPosX);
    const dy = Math.abs(position.y - dragRef.current.startPosY);
    dragRef.current.dragging = false;

    // If barely moved, treat as tap → maximize
    if (wasDragging && dx < 5 && dy < 5) {
      maximizeCall();
    }

    // Snap to nearest edge
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewW = window.innerWidth;
      const midX = rect.left + rect.width / 2;
      setPosition((prev) => ({
        x: midX < viewW / 2 ? 12 : viewW - rect.width - 12,
        y: Math.max(8, Math.min(prev.y, window.innerHeight - rect.height - 8)),
      }));
    }
  };

  const displayName = isGroupCall
    ? `Group (${groupCallParticipants.length + 1})`
    : remoteUser?.username || 'Call';

  const avatarColor = isGroupCall
    ? '#0ea5e9'
    : stringToColor(remoteUser?.username);

  return (
    <div
      ref={containerRef}
      className="fixed z-50 select-none touch-none"
      style={{ left: position.x, top: position.y }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Hidden audio to keep remote audio playing while minimized */}
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: 'none' }} />

      <div className="flex items-center gap-2.5 bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl shadow-black/40 px-3 py-2.5 backdrop-blur-sm cursor-grab active:cursor-grabbing">
        {/* Avatar / Icon */}
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 relative"
          style={{ backgroundColor: avatarColor }}
        >
          {isGroupCall ? (
            <Users size={16} />
          ) : (
            getInitials(remoteUser?.username)
          )}
          {/* Pulsing ring to indicate active call */}
          <span className="absolute inset-0 rounded-full border-2 border-emerald-400/40 animate-ping" style={{ animationDuration: '2s' }} />
        </div>

        {/* Info */}
        <div className="min-w-0">
          <p className="text-white text-xs font-semibold truncate max-w-[100px]">{displayName}</p>
          <div className="flex items-center gap-1.5">
            {callType === 'video' ? (
              <Video size={10} className="text-primary-400" />
            ) : (
              <Phone size={10} className="text-emerald-400" />
            )}
            <span className="text-emerald-400 text-[10px] font-mono">
              {formatDuration(callDuration)}
            </span>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 ml-1">
          {/* Mute toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleAudio(); }}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
              isAudioEnabled
                ? 'bg-dark-600 text-white hover:bg-dark-500'
                : 'bg-red-500/20 text-red-400'
            }`}
          >
            {isAudioEnabled ? <Mic size={14} /> : <MicOff size={14} />}
          </button>

          {/* End call */}
          <button
            onClick={(e) => { e.stopPropagation(); endCall(); }}
            className="w-8 h-8 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all"
          >
            <PhoneOff size={14} />
          </button>

          {/* Maximize */}
          <button
            onClick={(e) => { e.stopPropagation(); maximizeCall(); }}
            className="w-8 h-8 rounded-full bg-dark-600 hover:bg-dark-500 text-white flex items-center justify-center transition-all"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MinimizedCall;
