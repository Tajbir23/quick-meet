/**
 * ============================================
 * StatusBar — Persistent notification strip
 * ============================================
 *
 * Shows active calls and file transfers as a thin bar
 * at the top of the app. Visible on ALL pages.
 *
 * - Active call: type, duration, controls (mute, end, maximize)
 * - Active file transfers: count, overall progress, toggle panel
 */

import { useMemo } from 'react';
import {
  Phone, Video, PhoneOff, Mic, MicOff, Maximize2,
  ArrowUpCircle, ArrowDownCircle, Users, Loader2,
} from 'lucide-react';
import useCallStore from '../../store/useCallStore';
import useFileTransferStore from '../../store/useFileTransferStore';
import PingIndicator from '../Call/PingIndicator';
import { formatDuration } from '../../utils/helpers';
import { CALL_STATUS } from '../../utils/constants';

const StatusBar = () => {
  // ─── Call state ────────────────────────────
  const callStatus = useCallStore(s => s.callStatus);
  const callType = useCallStore(s => s.callType);
  const callDuration = useCallStore(s => s.callDuration);
  const remoteUser = useCallStore(s => s.remoteUser);
  const isGroupCall = useCallStore(s => s.isGroupCall);
  const isMinimized = useCallStore(s => s.isMinimized);
  const isAudioEnabled = useCallStore(s => s.isAudioEnabled);
  const groupCallParticipants = useCallStore(s => s.groupCallParticipants);
  const toggleAudio = useCallStore(s => s.toggleAudio);
  const endCall = useCallStore(s => s.endCall);
  const maximizeCall = useCallStore(s => s.maximizeCall);

  // ─── File transfer state ───────────────────
  const transfers = useFileTransferStore(s => s.transfers);
  const togglePanel = useFileTransferStore(s => s.togglePanel);

  // Compute active transfers
  const { activeTransfers, uploadCount, downloadCount, overallProgress } = useMemo(() => {
    const all = Object.values(transfers);
    const active = all.filter(t =>
      t.status === 'transferring' || t.status === 'accepted' || t.status === 'connecting'
    );
    const uploads = active.filter(t => t.direction === 'send');
    const downloads = active.filter(t => t.direction === 'receive');

    let totalBytes = 0;
    let doneBytes = 0;
    active.forEach(t => {
      totalBytes += t.fileSize || 0;
      doneBytes += t.bytesTransferred || 0;
    });
    const progress = totalBytes > 0 ? Math.round((doneBytes / totalBytes) * 100) : 0;

    return {
      activeTransfers: active,
      uploadCount: uploads.length,
      downloadCount: downloads.length,
      overallProgress: progress,
    };
  }, [transfers]);

  const hasCall = callStatus !== CALL_STATUS.IDLE && callStatus !== 'idle';
  const hasTransfers = activeTransfers.length > 0;

  if (!hasCall && !hasTransfers) return null;

  const callName = isGroupCall
    ? `Group (${groupCallParticipants.length + 1})`
    : remoteUser?.username || 'Call';

  const statusLabel =
    callStatus === CALL_STATUS.CALLING ? 'Calling...' :
    callStatus === CALL_STATUS.RINGING ? 'Ringing...' :
    callStatus === CALL_STATUS.RECONNECTING ? 'Reconnecting...' :
    callStatus === CALL_STATUS.CONNECTED ? formatDuration(callDuration) :
    callStatus;

  return (
    <div className="bg-dark-800/95 border-b border-dark-700/60 backdrop-blur-sm z-40 relative">
      <div className="flex items-center gap-3 px-3 py-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {/* ── Active Call ──────────────────────── */}
        {hasCall && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Call indicator dot */}
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>

            {/* Icon */}
            {isGroupCall ? (
              <Users size={14} className="text-primary-400 flex-shrink-0" />
            ) : callType === 'video' ? (
              <Video size={14} className="text-primary-400 flex-shrink-0" />
            ) : (
              <Phone size={14} className="text-emerald-400 flex-shrink-0" />
            )}

            {/* Name & duration */}
            <span className="text-xs text-white font-medium truncate max-w-[100px]">
              {callName}
            </span>
            <span className="text-[11px] text-emerald-400 font-mono tabular-nums flex-shrink-0">
              {statusLabel}
            </span>

            {/* Ping */}
            <PingIndicator variant="compact" />

            {/* Quick controls */}
            <div className="flex items-center gap-1 ml-1 flex-shrink-0">
              <button
                onClick={toggleAudio}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                  isAudioEnabled ? 'bg-dark-600 text-white' : 'bg-red-500/20 text-red-400'
                }`}
                title={isAudioEnabled ? 'Mute' : 'Unmute'}
              >
                {isAudioEnabled ? <Mic size={12} /> : <MicOff size={12} />}
              </button>
              {isMinimized && (
                <button
                  onClick={maximizeCall}
                  className="w-6 h-6 rounded-full bg-dark-600 text-white flex items-center justify-center hover:bg-dark-500 transition-all"
                  title="Show call"
                >
                  <Maximize2 size={12} />
                </button>
              )}
              <button
                onClick={() => endCall()}
                className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-all"
                title="End call"
              >
                <PhoneOff size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Separator */}
        {hasCall && hasTransfers && (
          <div className="w-px h-4 bg-dark-600 flex-shrink-0" />
        )}

        {/* ── Active File Transfers ───────────── */}
        {hasTransfers && (
          <button
            onClick={togglePanel}
            className="flex items-center gap-2 flex-shrink-0 hover:bg-dark-700/50 rounded-lg px-2 py-0.5 transition-colors"
          >
            {/* Transfer icons */}
            <div className="flex items-center gap-1">
              {uploadCount > 0 && (
                <span className="flex items-center gap-0.5 text-blue-400">
                  <ArrowUpCircle size={13} />
                  <span className="text-[11px] font-medium">{uploadCount}</span>
                </span>
              )}
              {downloadCount > 0 && (
                <span className="flex items-center gap-0.5 text-emerald-400">
                  <ArrowDownCircle size={13} />
                  <span className="text-[11px] font-medium">{downloadCount}</span>
                </span>
              )}
              {uploadCount === 0 && downloadCount === 0 && (
                <span className="flex items-center gap-0.5 text-primary-400">
                  <Loader2 size={13} className="animate-spin" />
                  <span className="text-[11px] font-medium">{activeTransfers.length}</span>
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-16 h-1.5 bg-dark-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <span className="text-[11px] text-dark-400 font-mono tabular-nums">
              {overallProgress}%
            </span>
          </button>
        )}
      </div>
    </div>
  );
};

export default StatusBar;
